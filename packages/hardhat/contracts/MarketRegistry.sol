// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AiCTFAdapter } from "./AiCTFAdapter.sol";

/**
 * @title MarketRegistry
 * @notice Lightweight on-chain registry for CTF prediction markets.
 *
 * @dev Design principles:
 *  - Zero contract deployments per market. Ever.
 *  - `questionId` is the only on-chain key: keccak256(abi.encodePacked(ipfsCid)).
 *  - The ipfsCid is emitted in events only — not stored in contract storage.
 *  - A subgraph can reconstruct full market state from MarketCreated + adapter events.
 */
contract MarketRegistry is Ownable {
    ////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////

    enum MarketStatus { Active, Proposed, Resolved }

    /// @notice Which collateral rail settles this market's CTF positions / AMM pool.
    enum SettlementRail {
        USDC,
        EURC
    }

    struct MarketInfo {
        uint256 outcomeCount;
        uint256 resolutionTime;
        MarketStatus status;
        bool exists;
    }

    ////////////////////////////////////////////////////
    // State
    ////////////////////////////////////////////////////

    /// @notice The AI oracle adapter (AiCTFAdapter)
    AiCTFAdapter public immutable adapter;

    /// @notice questionId → MarketInfo (lightweight — no metadata strings)
    mapping(bytes32 => MarketInfo) public markets;

    /// @notice questionId → settlement rail (immutable after creation)
    mapping(bytes32 => SettlementRail) public marketSettlementRail;

    /// @notice Ordered list of all questionIds for enumeration
    bytes32[] public allMarkets;

    ////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////

    /**
     * @notice Emitted when a new market is created.
     * @dev Indexed on questionId. A subgraph detects this and fetches ipfsCid to get metadata.
     * @param questionId    keccak256(abi.encodePacked(ipfsCid))
     * @param ipfsCid       IPFS CID of the metadata JSON (NOT stored on-chain)
     * @param resolutionTime Unix timestamp for AI resolution
     * @param creator       Address that called createMarket()
     */
    event MarketCreated(
        bytes32 indexed questionId,
        string  ipfsCid,
        uint256 outcomeCount,
        uint256 resolutionTime,
        address indexed creator,
        SettlementRail settlementRail
    );

    event MarketStatusUpdated(bytes32 indexed questionId, MarketStatus newStatus);

    ////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////

    error MarketAlreadyExists(bytes32 questionId);
    error MarketNotFound(bytes32 questionId);
    error InvalidResolutionTime();
    error InvalidOutcomeCount();
    error EmptyCid();

    ////////////////////////////////////////////////////
    // Constructor
    ////////////////////////////////////////////////////

    /**
     * @param _adapter Address of the deployed AiCTFAdapter.
     */
    constructor(address _adapter) Ownable(msg.sender) {
        adapter = AiCTFAdapter(_adapter);
    }

    ////////////////////////////////////////////////////
    // Market Creation
    ////////////////////////////////////////////////////

    /**
     * @notice Creates a new prediction market in a single transaction.
     * @dev Steps:
     *   1. Derive questionId from the IPFS CID.
     *   2. Register market metadata in local storage (no strings, only primitives).
     *   3. Call adapter.initializeMarket() → CTF prepareCondition + CRE event trigger.
     *   4. Emit MarketCreated so the subgraph / frontend can index it.
     *
     * @param ipfsCid         IPFS CID of the metadata JSON (format: "Qm..." or "bafy...").
     * @param outcomeCount    Number of outcome slots (2 for binary YES/NO).
     * @param resolutionTime  Unix timestamp when Chainlink CRE should resolve. Must be in the future.
     * @return questionId     keccak256(abi.encodePacked(ipfsCid))
     */
    function createMarket(
        string calldata ipfsCid,
        uint256 outcomeCount,
        uint256 resolutionTime,
        SettlementRail settlementRail
    ) external returns (bytes32 questionId) {
        if (bytes(ipfsCid).length == 0) revert EmptyCid();
        if (outcomeCount < 2) revert InvalidOutcomeCount();
        if (resolutionTime <= block.timestamp) revert InvalidResolutionTime();

        questionId = keccak256(abi.encodePacked(ipfsCid));

        if (markets[questionId].exists) revert MarketAlreadyExists(questionId);

        // Store only primitive market info — no string metadata
        markets[questionId] = MarketInfo({
            outcomeCount:   outcomeCount,
            resolutionTime: resolutionTime,
            status:         MarketStatus.Active,
            exists:         true
        });

        marketSettlementRail[questionId] = settlementRail;
        allMarkets.push(questionId);

        // Initialise the CTF condition + schedule CRE resolution
        adapter.initializeMarket(questionId, ipfsCid, outcomeCount, resolutionTime);

        // Emit with ipfsCid so frontend/subgraph can fetch metadata from IPFS
        emit MarketCreated(questionId, ipfsCid, outcomeCount, resolutionTime, msg.sender, settlementRail);
    }

    ////////////////////////////////////////////////////
    // Status Sync (called by adapter or owner)
    ////////////////////////////////////////////////////

    /**
     * @notice Syncs the registry status when the adapter resolves a market.
     * @dev The adapter emits MarketResolved; a keeper or the finalizer can call this.
     *      Alternatively, the frontend reads status directly from the adapter.
     */
    function syncStatus(bytes32 questionId) external {
        MarketInfo storage m = markets[questionId];
        if (!m.exists) revert MarketNotFound(questionId);

        AiCTFAdapter.MarketQuestion memory q = adapter.getQuestion(questionId);

        MarketStatus newStatus;
        if (uint256(q.status) == 3) {
            // AiCTFAdapter.MarketStatus.Resolved == 3
            newStatus = MarketStatus.Resolved;
        } else if (uint256(q.status) == 2) {
            newStatus = MarketStatus.Proposed;
        } else {
            newStatus = MarketStatus.Active;
        }

        if (newStatus != m.status) {
            m.status = newStatus;
            emit MarketStatusUpdated(questionId, newStatus);
        }
    }

    ////////////////////////////////////////////////////
    // View Functions
    ////////////////////////////////////////////////////

    function getMarket(bytes32 questionId) external view returns (MarketInfo memory) {
        return markets[questionId];
    }

    function getAllMarkets() external view returns (bytes32[] memory) {
        return allMarkets;
    }

    function getMarketCount() external view returns (uint256) {
        return allMarkets.length;
    }

    /**
     * @notice Returns a page of market questionIds for frontend pagination.
     */
    function getMarketsPage(uint256 offset, uint256 limit) external view returns (bytes32[] memory page) {
        uint256 total = allMarkets.length;
        if (offset >= total) return new bytes32[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;
        page = new bytes32[](end - offset);
        for (uint256 i = 0; i < page.length; i++) {
            page[i] = allMarkets[offset + i];
        }
    }
}
