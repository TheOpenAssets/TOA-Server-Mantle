// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Faucet
 * @notice Faucet contract for dispensing MockUSDC tokens
 */
contract Faucet {
    IERC20 public mockUSDC;

    constructor(address _mockUSDC) {
        mockUSDC = IERC20(_mockUSDC);
    }

    /**
     * @notice Request any amount of MockUSDC tokens
     * @param to The address to receive tokens
     * @param amount The amount of tokens to request (in smallest unit)
     */
    function requestTokens(address to, uint256 amount) external {
        // For testing purposes, allow any amount
        // In production, you might want to add limits or cooldowns
        MockUSDC(address(mockUSDC)).mint(to, amount);
    }

    /**
     * @notice Get tokens by specifying amount in USDC (6 decimals)
     * @param to The address to receive tokens
     * @param amountInUSDC The amount in USDC (e.g., 100 for 100 USDC)
     */
    function requestUSDC(address to, uint256 amountInUSDC) external {
        uint256 amount = amountInUSDC * 10 ** 6; // Assuming 6 decimals
        MockUSDC(address(mockUSDC)).mint(to, amount);
    }
}

// Import the MockUSDC to access mint function
interface MockUSDC {
    function mint(address to, uint256 amount) external;
}