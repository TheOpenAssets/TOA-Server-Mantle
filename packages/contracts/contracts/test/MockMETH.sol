// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockMETH
 * @notice Mock Mantle Liquid Staked ETH token for testing and demo purposes
 * @dev Simulates mETH with configurable price for demo scenarios
 *
 * Features:
 * - Standard ERC20 token
 * - Admin-controlled price oracle for demo scenarios
 * - Public mint function for testing
 * - Price changes simulate mETH appreciation/depreciation
 */
contract MockMETH is ERC20, Ownable {
    // Current mETH price in USD (with 18 decimals, e.g., 3000 * 1e18 = $3000)
    uint256 public price;

    // Events
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event TokensMinted(address indexed to, uint256 amount);

    /**
     * @notice Initialize MockMETH token
     * @param initialPrice Initial price in USD (with 18 decimals)
     */
    constructor(uint256 initialPrice) ERC20("Mock Mantle Staked ETH", "mETH") Ownable(msg.sender) {
        price = initialPrice;
        // Mint 100 billion mETH to deployer for testing
        _mint(msg.sender, 100_000_000_000 * 10 ** 18);
        emit PriceUpdated(0, initialPrice);
    }

    /**
     * @notice Set mETH price (for demo scenarios)
     * @dev Only owner can set price to simulate market conditions
     * @param newPrice New price in USD (with 18 decimals)
     */
    function setPrice(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Price must be greater than 0");
        uint256 oldPrice = price;
        price = newPrice;
        emit PriceUpdated(oldPrice, newPrice);
    }

    /**
     * @notice Get current mETH price in USD
     * @return Current price (with 18 decimals)
     */
    function getPrice() external view returns (uint256) {
        return price;
    }

    /**
     * @notice Calculate USD value of mETH amount
     * @param mETHAmount Amount of mETH (with 18 decimals)
     * @return USD value (with 18 decimals)
     */
    function getValueInUSD(uint256 mETHAmount) external view returns (uint256) {
        return (mETHAmount * price) / 1e18;
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
