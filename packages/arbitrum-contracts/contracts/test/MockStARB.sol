// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockStARB
 * @notice Mock Staked ARB token for testing and demo purposes on Arbitrum
 * @dev Simple ERC20 token - price is managed off-chain in backend
 *
 * Features:
 * - Standard ERC20 token
 * - Public mint function for testing
 * - No on-chain price oracle (backend manages historical price data)
 * - Simulates Arbitrum liquid staking yield (~8% APY from sequencer fees)
 */
contract MockStARB is ERC20, Ownable {
    // Events
    event TokensMinted(address indexed to, uint256 amount);

    /**
     * @notice Initialize MockStARB token
     */
    constructor() ERC20("Staked ARB", "stARB") Ownable(msg.sender) {
        // Mint 10M stARB to deployer for liquidity provisioning
        _mint(msg.sender, 10_000_000 * 10 ** 18);
    }

    /**
     * @notice Mint stARB tokens (for testing)
     * @dev Public function to allow easy testing
     * @param to Recipient address
     * @param amount Amount to mint (with 18 decimals)
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
        emit TokensMinted(to, amount);
    }

    /**
     * @notice Burn stARB tokens
     * @param amount Amount to burn (with 18 decimals)
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    /**
     * @notice Decimals for stARB (standard 18)
     */
    function decimals() public pure override returns (uint8) {
        return 18;
    }
}
