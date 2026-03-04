// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockCTC
 * @notice Mock Credit Coin token for testing and demo purposes
 * @dev Simple ERC20 token - price is managed off-chain in backend
 */
contract MockCTC is ERC20, Ownable {
    // Events
    event TokensMinted(address indexed to, uint256 amount);

    /**
     * @notice Initialize MockCTC token
     */
    constructor() ERC20("Mock Credit Coin", "CTC") Ownable(msg.sender) {
        // Mint 100M CTC to deployer
        _mint(msg.sender, 100_000_000 * 10 ** 18);
    }

    /**
     * @notice Mint CTC tokens (for testing)
     * @param to Recipient address
     * @param amount Amount to mint (with 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn CTC tokens
     * @param amount Amount to burn (with 18 decimals)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Decimals for CTC (standard 18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
