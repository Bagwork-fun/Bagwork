// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockEURC
 * @notice Minimal EURC-style mock for local dev (6 decimals like Circle EURC).
 */
contract MockEURC is ERC20 {
    constructor() ERC20("Euro Coin (Mock)", "EURC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
