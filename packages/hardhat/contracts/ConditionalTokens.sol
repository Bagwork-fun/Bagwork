// SPDX-License-Identifier: LGPL-3.0
// Adapted from Gnosis Conditional Token Framework for Solidity ^0.8.0
// Original: https://github.com/gnosis/conditional-tokens-contracts
pragma solidity ^0.8.0;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/**
 * @title ConditionalTokens
 * @notice Core Gnosis Conditional Token Framework — markets are conditionIds, not deployed contracts.
 * @dev Ported from Gnosis CTF (^0.5.1) to Solidity ^0.8.0 (SafeMath removed, native overflow).
 * ERC-1155 position IDs are derived deterministically from collateral + conditionId + indexSet.
 */
contract ConditionalTokens is ERC1155 {
    /////////////////////////////
    // Events
    /////////////////////////////

    /// @dev Emitted on prepareCondition()
    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount
    );

    /// @dev Emitted on reportPayouts()
    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint256 outcomeSlotCount,
        uint256[] payoutNumerators
    );

    /// @dev Emitted on splitPosition()
    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    /// @dev Emitted on mergePositions()
    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint256[] partition,
        uint256 amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 conditionId,
        uint256[] indexSets,
        uint256 payout
    );

    /////////////////////////////
    // State
    /////////////////////////////

    /// @notice Payout numerators per conditionId. Empty = not prepared.
    mapping(bytes32 => uint256[]) public payoutNumerators;

    /// @notice Payout denominator; nonzero = condition resolved.
    mapping(bytes32 => uint256) public payoutDenominator;

    constructor() ERC1155("") {}

    /////////////////////////////
    // Core Functions
    /////////////////////////////

    /**
     * @notice Registers a new condition (market) on-chain.
     * @param oracle         The address that will call reportPayouts() for this condition.
     * @param questionId     Unique question identifier (keccak256 of IPFS CID).
     * @param outcomeSlotCount Number of outcomes (2 for binary YES/NO).
     */
    function prepareCondition(address oracle, bytes32 questionId, uint256 outcomeSlotCount) external {
        require(outcomeSlotCount <= 256, "CTF: too many outcome slots");
        require(outcomeSlotCount > 1, "CTF: need more than one outcome slot");
        bytes32 conditionId = getConditionId(oracle, questionId, outcomeSlotCount);
        require(payoutNumerators[conditionId].length == 0, "CTF: condition already prepared");
        payoutNumerators[conditionId] = new uint256[](outcomeSlotCount);
        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    /**
     * @notice Called by the oracle to resolve a condition.
     * @param questionId  The question ID the oracle is answering.
     * @param payouts     Array of payout numerators per outcome slot.
     */
    function reportPayouts(bytes32 questionId, uint256[] calldata payouts) external {
        uint256 outcomeSlotCount = payouts.length;
        require(outcomeSlotCount > 1, "CTF: need more than one outcome slot");
        bytes32 conditionId = getConditionId(msg.sender, questionId, outcomeSlotCount);
        require(payoutNumerators[conditionId].length == outcomeSlotCount, "CTF: condition not prepared");
        require(payoutDenominator[conditionId] == 0, "CTF: already resolved");

        uint256 den = 0;
        for (uint256 i = 0; i < outcomeSlotCount; i++) {
            uint256 num = payouts[i];
            den += num;
            require(payoutNumerators[conditionId][i] == 0, "CTF: numerator already set");
            payoutNumerators[conditionId][i] = num;
        }
        require(den > 0, "CTF: all-zero payout");
        payoutDenominator[conditionId] = den;
        emit ConditionResolution(conditionId, msg.sender, questionId, outcomeSlotCount, payoutNumerators[conditionId]);
    }

    /**
     * @notice Splits a collateral position into outcome positions.
     * @param collateralToken  ERC-20 used as collateral (e.g. USDC).
     * @param parentCollectionId  bytes32(0) for root positions.
     * @param conditionId      The condition to split on.
     * @param partition        Array of disjoint index sets.
     * @param amount           Amount of collateral to lock.
     */
    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(partition.length > 1, "CTF: need at least 2 partition elements");
        uint256 outcomeSlotCount = payoutNumerators[conditionId].length;
        require(outcomeSlotCount > 0, "CTF: condition not prepared");

        uint256 fullIndexSet = (1 << outcomeSlotCount) - 1;
        uint256 freeIndexSet = fullIndexSet;
        uint256[] memory positionIds = new uint256[](partition.length);
        uint256[] memory amounts = new uint256[](partition.length);

        for (uint256 i = 0; i < partition.length; i++) {
            uint256 indexSet = partition[i];
            require(indexSet > 0 && indexSet < fullIndexSet, "CTF: invalid index set");
            require((indexSet & freeIndexSet) == indexSet, "CTF: partition not disjoint");
            freeIndexSet ^= indexSet;
            positionIds[i] = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, indexSet));
            amounts[i] = amount;
        }

        if (freeIndexSet == 0) {
            if (parentCollectionId == bytes32(0)) {
                require(collateralToken.transferFrom(msg.sender, address(this), amount), "CTF: collateral transfer failed");
            } else {
                _burn(msg.sender, getPositionId(collateralToken, parentCollectionId), amount);
            }
        } else {
            _burn(
                msg.sender,
                getPositionId(
                    collateralToken,
                    getCollectionId(parentCollectionId, conditionId, fullIndexSet ^ freeIndexSet)
                ),
                amount
            );
        }

        _mintBatch(msg.sender, positionIds, amounts, "");
        emit PositionSplit(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    /**
     * @notice Merges outcome positions back into collateral.
     */
    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata partition,
        uint256 amount
    ) external {
        require(partition.length > 1, "CTF: need at least 2 partition elements");
        uint256 outcomeSlotCount = payoutNumerators[conditionId].length;
        require(outcomeSlotCount > 0, "CTF: condition not prepared");

        uint256 fullIndexSet = (1 << outcomeSlotCount) - 1;
        uint256 freeIndexSet = fullIndexSet;
        uint256[] memory positionIds = new uint256[](partition.length);
        uint256[] memory amounts = new uint256[](partition.length);

        for (uint256 i = 0; i < partition.length; i++) {
            uint256 indexSet = partition[i];
            require(indexSet > 0 && indexSet < fullIndexSet, "CTF: invalid index set");
            require((indexSet & freeIndexSet) == indexSet, "CTF: partition not disjoint");
            freeIndexSet ^= indexSet;
            positionIds[i] = getPositionId(collateralToken, getCollectionId(parentCollectionId, conditionId, indexSet));
            amounts[i] = amount;
        }

        _burnBatch(msg.sender, positionIds, amounts);

        if (freeIndexSet == 0) {
            if (parentCollectionId == bytes32(0)) {
                require(collateralToken.transfer(msg.sender, amount), "CTF: collateral return failed");
            } else {
                _mint(msg.sender, getPositionId(collateralToken, parentCollectionId), amount, "");
            }
        } else {
            _mint(
                msg.sender,
                getPositionId(
                    collateralToken,
                    getCollectionId(parentCollectionId, conditionId, fullIndexSet ^ freeIndexSet)
                ),
                amount,
                ""
            );
        }

        emit PositionsMerge(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    /**
     * @notice Redeems winning outcome positions for collateral after resolution.
     */
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint256[] calldata indexSets
    ) external {
        uint256 den = payoutDenominator[conditionId];
        require(den > 0, "CTF: condition not resolved");
        uint256 outcomeSlotCount = payoutNumerators[conditionId].length;
        require(outcomeSlotCount > 0, "CTF: condition not prepared");

        uint256 totalPayout = 0;
        uint256 fullIndexSet = (1 << outcomeSlotCount) - 1;

        for (uint256 i = 0; i < indexSets.length; i++) {
            uint256 indexSet = indexSets[i];
            require(indexSet > 0 && indexSet < fullIndexSet, "CTF: invalid index set");
            uint256 positionId = getPositionId(
                collateralToken,
                getCollectionId(parentCollectionId, conditionId, indexSet)
            );

            uint256 payoutNumerator = 0;
            for (uint256 j = 0; j < outcomeSlotCount; j++) {
                if (indexSet & (1 << j) != 0) {
                    payoutNumerator += payoutNumerators[conditionId][j];
                }
            }

            uint256 payoutStake = balanceOf(msg.sender, positionId);
            if (payoutStake > 0) {
                totalPayout += (payoutStake * payoutNumerator) / den;
                _burn(msg.sender, positionId, payoutStake);
            }
        }

        if (totalPayout > 0) {
            if (parentCollectionId == bytes32(0)) {
                require(collateralToken.transfer(msg.sender, totalPayout), "CTF: payout transfer failed");
            } else {
                _mint(msg.sender, getPositionId(collateralToken, parentCollectionId), totalPayout, "");
            }
        }

        emit PayoutRedemption(msg.sender, collateralToken, parentCollectionId, conditionId, indexSets, totalPayout);
    }

    /////////////////////////////
    // View Helpers
    /////////////////////////////

    /// @notice Returns number of outcome slots, or 0 if not prepared.
    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint256) {
        return payoutNumerators[conditionId].length;
    }

    /// @notice conditionId = keccak256(oracle, questionId, outcomeSlotCount)
    function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    /// @notice collectionId = keccak256(parentCollectionId ^ keccak256(conditionId, indexSet))
    function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet)
        public
        pure
        returns (bytes32)
    {
        return bytes32(uint256(keccak256(abi.encodePacked(conditionId, indexSet))) + uint256(parentCollectionId));
    }

    /// @notice positionId = keccak256(collateralToken, collectionId)
    function getPositionId(IERC20 collateralToken, bytes32 collectionId) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }
}
