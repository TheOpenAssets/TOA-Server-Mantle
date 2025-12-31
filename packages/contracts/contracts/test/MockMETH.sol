// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockMETH
 * @notice Mock Mantle Liquid Staked ETH token for testing and demo purposes
 * @dev Simple ERC20 token - price is managed off-chain in backend
 *
 * Features:
 * - Standard ERC20 token
 * - Public mint function for testing
 * - No on-chain price oracle (backend manages historical price data)
 */
contract MockMETH is ERC20, Ownable {
    // Events
    event TokensMinted(address indexed to, uint256 amount);

    /**
     * @notice Initialize MockMETH token
     */
    constructor() ERC20("Mock Mantle Staked ETH", "mETH") Ownable(msg.sender) {
        // Mint 100 billion mETH to deployer for testing
        _mint(msg.sender, 100_000_000_000 * 10 ** 18);
    }

    /**
     * @notice Mint mETH tokens (for testing)
     * @dev Public function to allow easy testing
     * @param to Recipient address
     * @param amount Amount to mint (with 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn mETH tokens
     * @param amount Amount to burn (with 18 decimals)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Decimals for mETH (standard 18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
