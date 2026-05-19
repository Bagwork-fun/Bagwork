// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ReceiverTemplate } from "./ReceiverTemplate.sol";
import { ConditionalTokens } from "./ConditionalTokens.sol";

/**
 * @title AiCTFAdapter
 * @notice Oracle adapter that resolves Conditional Token Framework markets via Chainlink CRE + Gemini AI.
 *
 * @dev Architecture:
 *  1. `initializeMarket()` prepares a CTF condition and emits `MarketInitialized` (triggers CRE).
 *  2. CRE detects the event, calls Gemini AI, then submits `onReport(metadata, report)`.
 *  3. The adapter starts a `disputeWindow` timer and emits `ResolutionProposed`.
 *  4. After the window, an authorized finalizer calls `finalizeResolution()` to call `ctf.reportPayouts()`.
 *  5. Before the window elapses (public finalize):
 *     - The contract owner can `adminOverride()` to replace the proposed payouts.
 *     - The multisig (if set) can call `multisigOverride()` which requires M-of-N signers.
 *  6. Owner / multisig bypass (no need to wait for CRE or resolution time):
 *     - `adminResolve()` — owner sets payouts and resolves immediately (Active or Proposed, any time).
 *     - `adminOverride()` — also allowed while Active to start a proposal + dispute window without CRE.
 *     - `multisigOverride()` — signers may begin or complete resolution while Active (first approvals
 *       move the market to Proposed and open the usual dispute window for public finalize).
 *
 * Key invariants:
 *  - AiCTFAdapter is the sole oracle address in every `prepareCondition()` call.
 *  - No market string metadata is stored on-chain — only the IPFS CID via events.
 *  - `finalizeResolution` requires the dispute window to elapse; caller must be owner, multisig signer,
 *    upkeep finalizer, or any address when no multisig/upkeep is configured (local dev).
 */
