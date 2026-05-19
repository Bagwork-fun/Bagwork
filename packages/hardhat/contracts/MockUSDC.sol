// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Minimal USDC mock for local development and testing.
 * @dev 6-decimal ERC-20 matching real USDC. Anyone can mint on localhost.
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin (Mock)", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Free mint for testing — DO NOT deploy to mainnet
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
