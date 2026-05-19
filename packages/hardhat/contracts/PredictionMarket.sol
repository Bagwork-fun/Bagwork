//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { PredictionMarketToken } from "./PredictionMarketToken.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

contract PredictionMarket is Ownable {
    /////////////////
    /// Errors //////
    /////////////////

    error PredictionMarket__MustProvideETHForInitialLiquidity();
    error PredictionMarket__InvalidProbability();
    error PredictionMarket__PredictionAlreadyReported();
    error PredictionMarket__OnlyOracleCanReport();
    error PredictionMarket__OwnerCannotCall();
    error PredictionMarket__PredictionNotReported();
    error PredictionMarket__InsufficientWinningTokens();
    error PredictionMarket__AmountMustBeGreaterThanZero();
    error PredictionMarket__MustSendExactETHAmount();
    error PredictionMarket__InsufficientTokenReserve(Outcome _outcome, uint256 _amountToken);
    error PredictionMarket__TokenTransferFailed();
    error PredictionMarket__ETHTransferFailed();
    error PredictionMarket__InsufficientBalance(uint256 _tradingAmount, uint256 _userBalance);
    error PredictionMarket__InsufficientAllowance(uint256 _tradingAmount, uint256 _allowance);
    error PredictionMarket__InsufficientLiquidity();
    error PredictionMarket__InvalidPercentageToLock();

    //////////////////////////
    /// State Variables //////
    //////////////////////////

    enum Outcome {
        YES,
        NO
    }

    uint256 private constant PRECISION = 1e18;

    /// Checkpoint 2 ///

    // Immutable variables (set once in constructor)
    address public immutable i_oracle;
    string public s_question;
    uint256 public immutable i_initialTokenValue;
    uint8 public immutable i_initialYesProbability;
    uint8 public immutable i_percentageLocked;

    // State variables
    uint256 public s_ethCollateral;
    uint256 public s_lpTradingRevenue;

    /// Checkpoint 3 ///

    // Token contracts
    PredictionMarketToken public immutable i_yesToken;
    PredictionMarketToken public immutable i_noToken;

    /// Checkpoint 5 ///

    // Oracle state variables
    bool public s_isReported;
    PredictionMarketToken public s_winningToken;

    /////////////////////////
    /// Events //////
    /////////////////////////

    event TokensPurchased(address indexed buyer, Outcome outcome, uint256 amount, uint256 ethAmount);
    event TokensSold(address indexed seller, Outcome outcome, uint256 amount, uint256 ethAmount);
    event WinningTokensRedeemed(address indexed redeemer, uint256 amount, uint256 ethAmount);
    event MarketReported(address indexed oracle, Outcome winningOutcome, address winningToken);
    event MarketResolved(address indexed resolver, uint256 totalEthToSend);
    event LiquidityAdded(address indexed provider, uint256 ethAmount, uint256 tokensAmount);
    event LiquidityRemoved(address indexed provider, uint256 ethAmount, uint256 tokensAmount);

    /////////////////
    /// Modifiers ///
    /////////////////

    /// Checkpoint 5 ///

    modifier predictionNotReported() {
        if (s_isReported) {
            revert PredictionMarket__PredictionAlreadyReported();
        }
        _;
    }

    /// Checkpoint 6 ///

    modifier predictionReported() {
        if (!s_isReported) {
            revert PredictionMarket__PredictionNotReported();
        }
        _;
    }

    /// Checkpoint 8 ///

    modifier amountGreaterThanZero(uint256 _amount) {
        if (_amount == 0) {
            revert PredictionMarket__AmountMustBeGreaterThanZero();
        }
        _;
    }

    modifier notOwner() {
        if (msg.sender == owner()) {
            revert PredictionMarket__OwnerCannotCall();
        }
        _;
    }

    //////////////////
    ////Constructor///
    //////////////////

    constructor(
        address _liquidityProvider,
        address _oracle,
        string memory _question,
        uint256 _initialTokenValue,
        uint8 _initialYesProbability,
        uint8 _percentageToLock
    ) payable Ownable(_liquidityProvider) {
        /// Checkpoint 2 ////
        // Validate inputs
        if (msg.value == 0) {
            revert PredictionMarket__MustProvideETHForInitialLiquidity();
        }

        if (_initialYesProbability == 0 || _initialYesProbability >= 100) {
            revert PredictionMarket__InvalidProbability();
        }

        if (_percentageToLock == 0 || _percentageToLock >= 100) {
            revert PredictionMarket__InvalidPercentageToLock();
        }

        // Set immutable variables
        i_oracle = _oracle;
        i_initialTokenValue = _initialTokenValue;
        i_initialYesProbability = _initialYesProbability;
        i_percentageLocked = _percentageToLock;

        // Set state variables
        s_question = _question;
        s_ethCollateral = msg.value;
        s_lpTradingRevenue = 0;
        s_isReported = false;

        /// Checkpoint 3 ////
        // Calculate initial token amount based on ETH sent (accounting for ERC20 decimals)
        uint256 initialTokenAmount = (msg.value * PRECISION) / _initialTokenValue;

        // Deploy the Yes and No token contracts
        i_yesToken = new PredictionMarketToken("Yes", "Y", _liquidityProvider, initialTokenAmount);
        i_noToken = new PredictionMarketToken("No", "N", _liquidityProvider, initialTokenAmount);

        // Calculate locked tokens to simulate initial probability
        uint256 lockedYes = (initialTokenAmount * _initialYesProbability * _percentageToLock * 2) / 10000;
        uint256 lockedNo = (initialTokenAmount * (100 - _initialYesProbability) * _percentageToLock * 2) / 10000;

        // Transfer locked tokens to the liquidity provider to simulate initial probability
        // The locked tokens stay with the liquidity provider (not available for trading)
        i_yesToken.transfer(_liquidityProvider, lockedYes);
        i_noToken.transfer(_liquidityProvider, lockedNo);
    }

    /////////////////
    /// Functions ///
    /////////////////

    /**
     * @notice Add liquidity to the prediction market and mint tokens
     * @dev Only the owner can add liquidity and only if the prediction is not reported
     */
    function addLiquidity() external payable onlyOwner predictionNotReported {
        //// Checkpoint 4 ////
        if (msg.value == 0) {
            revert PredictionMarket__MustProvideETHForInitialLiquidity();
        }

        // Calculate additional token amount based on ETH sent
        uint256 additionalTokenAmount = (msg.value * PRECISION) / i_initialTokenValue;

        // Mint additional tokens to the contract
        i_yesToken.mint(address(this), additionalTokenAmount);
        i_noToken.mint(address(this), additionalTokenAmount);

        // Update collateral
        s_ethCollateral += msg.value;

        emit LiquidityAdded(msg.sender, msg.value, additionalTokenAmount);
    }

    /**
     * @notice Remove liquidity from the prediction market and burn respective tokens, if you remove liquidity before prediction ends you got no share of lpReserve
     * @dev Only the owner can remove liquidity and only if the prediction is not reported
     * @param _ethToWithdraw Amount of ETH to withdraw from liquidity pool
     */
    function removeLiquidity(uint256 _ethToWithdraw) external onlyOwner predictionNotReported {
        //// Checkpoint 4 ////
        if (_ethToWithdraw == 0) {
            revert PredictionMarket__AmountMustBeGreaterThanZero();
        }

        // Calculate tokens to burn based on ETH being withdrawn
        uint256 tokensToRemove = (_ethToWithdraw * PRECISION) / i_initialTokenValue;

        // Check if contract has enough tokens to burn first
        if (tokensToRemove > i_yesToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(Outcome.YES, tokensToRemove);
        }
        if (tokensToRemove > i_noToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(Outcome.NO, tokensToRemove);
        }

        if (_ethToWithdraw > s_ethCollateral) {
            revert PredictionMarket__InsufficientLiquidity();
        }

        // Burn tokens from contract
        i_yesToken.burn(address(this), tokensToRemove);
        i_noToken.burn(address(this), tokensToRemove);

        // Update collateral
        s_ethCollateral -= _ethToWithdraw;

        // Transfer ETH to owner
        (bool success, ) = payable(msg.sender).call{value: _ethToWithdraw}("");
        if (!success) {
            revert PredictionMarket__ETHTransferFailed();
        }

        emit LiquidityRemoved(msg.sender, _ethToWithdraw, tokensToRemove);
    }

    /**
     * @notice Report the winning outcome for the prediction
     * @dev Only the oracle can report the winning outcome and only if the prediction is not reported
     * @param _winningOutcome The winning outcome (YES or NO)
     */
    function report(Outcome _winningOutcome) external predictionNotReported {
        //// Checkpoint 5 ////
        if (msg.sender != i_oracle) {
            revert PredictionMarket__OnlyOracleCanReport();
        }

        // Set the winning outcome
        s_isReported = true;

        if (_winningOutcome == Outcome.YES) {
            s_winningToken = i_yesToken;
        } else {
            s_winningToken = i_noToken;
        }

        emit MarketReported(msg.sender, _winningOutcome, address(s_winningToken));
    }

    /**
     * @notice Owner of contract can redeem winning tokens held by the contract after prediction is resolved and get ETH from the contract including LP revenue and collateral back
     * @dev Only callable by the owner and only if the prediction is resolved
     * @return ethRedeemed The amount of ETH redeemed
     */
    function resolveMarketAndWithdraw() external onlyOwner predictionReported returns (uint256 ethRedeemed) {
        /// Checkpoint 6 ////
        // Get the winning token balance held by the contract
        uint256 winningTokenBalance = s_winningToken.balanceOf(address(this));

        // Calculate ETH value of winning tokens
        uint256 winningTokenValue = (winningTokenBalance * i_initialTokenValue) / PRECISION;

        // Burn the winning tokens held by the contract
        if (winningTokenBalance > 0) {
            s_winningToken.burn(address(this), winningTokenBalance);
        }

        // Calculate total ETH to send: winning token value + trading revenue
        ethRedeemed = winningTokenValue + s_lpTradingRevenue;

        // Reset state variables
        s_ethCollateral = 0;
        s_lpTradingRevenue = 0;

        // Transfer ETH to owner
        (bool success, ) = payable(msg.sender).call{value: ethRedeemed}("");
        if (!success) {
            revert PredictionMarket__ETHTransferFailed();
        }

        emit MarketResolved(msg.sender, ethRedeemed);
    }

    /**
     * @notice Buy prediction outcome tokens with ETH, need to call priceInETH function first to get right amount of tokens to buy
     * @param _outcome The possible outcome (YES or NO) to buy tokens for
     * @param _amountTokenToBuy Amount of tokens to purchase
     */
    function buyTokensWithETH(Outcome _outcome, uint256 _amountTokenToBuy) external payable predictionNotReported amountGreaterThanZero(_amountTokenToBuy) notOwner {
        /// Checkpoint 8 ////
        // Check if contract has enough tokens to sell
        PredictionMarketToken targetToken = _outcome == Outcome.YES ? i_yesToken : i_noToken;
        if (_amountTokenToBuy > targetToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(_outcome, _amountTokenToBuy);
        }

        // Check if ETH sent matches the exact price
        uint256 expectedPrice = getBuyPriceInEth(_outcome, _amountTokenToBuy);
        if (msg.value != expectedPrice) {
            revert PredictionMarket__MustSendExactETHAmount();
        }

        // Update trading revenue
        s_lpTradingRevenue += msg.value;

        // Transfer tokens to buyer
        bool success = targetToken.transfer(msg.sender, _amountTokenToBuy);
        if (!success) {
            revert PredictionMarket__TokenTransferFailed();
        }

        emit TokensPurchased(msg.sender, _outcome, _amountTokenToBuy, msg.value);
    }

    /**
     * @notice Sell prediction outcome tokens for ETH, need to call priceInETH function first to get right amount of tokens to buy
     * @param _outcome The possible outcome (YES or NO) to sell tokens for
     * @param _tradingAmount The amount of tokens to sell
     */
    function sellTokensForEth(Outcome _outcome, uint256 _tradingAmount) external predictionNotReported amountGreaterThanZero(_tradingAmount) notOwner {
        /// Checkpoint 8 ////
        PredictionMarketToken targetToken = _outcome == Outcome.YES ? i_yesToken : i_noToken;

        // Check if user has enough tokens to sell
        if (_tradingAmount > targetToken.balanceOf(msg.sender)) {
            revert PredictionMarket__InsufficientBalance(_tradingAmount, targetToken.balanceOf(msg.sender));
        }

        // Check if user has approved the contract to transfer their tokens
        if (_tradingAmount > targetToken.allowance(msg.sender, address(this))) {
            revert PredictionMarket__InsufficientAllowance(_tradingAmount, targetToken.allowance(msg.sender, address(this)));
        }

        // Calculate ETH to pay using sell price
        uint256 ethToPay = getSellPriceInEth(_outcome, _tradingAmount);

        // Check if contract has enough ETH to pay out
        if (ethToPay > s_lpTradingRevenue) {
            revert PredictionMarket__InsufficientLiquidity();
        }

        // Deduct ETH from trading revenue
        s_lpTradingRevenue -= ethToPay;

        // Transfer tokens from user to contract
        bool transferSuccess = targetToken.transferFrom(msg.sender, address(this), _tradingAmount);
        if (!transferSuccess) {
            revert PredictionMarket__TokenTransferFailed();
        }

        // Transfer ETH to seller
        (bool ethSuccess, ) = payable(msg.sender).call{value: ethToPay}("");
        if (!ethSuccess) {
            revert PredictionMarket__ETHTransferFailed();
        }

        emit TokensSold(msg.sender, _outcome, _tradingAmount, ethToPay);
    }

    /**
     * @notice Redeem winning tokens for ETH after prediction is resolved, winning tokens are burned and user receives ETH
     * @dev Only if the prediction is resolved
     * @param _amount The amount of winning tokens to redeem
     */
    function redeemWinningTokens(uint256 _amount) external predictionReported amountGreaterThanZero(_amount) notOwner {
        /// Checkpoint 9 ////
        // Check if user has winning tokens to redeem
        uint256 userWinningTokens = s_winningToken.balanceOf(msg.sender);
        if (_amount > userWinningTokens) {
            revert PredictionMarket__InsufficientWinningTokens();
        }

        // Calculate ETH payout based on winning tokens
        uint256 ethPayout = (_amount * i_initialTokenValue) / PRECISION;

        // Check if contract has enough ETH collateral to pay out
        if (ethPayout > s_ethCollateral) {
            revert PredictionMarket__InsufficientLiquidity();
        }

        // Subtract from collateral
        s_ethCollateral -= ethPayout;

        // Burn the winning tokens from user
        s_winningToken.burn(msg.sender, _amount);

        // Transfer ETH to user
        (bool success, ) = payable(msg.sender).call{value: ethPayout}("");
        if (!success) {
            revert PredictionMarket__ETHTransferFailed();
        }

        emit WinningTokensRedeemed(msg.sender, _amount, ethPayout);
    }

    /**
     * @notice Calculate the total ETH price for buying tokens
     * @param _outcome The possible outcome (YES or NO) to buy tokens for
     * @param _tradingAmount The amount of tokens to buy
     * @return The total ETH price
     */
    function getBuyPriceInEth(Outcome _outcome, uint256 _tradingAmount) public view returns (uint256) {
        /// Checkpoint 7 ////
        return _calculatePriceInEth(_outcome, _tradingAmount, false);
    }

    /**
     * @notice Calculate the total ETH price for selling tokens
     * @param _outcome The possible outcome (YES or NO) to sell tokens for
     * @param _tradingAmount The amount of tokens to sell
     * @return The total ETH price
     */
    function getSellPriceInEth(Outcome _outcome, uint256 _tradingAmount) public view returns (uint256) {
        /// Checkpoint 7 ////
        return _calculatePriceInEth(_outcome, _tradingAmount, true);
    }

    /////////////////////////
    /// Helper Functions ///
    ////////////////////////

    /**
     * @dev Internal helper to calculate ETH price for both buying and selling
     * @param _outcome The possible outcome (YES or NO)
     * @param _tradingAmount The amount of tokens
     * @param _isSelling Whether this is a sell calculation
     */
    function _calculatePriceInEth(
        Outcome _outcome,
        uint256 _tradingAmount,
        bool _isSelling
    ) private view returns (uint256) {
        /// Checkpoint 7 ////
        if (_tradingAmount == 0) {
            return 0;
        }

        // Get current reserves
        (uint256 targetReserve, uint256 otherReserve) = _getCurrentReserves(_outcome);

        // Calculate current tokens sold (total supply - current reserve)
        uint256 targetTotalSupply = _outcome == Outcome.YES ? i_yesToken.totalSupply() : i_noToken.totalSupply();
        uint256 otherTotalSupply = _outcome == Outcome.YES ? i_noToken.totalSupply() : i_yesToken.totalSupply();

        uint256 targetTokensSold = targetTotalSupply - targetReserve;
        uint256 otherTokensSold = otherTotalSupply - otherReserve;

        // Calculate probability before trade (locked tokens already reflected in the sold amounts)
        uint256 totalSoldBefore = targetTokensSold + otherTokensSold;
        uint256 probabilityBefore = _calculateProbability(targetTokensSold, totalSoldBefore);

        // Calculate probability after trade
        uint256 targetSoldAfter;
        uint256 totalSoldAfter;
        if (_isSelling) {
            // Selling reduces tokens sold (increases reserve)
            if (targetTokensSold >= _tradingAmount) {
                targetSoldAfter = targetTokensSold - _tradingAmount;
                totalSoldAfter = totalSoldBefore - _tradingAmount;
            } else {
                revert PredictionMarket__InsufficientTokenReserve(_outcome, _tradingAmount);
            }
        } else {
            // Buying increases tokens sold (decreases reserve)
            if (targetReserve >= _tradingAmount) {
                targetSoldAfter = targetTokensSold + _tradingAmount;
                totalSoldAfter = totalSoldBefore + _tradingAmount;
            } else {
                revert PredictionMarket__InsufficientLiquidity();
            }
        }

        uint256 probabilityAfter = _calculateProbability(targetSoldAfter, totalSoldAfter);

        // Calculate average probability
        uint256 probabilityAvg = (probabilityBefore + probabilityAfter) / 2;

        // Calculate price: initialTokenValue * probabilityAvg * tradingAmount
        return (i_initialTokenValue * probabilityAvg * _tradingAmount) / (PRECISION * PRECISION);
    }

    /**
     * @dev Internal helper to get the current reserves of the tokens
     * @param _outcome The possible outcome (YES or NO)
     * @return The current reserves of the tokens
     */
    function _getCurrentReserves(Outcome _outcome) private view returns (uint256, uint256) {
        /// Checkpoint 7 ////
        uint256 yesReserve = i_yesToken.balanceOf(address(this));
        uint256 noReserve = i_noToken.balanceOf(address(this));

        if (_outcome == Outcome.YES) {
            return (yesReserve, noReserve);
        } else {
            return (noReserve, yesReserve);
        }
    }

    /**
     * @dev Internal helper to calculate the probability of the tokens
     * @param tokensSold The number of tokens sold
     * @param totalSold The total number of tokens sold
     * @return The probability of the tokens
     */
    function _calculateProbability(uint256 tokensSold, uint256 totalSold) private pure returns (uint256) {
        /// Checkpoint 7 ////
        if (totalSold == 0) {
            return 0;
        }
        return (tokensSold * PRECISION) / totalSold;
    }

    /////////////////////////
    /// Getter Functions ///
    ////////////////////////

    /**
     * @notice Get the prediction details
     */
    function getPrediction()
        external
        view
        returns (
            string memory question,
            string memory outcome1,
            string memory outcome2,
            address oracle,
            uint256 initialTokenValue,
            uint256 yesTokenReserve,
            uint256 noTokenReserve,
            bool isReported,
            address yesToken,
            address noToken,
            address winningToken,
            uint256 ethCollateral,
            uint256 lpTradingRevenue,
            address predictionMarketOwner,
            uint256 initialProbability,
            uint256 percentageLocked
        )
    {
        /// Checkpoint 3 ////
        oracle = i_oracle;
        initialTokenValue = i_initialTokenValue;
        percentageLocked = i_percentageLocked;
        initialProbability = i_initialYesProbability;
        question = s_question;
        ethCollateral = s_ethCollateral;
        lpTradingRevenue = s_lpTradingRevenue;
        predictionMarketOwner = owner();
        yesToken = address(i_yesToken);
        noToken = address(i_noToken);
        outcome1 = i_yesToken.name();
        outcome2 = i_noToken.name();
        yesTokenReserve = i_yesToken.balanceOf(address(this));
        noTokenReserve = i_noToken.balanceOf(address(this));
        /// Checkpoint 5 ////
        isReported = s_isReported;
        winningToken = address(s_winningToken);
    }
}
