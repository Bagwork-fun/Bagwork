// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AiCTFAdapter } from "./AiCTFAdapter.sol";
import { MarketRegistry } from "./MarketRegistry.sol";

/**
 * @title AutoFinalizerUpkeep
 * @notice Chainlink Automation Upkeep contract to automatically finalize resolutions
 *         once their dispute window has elapsed.
 */
contract AutoFinalizerUpkeep {
    AiCTFAdapter public immutable adapter;
    MarketRegistry public immutable registry;

    constructor(address _adapter, address _registry) {
        adapter = AiCTFAdapter(_adapter);
        registry = MarketRegistry(_registry);
    }

    /**
     * @notice Chainlink Automation checkUpkeep
     * @dev Iterates through all active markets in the registry, checks if they are
     *      in the 'Proposed' state, and if the dispute window has elapsed.
     */
    function checkUpkeep(bytes calldata /* checkData */) external view returns (bool upkeepNeeded, bytes memory performData) {
        bytes32[] memory allMarkets = registry.getAllMarkets();
        
        for (uint256 i = 0; i < allMarkets.length; i++) {
            bytes32 qId = allMarkets[i];
            AiCTFAdapter.MarketQuestion memory q = adapter.getQuestion(qId);
            
            // Status 2 is 'Proposed'
            if (uint256(q.status) == 2) {
                uint256 windowEnd = q.proposedAt + adapter.disputeWindow();
                if (block.timestamp >= windowEnd) {
                    // Found a market that needs finalization
                    return (true, abi.encode(qId));
                }
            }
        }
        
        return (false, "");
    }

    /**
     * @notice Chainlink Automation performUpkeep
     * @dev Calls finalizeResolution on the adapter for the encoded questionId.
     */
    function performUpkeep(bytes calldata performData) external {
        bytes32 questionId = abi.decode(performData, (bytes32));
        
        // Re-validate to ensure it still needs finalization
        AiCTFAdapter.MarketQuestion memory q = adapter.getQuestion(questionId);
        require(uint256(q.status) == 2, "Market not in Proposed state");
        require(block.timestamp >= q.proposedAt + adapter.disputeWindow(), "Dispute window not elapsed");

        // Finalize the resolution (this will call ctf.reportPayouts)
        adapter.finalizeResolution(questionId);
    }
}