contract AiCTFAdapter is ReceiverTemplate {
    ////////////////////////////////////////////////////
    // Types
    ////////////////////////////////////////////////////

    enum MarketStatus { Uninitialized, Active, Proposed, Resolved }

    struct MarketQuestion {
        uint256 resolutionTime;     // Target resolution timestamp
        uint256 proposedAt;         // Timestamp when CRE submitted a proposal
        uint256[] proposedPayouts;  // Payouts proposed by AI
        uint256 outcomeCount;       // Number of outcome slots
        MarketStatus status;
        bool multisigApproved;      // Set to true once multisig threshold is met
    }

    ////////////////////////////////////////////////////
    // State
    ////////////////////////////////////////////////////

    /// @notice The Gnosis Conditional Token Framework contract
    ConditionalTokens public immutable ctf;

    /// @notice Duration of the dispute window after a resolution is proposed
    uint256 public disputeWindow;

    /// @notice Minimum number of multisig signers required to approve an override
    uint256 public multisigThreshold;

    /// @notice List of authorised multisig signers
    address[] public multisigSigners;

    /// @notice questionId → MarketQuestion
    mapping(bytes32 => MarketQuestion) public questions;

    /// @notice questionId → signer → has approved the pending proposal override
    mapping(bytes32 => mapping(address => bool)) public multisigApprovals;

    /// @notice questionId → current multisig approval count for a proposed override
    mapping(bytes32 => uint256) public multisigApprovalCount;

    /// @notice Address of the MarketRegistry (only it may call initializeMarket)
    address public registry;

    /// @notice Optional Chainlink Automation upkeep allowed to call finalizeResolution
    address public upkeepFinalizer;

    ////////////////////////////////////////////////////
    // Events
    ////////////////////////////////////////////////////

    event MarketInitialized(
        bytes32 indexed questionId,
        string  ipfsCid,
        uint256 outcomeCount,
        uint256 resolutionTime
    );

    event ResolutionProposed(
        bytes32 indexed questionId,
        uint256[] payouts,
        uint256 disputeWindowEnd
    );

    event ResolutionProposalReplaced(
        bytes32 indexed questionId,
        uint256[] newPayouts,
        address  replacedBy
    );

    event MarketResolved(
        bytes32 indexed questionId,
        uint256[] payouts
    );

    event MultisigOverrideApproved(
        bytes32 indexed questionId,
        address indexed signer,
        uint256 approvalsNow,
        uint256 threshold
    );

    event MultisigThresholdUpdated(uint256 newThreshold);
    event MultisigSignersUpdated(address[] newSigners);
    event DisputeWindowUpdated(uint256 newWindow);
    event RegistryUpdated(address newRegistry);

    ////////////////////////////////////////////////////
    // Errors
    ////////////////////////////////////////////////////

    error NotRegistry();
    error AlreadyInitialized();
    error NotInitialized();
    error AlreadyResolved();
    error DisputeWindowActive();
    error DisputeWindowExpired();
    error NoProposalPending();
    error NotMultisigSigner();
    error AlreadyApproved();
    error ThresholdNotMet();
    error InvalidPayouts();
    error InvalidDisputeWindow();
    error InvalidThreshold();
    error ZeroOutcomeCount();
    error NotAuthorizedFinalizer();

    ////////////////////////////////////////////////////
    // Modifiers
    ////////////////////////////////////////////////////

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    ////////////////////////////////////////////////////
    // Constructor
    ////////////////////////////////////////////////////

    /**
     * @param _ctf              Address of the deployed ConditionalTokens contract.
     * @param _forwarderAddress Chainlink CRE forwarder (only address allowed to call onReport).
     * @param _disputeWindow    Seconds after a proposal before it can be finalized.
     * @param _multisigSigners  Initial list of multisig signer addresses.
     * @param _multisigThreshold Minimum approvals required (must be ≤ _multisigSigners.length).
     */
    constructor(
        address _ctf,
        address _forwarderAddress,
        uint256 _disputeWindow,
        address[] memory _multisigSigners,
        uint256 _multisigThreshold
    ) ReceiverTemplate(_forwarderAddress) {
        if (_disputeWindow == 0) revert InvalidDisputeWindow();
        if (_multisigSigners.length > 0 && (_multisigThreshold == 0 || _multisigThreshold > _multisigSigners.length)) {
            revert InvalidThreshold();
        }
        ctf = ConditionalTokens(_ctf);
        disputeWindow = _disputeWindow;
        multisigSigners = _multisigSigners;
        multisigThreshold = _multisigThreshold;
    }

    ////////////////////////////////////////////////////
    // Initialisation (called by MarketRegistry)
    ////////////////////////////////////////////////////

    /**
     * @notice Registers a new prediction market with the CTF and Chainlink CRE.
     * @dev Only callable by the MarketRegistry contract.
     *      Emits MarketInitialized — this event is the CRE log trigger.
     * @param questionId      keccak256(abi.encodePacked(ipfsCid))
     * @param ipfsCid         IPFS CID of the JSON metadata — NOT stored on-chain, emitted only.
     * @param outcomeCount    Number of outcome slots (2 for binary markets).
     * @param resolutionTime  Unix timestamp when CRE should attempt resolution.
     */
    function initializeMarket(
        bytes32 questionId,
        string calldata ipfsCid,
        uint256 outcomeCount,
        uint256 resolutionTime
    ) external onlyRegistry {
        if (outcomeCount < 2) revert ZeroOutcomeCount();
        MarketQuestion storage q = questions[questionId];
        if (q.status != MarketStatus.Uninitialized) revert AlreadyInitialized();

        // Prepare the condition on the CTF — no new contract deployed
        ctf.prepareCondition(address(this), questionId, outcomeCount);

        q.resolutionTime  = resolutionTime;
        q.outcomeCount    = outcomeCount;
        q.status          = MarketStatus.Active;

        // CRE listens for this event to schedule the AI resolution job
        emit MarketInitialized(questionId, ipfsCid, outcomeCount, resolutionTime);
    }

    ////////////////////////////////////////////////////
    // CRE Callback (called by Chainlink Forwarder)
    ////////////////////////////////////////////////////

    /**
     * @notice Internal hook invoked by ReceiverTemplate.onReport() after forwarder validation.
     * @dev Report format: abi.encode(bytes32 questionId, uint256[] payouts)
     *      Starts the dispute window; finalization is via finalizeResolution().
     */
    function _processReport(bytes calldata report) internal override {
        (bytes32 questionId, uint256[] memory payouts) = abi.decode(report, (bytes32, uint256[]));

        MarketQuestion storage q = questions[questionId];
        if (q.status == MarketStatus.Uninitialized) revert NotInitialized();
        if (q.status == MarketStatus.Resolved) revert AlreadyResolved();
        if (!_isValidPayouts(payouts, q.outcomeCount)) revert InvalidPayouts();

        // Replace any existing proposal (CRE may resubmit after a dispute)
        q.proposedPayouts = payouts;
        q.proposedAt      = block.timestamp;
        q.status          = MarketStatus.Proposed;
        // Reset multisig approval state for the new proposal
        _resetMultisigApprovals(questionId);

        emit ResolutionProposed(questionId, payouts, block.timestamp + disputeWindow);
    }

    ////////////////////////////////////////////////////
    // Owner immediate resolution (any time after init)
    ////////////////////////////////////////////////////

    /**
     * @notice Owner may resolve immediately with the given payouts.
     * @dev Works while market is Active (before CRE) or Proposed. Bypasses resolution time,
     *      dispute window, and CRE. Does not require a prior AI proposal.
     * @param questionId The market to resolve.
     * @param payouts    Payout numerators per outcome (same semantics as CTF `reportPayouts`).
     */
    function adminResolve(bytes32 questionId, uint256[] calldata payouts) external onlyOwner {
        MarketQuestion storage q = questions[questionId];
        if (q.status == MarketStatus.Uninitialized) revert NotInitialized();
        if (q.status == MarketStatus.Resolved) revert AlreadyResolved();
        if (!_isValidPayouts(payouts, q.outcomeCount)) revert InvalidPayouts();

        q.proposedPayouts = payouts;
        q.proposedAt = block.timestamp;
        _resetMultisigApprovals(questionId);
        _resolve(questionId, q);
    }

    ////////////////////////////////////////////////////
    // Finalization (permissionless after dispute window)
    ////////////////////////////////////////////////////

    /**
     * @notice Finalizes a proposed resolution after the dispute window elapses.
     * @dev Callable by owner, multisig signers, or the registered upkeep finalizer.
     *      When no multisig and no upkeep are configured (dev), any address may finalize.
     * @param questionId The market to finalize.
     */
    function finalizeResolution(bytes32 questionId) external {
        if (!_canFinalizeResolution(msg.sender)) revert NotAuthorizedFinalizer();

        MarketQuestion storage q = questions[questionId];
        if (q.status == MarketStatus.Uninitialized) revert NotInitialized();
        if (q.status != MarketStatus.Proposed) revert NoProposalPending();
        if (q.status == MarketStatus.Resolved) revert AlreadyResolved();
        if (block.timestamp < q.proposedAt + disputeWindow) revert DisputeWindowActive();

        _resolve(questionId, q);
    }

    ////////////////////////////////////////////////////
    // Owner Override (Active: open proposal; Proposed: within dispute window only)
    ////////////////////////////////////////////////////

    /**
     * @notice Owner replaces payouts and (re)starts the dispute window without resolving.
     * @dev While Active: sets status to Proposed and opens the dispute window (no CRE required).
     *      While Proposed: only callable before the dispute window ends (same as before).
     * @param questionId  The market to override.
     * @param payouts     Payout array for the new proposal.
     */
    function adminOverride(bytes32 questionId, uint256[] calldata payouts) external onlyOwner {
        MarketQuestion storage q = questions[questionId];
        if (q.status == MarketStatus.Uninitialized) revert NotInitialized();
        if (q.status == MarketStatus.Resolved) revert AlreadyResolved();

        if (q.status == MarketStatus.Active) {
            if (!_isValidPayouts(payouts, q.outcomeCount)) revert InvalidPayouts();
            q.proposedPayouts = payouts;
            q.proposedAt = block.timestamp;
            q.status = MarketStatus.Proposed;
            _resetMultisigApprovals(questionId);
            emit ResolutionProposalReplaced(questionId, payouts, msg.sender);
            emit ResolutionProposed(questionId, payouts, block.timestamp + disputeWindow);
            return;
        }

        if (q.status != MarketStatus.Proposed) revert NoProposalPending();
        if (block.timestamp >= q.proposedAt + disputeWindow) revert DisputeWindowExpired();
        if (!_isValidPayouts(payouts, q.outcomeCount)) revert InvalidPayouts();

        q.proposedPayouts = payouts;
        q.proposedAt = block.timestamp;
        _resetMultisigApprovals(questionId);

        emit ResolutionProposalReplaced(questionId, payouts, msg.sender);
        emit ResolutionProposed(questionId, payouts, block.timestamp + disputeWindow);
    }

    ////////////////////////////////////////////////////
    // Multisig Override (Active or Proposed during dispute window)
    ////////////////////////////////////////////////////

    /**
     * @notice A multisig signer approves the current pending proposal override.
     * @dev Once `multisigThreshold` approvals are collected, the resolution is finalized
     *      immediately — bypassing the remaining dispute window.
     *      While Active: signers pin payouts, the market moves to Proposed, then approvals accrue;
     *      meeting threshold finalizes immediately (same as after a CRE proposal).
     *      While Proposed: the dispute window must still be open (same as before).
     * @param questionId  The market question ID.
     * @param payouts     The new payout array all signers are approving.
     *                    All signers must supply identical payouts; any mismatch resets approvals.
     */
    function multisigOverride(bytes32 questionId, uint256[] calldata payouts) external {
        MarketQuestion storage q = questions[questionId];
        if (q.status == MarketStatus.Uninitialized) revert NotInitialized();
        if (q.status == MarketStatus.Resolved) revert AlreadyResolved();
        if (q.status != MarketStatus.Proposed && q.status != MarketStatus.Active) revert NoProposalPending();
        if (!_isMultisigSigner(msg.sender)) revert NotMultisigSigner();
        if (multisigApprovals[questionId][msg.sender]) revert AlreadyApproved();
        if (!_isValidPayouts(payouts, q.outcomeCount)) revert InvalidPayouts();

        if (q.status == MarketStatus.Active) {
            if (q.proposedPayouts.length != payouts.length || !_payoutsMatch(payouts, q.proposedPayouts)) {
                q.proposedPayouts = payouts;
                q.proposedAt = block.timestamp;
                q.status = MarketStatus.Proposed;
                _resetMultisigApprovals(questionId);
                emit ResolutionProposalReplaced(questionId, payouts, msg.sender);
                emit ResolutionProposed(questionId, payouts, block.timestamp + disputeWindow);
            }
        } else {
            if (block.timestamp >= q.proposedAt + disputeWindow) revert DisputeWindowExpired();
            if (!_payoutsMatch(payouts, q.proposedPayouts)) {
                q.proposedPayouts = payouts;
                q.proposedAt = block.timestamp;
                _resetMultisigApprovals(questionId);
                emit ResolutionProposalReplaced(questionId, payouts, msg.sender);
                emit ResolutionProposed(questionId, payouts, block.timestamp + disputeWindow);
            }
        }

        multisigApprovals[questionId][msg.sender] = true;
        multisigApprovalCount[questionId]++;

        emit MultisigOverrideApproved(questionId, msg.sender, multisigApprovalCount[questionId], multisigThreshold);

        if (multisigApprovalCount[questionId] >= multisigThreshold) {
            q.multisigApproved = true;
            _resolve(questionId, q);
        }
    }

    ////////////////////////////////////////////////////
    // Internal Helpers
    ////////////////////////////////////////////////////

    function _canFinalizeResolution(address caller) internal view returns (bool) {
        if (caller == owner()) return true;
        if (upkeepFinalizer != address(0) && caller == upkeepFinalizer) return true;
        if (multisigSigners.length > 0 && _isMultisigSigner(caller)) return true;
        // Dev / open networks with no governance signers and no automation hook
        if (multisigSigners.length == 0 && upkeepFinalizer == address(0)) return true;
        return false;
    }

    function _resolve(bytes32 questionId, MarketQuestion storage q) internal {
        q.status = MarketStatus.Resolved;
        // AiCTFAdapter is the oracle — msg.sender does not matter here, ctf checks address(this)
        ctf.reportPayouts(questionId, q.proposedPayouts);
        emit MarketResolved(questionId, q.proposedPayouts);
    }

    function _isValidPayouts(uint256[] memory payouts, uint256 outcomeCount) internal pure returns (bool) {
        if (payouts.length != outcomeCount) return false;
        uint256 sum = 0;
        for (uint256 i = 0; i < payouts.length; i++) sum += payouts[i];
        return sum > 0;
    }

    function _payoutsMatch(uint256[] calldata a, uint256[] storage b) internal view returns (bool) {
        if (a.length != b.length) return false;
        for (uint256 i = 0; i < a.length; i++) {
            if (a[i] != b[i]) return false;
        }
        return true;
    }

    function _isMultisigSigner(address addr) internal view returns (bool) {
        for (uint256 i = 0; i < multisigSigners.length; i++) {
            if (multisigSigners[i] == addr) return true;
        }
        return false;
    }

    function _resetMultisigApprovals(bytes32 questionId) internal {
        for (uint256 i = 0; i < multisigSigners.length; i++) {
            multisigApprovals[questionId][multisigSigners[i]] = false;
        }
        multisigApprovalCount[questionId] = 0;
        questions[questionId].multisigApproved = false;
    }

    ////////////////////////////////////////////////////
    // Admin Configuration
    ////////////////////////////////////////////////////

    /// @notice Only the deployer (owner) can set the registry address.
    function setRegistry(address _registry) external onlyOwner {
        registry = _registry;
        emit RegistryUpdated(_registry);
    }

    function setUpkeepFinalizer(address _finalizer) external onlyOwner {
        upkeepFinalizer = _finalizer;
    }

    function setDisputeWindow(uint256 _window) external onlyOwner {
        if (_window == 0) revert InvalidDisputeWindow();
        disputeWindow = _window;
        emit DisputeWindowUpdated(_window);
    }

    function setMultisigSigners(address[] calldata _signers, uint256 _threshold) external onlyOwner {
        if (_signers.length > 0 && (_threshold == 0 || _threshold > _signers.length)) revert InvalidThreshold();
        multisigSigners = _signers;
        multisigThreshold = _threshold;
        emit MultisigSignersUpdated(_signers);
        emit MultisigThresholdUpdated(_threshold);
    }

    ////////////////////////////////////////////////////
    // View Functions
    ////////////////////////////////////////////////////

    function getQuestion(bytes32 questionId) external view returns (MarketQuestion memory) {
        return questions[questionId];
    }

    function getDisputeWindowEnd(bytes32 questionId) external view returns (uint256) {
        MarketQuestion storage q = questions[questionId];
        if (q.status != MarketStatus.Proposed) return 0;
        return q.proposedAt + disputeWindow;
    }

    function isMultisigSigner(address addr) external view returns (bool) {
        return _isMultisigSigner(addr);
    }

    function getMultisigSigners() external view returns (address[] memory) {
        return multisigSigners;
    }
}
