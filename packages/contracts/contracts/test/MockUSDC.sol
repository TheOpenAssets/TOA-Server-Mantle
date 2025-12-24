// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC token for testing purposes
 */
contract MockUSDC is ERC20 {
    uint8 private _decimals = 6;

    constructor() ERC20("USD Coin", "USDC") {
        // Mint 1 million USDC to deployer for testing
        _mint(msg.sender, 1_000_000 * 10 ** _decimals);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function faucet() external {
        // Faucet: 1000 USDC per call
        _mint(msg.sender, 1000 * 10 ** _decimals);
    }
}
