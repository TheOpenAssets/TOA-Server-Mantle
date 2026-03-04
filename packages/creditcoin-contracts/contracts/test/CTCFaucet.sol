// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title CTCFaucet
 * @notice Faucet contract for dispensing MockCTC tokens
 */
contract CTCFaucet {
    IERC20 public mockCTC;

    constructor(address _mockCTC) {
        mockCTC = IERC20(_mockCTC);
    }

    /**
     * @notice Request any amount of MockCTC tokens
     * @param to The address to receive tokens
     * @param amount The amount of tokens to request (in smallest unit, 18 decimals)
     */
    function requestTokens(address to, uint256 amount) external {
        IMockCTC(address(mockCTC)).mint(to, amount);
    }

    /**
     * @notice Get tokens by specifying amount in CTC (18 decimals)
     * @param to The address to receive tokens
     * @param amountInCTC The amount in CTC (e.g., 10 for 10 CTC)
     */
    function requestCTC(address to, uint256 amountInCTC) external {
        uint256 amount = amountInCTC * 10 ** 18; // 18 decimals
        IMockCTC(address(mockCTC)).mint(to, amount);
    }
}

interface IMockCTC {
    function mint(address to, uint256 amount) external;
}
