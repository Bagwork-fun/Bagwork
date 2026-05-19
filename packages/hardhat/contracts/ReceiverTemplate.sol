// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IERC165 } from "@openzeppelin/contracts/interfaces/IERC165.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title IReceiver
 * @notice Interface for CRE report receivers.
 */
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/**
 * @title ReceiverTemplate
 * @notice Abstract base contract for receiving Chainlink CRE workflow reports.
 * @dev Copied verbatim structure from cre-gcp-prediction-market-demo with AiCTFAdapter customisation.
 *      Forwarder address is required; optional workflow identity checks enforce which CRE job can call.
 */
abstract contract ReceiverTemplate is IReceiver, Ownable {
    // Required — set at construction; only this address may call onReport
    address private s_forwarderAddress;

    // Optional identity guards (all zero = disabled)
    address private s_expectedAuthor;
    bytes10 private s_expectedWorkflowName;
    bytes32 private s_expectedWorkflowId;

    bytes private constant HEX_CHARS = "0123456789abcdef";

    error InvalidForwarderAddress();
    error InvalidSender(address sender, address expected);
    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error InvalidWorkflowId(bytes32 received, bytes32 expected);
    error WorkflowNameRequiresAuthorValidation();

    event ForwarderAddressUpdated(address indexed previousForwarder, address indexed newForwarder);
    event ExpectedAuthorUpdated(address indexed previousAuthor, address indexed newAuthor);
    event ExpectedWorkflowNameUpdated(bytes10 indexed previousName, bytes10 indexed newName);
    event ExpectedWorkflowIdUpdated(bytes32 indexed previousId, bytes32 indexed newId);
    event SecurityWarning(string message);

    constructor(address _forwarderAddress) Ownable(msg.sender) {
        if (_forwarderAddress == address(0)) revert InvalidForwarderAddress();
        s_forwarderAddress = _forwarderAddress;
        emit ForwarderAddressUpdated(address(0), _forwarderAddress);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (s_forwarderAddress != address(0) && msg.sender != s_forwarderAddress) {
            revert InvalidSender(msg.sender, s_forwarderAddress);
        }

        if (
            s_expectedWorkflowId != bytes32(0) ||
            s_expectedAuthor != address(0) ||
            s_expectedWorkflowName != bytes10(0)
        ) {
            (bytes32 workflowId, bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

            if (s_expectedWorkflowId != bytes32(0) && workflowId != s_expectedWorkflowId) {
                revert InvalidWorkflowId(workflowId, s_expectedWorkflowId);
            }
            if (s_expectedAuthor != address(0) && workflowOwner != s_expectedAuthor) {
                revert InvalidAuthor(workflowOwner, s_expectedAuthor);
            }
            if (s_expectedWorkflowName != bytes10(0)) {
                if (s_expectedAuthor == address(0)) revert WorkflowNameRequiresAuthorValidation();
                if (workflowName != s_expectedWorkflowName) {
                    revert InvalidWorkflowName(workflowName, s_expectedWorkflowName);
                }
            }
        }

        _processReport(report);
    }

    function getForwarderAddress() external view returns (address) { return s_forwarderAddress; }
    function getExpectedAuthor() external view returns (address) { return s_expectedAuthor; }
    function getExpectedWorkflowName() external view returns (bytes10) { return s_expectedWorkflowName; }
    function getExpectedWorkflowId() external view returns (bytes32) { return s_expectedWorkflowId; }

    function setForwarderAddress(address _forwarder) external onlyOwner {
        address prev = s_forwarderAddress;
        if (_forwarder == address(0)) emit SecurityWarning("Forwarder set to zero - INSECURE");
        s_forwarderAddress = _forwarder;
        emit ForwarderAddressUpdated(prev, _forwarder);
    }

    function setExpectedAuthor(address _author) external onlyOwner {
        address prev = s_expectedAuthor;
        s_expectedAuthor = _author;
        emit ExpectedAuthorUpdated(prev, _author);
    }

    function setExpectedWorkflowName(string calldata _name) external onlyOwner {
        bytes10 prev = s_expectedWorkflowName;
        if (bytes(_name).length == 0) {
            s_expectedWorkflowName = bytes10(0);
            emit ExpectedWorkflowNameUpdated(prev, bytes10(0));
            return;
        }
        bytes32 hash = sha256(bytes(_name));
        bytes memory hex_ = _bytesToHexString(abi.encodePacked(hash));
        bytes memory first10 = new bytes(10);
        for (uint256 i = 0; i < 10; i++) first10[i] = hex_[i];
        s_expectedWorkflowName = bytes10(first10);
        emit ExpectedWorkflowNameUpdated(prev, s_expectedWorkflowName);
    }

    function setExpectedWorkflowId(bytes32 _id) external onlyOwner {
        bytes32 prev = s_expectedWorkflowId;
        s_expectedWorkflowId = _id;
        emit ExpectedWorkflowIdUpdated(prev, _id);
    }

    function _bytesToHexString(bytes memory data) private pure returns (bytes memory) {
        bytes memory hex_ = new bytes(data.length * 2);
        for (uint256 i = 0; i < data.length; i++) {
            hex_[i * 2]     = HEX_CHARS[uint8(data[i] >> 4)];
            hex_[i * 2 + 1] = HEX_CHARS[uint8(data[i] & 0x0f)];
        }
        return hex_;
    }

    function _decodeMetadata(bytes memory metadata)
        internal
        pure
        returns (bytes32 workflowId, bytes10 workflowName, address workflowOwner)
    {
        assembly {
            workflowId   := mload(add(metadata, 32))
            workflowName := mload(add(metadata, 64))
            workflowOwner := shr(mul(12, 8), mload(add(metadata, 74)))
        }
    }

    function _processReport(bytes calldata report) internal virtual;

    function supportsInterface(bytes4 interfaceId) public pure virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
