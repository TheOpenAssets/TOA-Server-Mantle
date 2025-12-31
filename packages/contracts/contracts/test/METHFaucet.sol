// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title METHFaucet
 * @notice Faucet contract for dispensing MockMETH tokens
 */
contract METHFaucet {
    IERC20 public mockMETH;

    constructor(address _mockMETH) {
        mockMETH = IERC20(_mockMETH);
    }

    /**
     * @notice Request any amount of MockMETH tokens
     * @param to The address to receive tokens
     * @param amount The amount of tokens to request (in smallest unit, 18 decimals)
     */
    function requestTokens(address to, uint256 amount) external {
        // For testing purposes, allow any amount
        // In production, you might want to add limits or cooldowns
        MockMETH(address(mockMETH)).mint(to, amount);
    }

    /**
     * @notice Get tokens by specifying amount in mETH (18 decimals)
     * @param to The address to receive tokens
     * @param amountInMETH The amount in mETH (e.g., 10 for 10 mETH)
     */
    function requestMETH(address to, uint256 amountInMETH) external {
        uint256 amount = amountInMETH * 10 ** 18; // 18 decimals
        MockMETH(address(mockMETH)).mint(to, amount);
    }
}

// Import the MockMETH to access mint function
interface MockMETH {
    function mint(address to, uint256 amount) external;
}
