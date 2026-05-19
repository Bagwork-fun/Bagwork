// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ConditionalTokens } from "./ConditionalTokens.sol";

/**
 * @title PredictionMarketAMM
 * @notice AMM for trading YES/NO ERC-1155 CTF outcome tokens.
 *
 * @dev This contract preserves the core probability-weighted pricing logic from the original
 *      speedrun-ethereum PredictionMarket.sol but adapts it to:
 *       - Trade ERC-1155 CTF positions instead of ERC-20 tokens
 *       - Use USDC (ERC-20) as collateral instead of ETH
 *       - Support multiple markets (pools) without deploying a new contract per market
 *       - Disable trading after the CTF condition is resolved
 *
 * PRICING ALGORITHM (preserved from original):
 *  Buy/Sell price = initialTokenValue × avgProbability × amount
 *  Where probability = targetTokensSold / totalTokensSold for both outcomes
 *  avgProbability = (probabilityBefore + probabilityAfter) / 2
 *
 * Each pool is identified by a `conditionId` derived from the CTF:
 *  conditionId = keccak256(adapter, questionId, outcomeSlotCount)
 */
contract PredictionMarketAMM is Ownable, ReentrancyGuard, IERC1155Receiver {
    ////////////////////////////////////////////////////
    // Constants
    ////////////////////////////////////////////////////

    uint256 private constant PRECISION = 1e6; // Match USDC decimals

    ////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////

    struct Pool {
        uint256 yesTokenId;        // ERC-1155 positionId for YES outcome
        uint256 noTokenId;         // ERC-1155 positionId for NO outcome
        uint256 yesReserve;        // YES token balance held by this AMM
        uint256 noReserve;         // NO token balance held by this AMM
        uint256 usdcCollateral;    // Total USDC backing this pool
        uint256 lpTradingRevenue;  // Accumulated USDC from buy/sell spreads
        uint256 lpTotalDeposited;  // Cumulative USDC deposited by LP (create + add)
        uint256 lpTotalWithdrawn;  // Cumulative USDC withdrawn by LP (remove + post-resolution)
        uint256 initialYesProbability; // Starting YES probability (1-99)
        uint256 percentageLocked;  // % of supply locked by LP to set initial probability (1-99)
        address lpOwner;           // Address that seeded liquidity
        bool resolved;             // True after CTF condition is resolved
        bool exists;
    }

    struct LpPnLSummary {
        uint256 totalDeposited;
        uint256 totalWithdrawn;
        uint256 tradingRevenue;
        uint256 poolInventory;
        uint256 walletInventory;
        uint256 nav;
        int256 netPnl;
    }

    ////////////////////////////////////////////////////
    // State
    ////////////////////////////////////////////////////

    /// @notice The Gnosis CTF contract
    ConditionalTokens public immutable ctf;

    /// @notice The collateral ERC-20 (USDC on Sepolia: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
    IERC20 public immutable collateral;

    /// @notice conditionId → Pool
    mapping(bytes32 => Pool) public pools;

    /// @notice List of all conditionIds for enumeration
    bytes32[] public allPools;

    ////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////

    event PoolCreated(bytes32 indexed conditionId, uint256 yesTokenId, uint256 noTokenId, uint256 usdcCollateral);
    event LiquidityAdded(bytes32 indexed conditionId, address indexed provider, uint256 usdcAmount, uint256 tokenAmount);
    event LiquidityRemoved(bytes32 indexed conditionId, address indexed provider, uint256 usdcAmount, uint256 tokenAmount);
    event TokensBought(bytes32 indexed conditionId, address indexed buyer, uint256 outcome, uint256 tokenAmount, uint256 usdcPaid);
    event TokensSold(bytes32 indexed conditionId, address indexed seller, uint256 outcome, uint256 tokenAmount, uint256 usdcReceived);
    event PoolResolved(bytes32 indexed conditionId);

    ////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////

    error PoolAlreadyExists(bytes32 conditionId);
    error PoolNotFound(bytes32 conditionId);
    error PoolResolved_();
    error PoolNotResolved();
    error InsufficientReserve(uint256 outcome, uint256 requested);
    error InsufficientLiquidity();
    error InsufficientBalance(uint256 requested, uint256 available);
    error InvalidProbability();
    error InvalidPercentage();
    error AmountZero();
    error WrongUsdcAmount();
    error NotLPOwner();
    error TransferFailed();
    error OnlyFromCTF();

    ////////////////////////////////////////////////////
    // Modifiers
    ////////////////////////////////////////////////////

    modifier poolExists(bytes32 conditionId) {
        if (!pools[conditionId].exists) revert PoolNotFound(conditionId);
        _;
    }

    modifier notResolved(bytes32 conditionId) {
        if (pools[conditionId].resolved) revert PoolResolved_();
        _;
    }

    ////////////////////////////////////////////////////
    // Constructor
    ////////////////////////////////////////////////////

    constructor(address _ctf, address _collateral) Ownable(msg.sender) {
        ctf = ConditionalTokens(_ctf);
        collateral = IERC20(_collateral);
    }

    ////////////////////////////////////////////////////
    // Pool Management
    ////////////////////////////////////////////////////

    /**
     * @notice Creates an AMM pool for a CTF binary market and seeds initial liquidity.
     * @dev Caller must have already approved this contract to spend `usdcAmount` USDC.
     *      The USDC is split-positioned into YES/NO ERC-1155 tokens by the CTF;
     *      then deposited into the pool as reserves.
     *
     * @param conditionId         The CTF conditionId derived from keccak256(adapter, questionId, 2).
     * @param yesTokenId          ERC-1155 YES positionId from the CTF.
     * @param noTokenId           ERC-1155 NO positionId from the CTF.
     * @param usdcAmount          Amount of USDC to provide as initial liquidity.
     * @param initialYesProbability Starting YES probability (1-99).
     * @param percentageToLock    % of token supply locked to simulate initial probability (1-99).
     */
    function createPool(
        bytes32 conditionId,
        uint256 yesTokenId,
        uint256 noTokenId,
        uint256 usdcAmount,
        uint8 initialYesProbability,
        uint8 percentageToLock
    ) external nonReentrant {
        if (pools[conditionId].exists) revert PoolAlreadyExists(conditionId);
        if (usdcAmount == 0) revert AmountZero();
        if (initialYesProbability == 0 || initialYesProbability >= 100) revert InvalidProbability();
        if (percentageToLock == 0 || percentageToLock >= 100) revert InvalidPercentage();

        // Pull USDC from caller
        if (!collateral.transferFrom(msg.sender, address(this), usdcAmount)) revert TransferFailed();

        // Split USDC → YES + NO ERC-1155 tokens via the CTF
        collateral.approve(address(ctf), usdcAmount);
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1; // indexSet for YES (bit 0)
        partition[1] = 2; // indexSet for NO  (bit 1)
        ctf.splitPosition(collateral, bytes32(0), conditionId, partition, usdcAmount);

        // In CTF, 1 collateral = 1 YES + 1 NO. No artificial scaling.
        uint256 tokenAmount = usdcAmount;

        // Calculate locked tokens to simulate initial probability
        uint256 lockedYes = (tokenAmount * initialYesProbability * percentageToLock * 2) / 10000;
        uint256 lockedNo  = (tokenAmount * (100 - initialYesProbability) * percentageToLock * 2) / 10000;

        // Pool holds the non-locked tokens as reserves
        uint256 yesReserve = tokenAmount - lockedYes;
        uint256 noReserve  = tokenAmount - lockedNo;

        // Transfer locked tokens to LP owner (held off-AMM, simulating initial probability)
        ctf.safeTransferFrom(address(this), msg.sender, yesTokenId, lockedYes, "");
        ctf.safeTransferFrom(address(this), msg.sender, noTokenId,  lockedNo,  "");

        pools[conditionId] = Pool({
            yesTokenId:            yesTokenId,
            noTokenId:             noTokenId,
            yesReserve:            yesReserve,
            noReserve:             noReserve,
            usdcCollateral:        usdcAmount,
            lpTradingRevenue:      0,
            lpTotalDeposited:      usdcAmount,
            lpTotalWithdrawn:      0,
            initialYesProbability: initialYesProbability,
            percentageLocked:      percentageToLock,
            lpOwner:               msg.sender,
            resolved:              false,
            exists:                true
        });

        allPools.push(conditionId);

        emit PoolCreated(conditionId, yesTokenId, noTokenId, usdcAmount);
    }

    /**
     * @notice LP owner adds more liquidity to an existing pool.
     */
    function addLiquidity(bytes32 conditionId, uint256 usdcAmount)
        external
        nonReentrant
        poolExists(conditionId)
        notResolved(conditionId)
    {
        Pool storage pool = pools[conditionId];
        if (msg.sender != pool.lpOwner) revert NotLPOwner();
        if (usdcAmount == 0) revert AmountZero();

        if (!collateral.transferFrom(msg.sender, address(this), usdcAmount)) revert TransferFailed();

        collateral.approve(address(ctf), usdcAmount);
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.splitPosition(collateral, bytes32(0), conditionId, partition, usdcAmount);

        uint256 additionalTokens = usdcAmount;
        pool.yesReserve    += additionalTokens;
        pool.noReserve     += additionalTokens;
        pool.usdcCollateral += usdcAmount;
        pool.lpTotalDeposited += usdcAmount;

        emit LiquidityAdded(conditionId, msg.sender, usdcAmount, additionalTokens);
    }

    /**
     * @notice LP owner removes liquidity from an existing pool.
     */
    function removeLiquidity(bytes32 conditionId, uint256 usdcAmount)
        external
        nonReentrant
        poolExists(conditionId)
        notResolved(conditionId)
    {
        Pool storage pool = pools[conditionId];
        if (msg.sender != pool.lpOwner) revert NotLPOwner();
        if (usdcAmount == 0) revert AmountZero();
        if (usdcAmount > pool.usdcCollateral) revert InsufficientLiquidity();

        uint256 tokensToRemove = usdcAmount;
        if (tokensToRemove > pool.yesReserve) revert InsufficientReserve(0, tokensToRemove);
        if (tokensToRemove > pool.noReserve)  revert InsufficientReserve(1, tokensToRemove);

        pool.yesReserve     -= tokensToRemove;
        pool.noReserve      -= tokensToRemove;
        pool.usdcCollateral -= usdcAmount;

        // Merge YES+NO tokens back into USDC via CTF
        _approveERC1155ForCTF();
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.mergePositions(collateral, bytes32(0), conditionId, partition, tokensToRemove);

        if (!collateral.transfer(msg.sender, usdcAmount)) revert TransferFailed();

        pool.lpTotalWithdrawn += usdcAmount;

        emit LiquidityRemoved(conditionId, msg.sender, usdcAmount, tokensToRemove);
    }

    /**
     * @notice LP owner withdraws trading revenue and redeems AMM-held reserves after resolution.
     * @dev Wallet-held locked seed tokens must still be redeemed via CTF.redeemPositions by the LP.
     */
    function withdrawAfterResolution(bytes32 conditionId)
        external
        nonReentrant
        poolExists(conditionId)
    {
        Pool storage pool = pools[conditionId];
        if (msg.sender != pool.lpOwner) revert NotLPOwner();
        if (!pool.resolved) revert PoolNotResolved();

        uint256 totalOut = pool.lpTradingRevenue;
        pool.lpTradingRevenue = 0;

        uint256 redeemed = _redeemPoolReserves(conditionId, pool);
        totalOut += redeemed;

        if (totalOut > 0) {
            if (!collateral.transfer(msg.sender, totalOut)) revert TransferFailed();
            pool.lpTotalWithdrawn += totalOut;
        }
    }

    ////////////////////////////////////////////////////
    // Trading
    ////////////////////////////////////////////////////

    /**
     * @notice Buys outcome tokens with USDC.
     * @dev Caller must have approved this contract for `maxUsdcIn` USDC.
     * @param conditionId    The pool's conditionId.
     * @param outcome        0 = YES, 1 = NO.
     * @param tokenAmount    Number of outcome tokens to buy (18 decimals).
     * @param maxUsdcIn      Maximum USDC willing to pay (slippage protection).
     */
    function buyTokens(
        bytes32 conditionId,
        uint256 outcome,
        uint256 tokenAmount,
        uint256 maxUsdcIn
    ) external nonReentrant poolExists(conditionId) notResolved(conditionId) {
        if (tokenAmount == 0) revert AmountZero();
        Pool storage pool = pools[conditionId];

        uint256 usdcCost = getBuyPrice(conditionId, outcome, tokenAmount);
        if (usdcCost > maxUsdcIn) revert WrongUsdcAmount();

        // Check reserve
        (uint256 targetReserve,) = _getReserves(pool, outcome);
        if (tokenAmount > targetReserve) revert InsufficientReserve(outcome, tokenAmount);

        // Collect USDC from buyer
        if (!collateral.transferFrom(msg.sender, address(this), usdcCost)) revert TransferFailed();
        pool.lpTradingRevenue += usdcCost;

        // Deduct from reserve
        if (outcome == 0) pool.yesReserve -= tokenAmount;
        else                pool.noReserve  -= tokenAmount;

        // Transfer outcome tokens to buyer
        uint256 tokenId = outcome == 0 ? pool.yesTokenId : pool.noTokenId;
        ctf.safeTransferFrom(address(this), msg.sender, tokenId, tokenAmount, "");

        emit TokensBought(conditionId, msg.sender, outcome, tokenAmount, usdcCost);
    }

    /**
     * @notice Sells outcome tokens for USDC.
     * @dev Caller must have called ctf.setApprovalForAll(ammAddress, true) first.
     * @param conditionId   The pool's conditionId.
     * @param outcome       0 = YES, 1 = NO.
     * @param tokenAmount   Number of outcome tokens to sell.
     * @param minUsdcOut    Minimum USDC to receive (slippage protection).
     */
    function sellTokens(
        bytes32 conditionId,
        uint256 outcome,
        uint256 tokenAmount,
        uint256 minUsdcOut
    ) external nonReentrant poolExists(conditionId) notResolved(conditionId) {
        if (tokenAmount == 0) revert AmountZero();
        Pool storage pool = pools[conditionId];

        uint256 usdcPayout = getSellPrice(conditionId, outcome, tokenAmount);
        if (usdcPayout < minUsdcOut) revert InsufficientLiquidity();
        if (usdcPayout > pool.lpTradingRevenue) revert InsufficientLiquidity();

        // Receive outcome tokens from seller
        uint256 tokenId = outcome == 0 ? pool.yesTokenId : pool.noTokenId;
        ctf.safeTransferFrom(msg.sender, address(this), tokenId, tokenAmount, "");

        pool.lpTradingRevenue -= usdcPayout;
        if (outcome == 0) pool.yesReserve += tokenAmount;
        else               pool.noReserve  += tokenAmount;

        if (!collateral.transfer(msg.sender, usdcPayout)) revert TransferFailed();

        emit TokensSold(conditionId, msg.sender, outcome, tokenAmount, usdcPayout);
    }

    ////////////////////////////////////////////////////
    // Resolution Hook
    ////////////////////////////////////////////////////

    /**
     * @notice Marks a pool as resolved so trading is disabled.
     * @dev Anyone can call this once the CTF condition has been resolved.
     *      The actual payout distribution happens via ctf.redeemPositions().
     */
    function markResolved(bytes32 conditionId) external poolExists(conditionId) {
        Pool storage pool = pools[conditionId];
        if (pool.resolved) return;
        // Verify CTF has resolved: payoutDenominator > 0
        require(ctf.payoutDenominator(conditionId) > 0, "AMM: CTF not resolved yet");
        pool.resolved = true;
        emit PoolResolved(conditionId);
    }

    ////////////////////////////////////////////////////
    // Price View Functions (preserve original algorithm)
    ////////////////////////////////////////////////////

    /**
     * @notice Calculate USDC cost to buy `tokenAmount` outcome tokens.
     *  Preserves the original probability-weighted price model.
     */
    function getBuyPrice(bytes32 conditionId, uint256 outcome, uint256 tokenAmount)
        public
        view
        poolExists(conditionId)
        returns (uint256)
    {
        return _calculatePrice(conditionId, outcome, tokenAmount, false);
    }

    /**
     * @notice Calculate USDC received for selling `tokenAmount` outcome tokens.
     */
    function getSellPrice(bytes32 conditionId, uint256 outcome, uint256 tokenAmount)
        public
        view
        poolExists(conditionId)
        returns (uint256)
    {
        return _calculatePrice(conditionId, outcome, tokenAmount, true);
    }

    /**
     * @notice Returns current implied probability of YES outcome (scaled by PRECISION).
     */
    function getYesProbability(bytes32 conditionId) external view poolExists(conditionId) returns (uint256) {
        Pool storage pool = pools[conditionId];
        // Total supply per token side = collateral amount
        // Probability ≈ yesSold / (yesSold + noSold)
        uint256 totalSupplyApprox = pool.usdcCollateral;
        uint256 yesSold = totalSupplyApprox - pool.yesReserve;
        uint256 noSold  = totalSupplyApprox - pool.noReserve;
        uint256 total   = yesSold + noSold;
        if (total == 0) return PRECISION / 2;
        return (yesSold * PRECISION) / total;
    }

    ////////////////////////////////////////////////////
    // Internal Pricing (preserved from original AMM)
    ////////////////////////////////////////////////////

    function _calculatePrice(
        bytes32 conditionId,
        uint256 outcome,
        uint256 tradingAmount,
        bool isSelling
    ) private view returns (uint256) {
        if (tradingAmount == 0) return 0;

        Pool storage pool = pools[conditionId];
        (uint256 targetReserve, uint256 otherReserve) = _getReserves(pool, outcome);

        // Total supply per token side = collateral amount
        uint256 totalSupply = pool.usdcCollateral;

        uint256 targetSold = totalSupply - targetReserve;
        uint256 otherSold  = totalSupply - otherReserve;

        uint256 totalSoldBefore = targetSold + otherSold;
        uint256 probabilityBefore = _probability(targetSold, totalSoldBefore);

        uint256 targetSoldAfter;
        uint256 totalSoldAfter;

        if (isSelling) {
            if (targetSold < tradingAmount) revert InsufficientReserve(outcome, tradingAmount);
            targetSoldAfter = targetSold - tradingAmount;
            totalSoldAfter  = totalSoldBefore - tradingAmount;
        } else {
            if (targetReserve < tradingAmount) revert InsufficientReserve(outcome, tradingAmount);
            targetSoldAfter = targetSold + tradingAmount;
            totalSoldAfter  = totalSoldBefore + tradingAmount;
        }

        uint256 probabilityAfter = _probability(targetSoldAfter, totalSoldAfter);
        uint256 probabilityAvg   = (probabilityBefore + probabilityAfter) / 2;

        return (probabilityAvg * tradingAmount) / PRECISION;
    }

    function _getReserves(Pool storage pool, uint256 outcome)
        private
        view
        returns (uint256 targetReserve, uint256 otherReserve)
    {
        if (outcome == 0) return (pool.yesReserve, pool.noReserve);
        return (pool.noReserve, pool.yesReserve);
    }

    function _probability(uint256 sold, uint256 total) private pure returns (uint256) {
        if (total == 0) return 0;
        return (sold * PRECISION) / total;
    }

    ////////////////////////////////////////////////////
    // ERC-1155 Receiver
    ////////////////////////////////////////////////////

    function _approveERC1155ForCTF() private {
        // CTF needs approval to burn position tokens during mergePositions
        if (!IERC1155(address(ctf)).isApprovedForAll(address(this), address(ctf))) {
            IERC1155(address(ctf)).setApprovalForAll(address(ctf), true);
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC1155Receiver).interfaceId;
    }

    ////////////////////////////////////////////////////
    // LP valuation views
    ////////////////////////////////////////////////////

    /**
     * @notice Mark-to-market (open) or redemption value (resolved) of AMM-held YES/NO reserves.
     */
    function getPoolInventoryValue(bytes32 conditionId) public view poolExists(conditionId) returns (uint256) {
        Pool storage pool = pools[conditionId];
        return
            _positionValue(conditionId, pool.yesReserve, 0) + _positionValue(conditionId, pool.noReserve, 1);
    }

    /**
     * @notice Redemption value of an LP wallet's YES/NO balances for this pool.
     */
    function getLpWalletInventoryValue(bytes32 conditionId, address lp)
        public
        view
        poolExists(conditionId)
        returns (uint256)
    {
        Pool storage pool = pools[conditionId];
        uint256 yesBal = IERC1155(address(ctf)).balanceOf(lp, pool.yesTokenId);
        uint256 noBal = IERC1155(address(ctf)).balanceOf(lp, pool.noTokenId);
        return _positionValue(conditionId, yesBal, 0) + _positionValue(conditionId, noBal, 1);
    }

    /**
     * @notice Estimated net asset value attributable to the LP (revenue + pool + wallet inventory).
     */
    function getLpNav(bytes32 conditionId) external view poolExists(conditionId) returns (uint256) {
        Pool storage pool = pools[conditionId];
        return
            pool.lpTradingRevenue +
            getPoolInventoryValue(conditionId) +
            getLpWalletInventoryValue(conditionId, pool.lpOwner);
    }

    /**
     * @notice LP PnL snapshot: nav + prior withdrawals minus total deposits.
     */
    function getLpPnLSummary(bytes32 conditionId) external view poolExists(conditionId) returns (LpPnLSummary memory) {
        Pool storage pool = pools[conditionId];
        uint256 poolInv = getPoolInventoryValue(conditionId);
        uint256 walletInv = getLpWalletInventoryValue(conditionId, pool.lpOwner);
        uint256 nav = pool.lpTradingRevenue + poolInv + walletInv;
        int256 netPnl = int256(nav + pool.lpTotalWithdrawn) - int256(pool.lpTotalDeposited);

        return LpPnLSummary({
            totalDeposited: pool.lpTotalDeposited,
            totalWithdrawn: pool.lpTotalWithdrawn,
            tradingRevenue: pool.lpTradingRevenue,
            poolInventory: poolInv,
            walletInventory: walletInv,
            nav: nav,
            netPnl: netPnl
        });
    }

    ////////////////////////////////////////////////////
    // View
    ////////////////////////////////////////////////////

    function getPool(bytes32 conditionId) external view returns (Pool memory) {
        return pools[conditionId];
    }

    function getAllPools() external view returns (bytes32[] memory) {
        return allPools;
    }

    ////////////////////////////////////////////////////
    // Internal LP valuation & redemption
    ////////////////////////////////////////////////////

    function _positionValue(bytes32 conditionId, uint256 balance, uint256 outcomeIndex)
        private
        view
        returns (uint256)
    {
        if (balance == 0) return 0;

        uint256 denominator = ctf.payoutDenominator(conditionId);
        if (denominator > 0) {
            return _redeemValueAtResolution(conditionId, balance, outcomeIndex, denominator);
        }

        return getSellPrice(conditionId, outcomeIndex, balance);
    }

    function _redeemValueAtResolution(
        bytes32 conditionId,
        uint256 balance,
        uint256 outcomeIndex,
        uint256 denominator
    ) private view returns (uint256) {
        uint256 numerator = ctf.payoutNumerators(conditionId, outcomeIndex);
        return (balance * numerator) / denominator;
    }

    /**
     * @dev Redeems all AMM-held YES/NO reserves and returns collateral received.
     */
    function _redeemPoolReserves(bytes32 conditionId, Pool storage pool) private returns (uint256) {
        uint256 yesBal = pool.yesReserve;
        uint256 noBal = pool.noReserve;
        if (yesBal == 0 && noBal == 0) return 0;

        require(ctf.payoutDenominator(conditionId) > 0, "AMM: CTF not resolved");

        uint256 balBefore = collateral.balanceOf(address(this));

        uint256 indexSetCount = (yesBal > 0 ? 1 : 0) + (noBal > 0 ? 1 : 0);
        uint256[] memory indexSets = new uint256[](indexSetCount);
        uint256 idx = 0;
        if (yesBal > 0) indexSets[idx++] = 1;
        if (noBal > 0) indexSets[idx] = 2;

        ctf.redeemPositions(collateral, bytes32(0), conditionId, indexSets);

        pool.yesReserve = 0;
        pool.noReserve = 0;

        return collateral.balanceOf(address(this)) - balBefore;
    }
}
