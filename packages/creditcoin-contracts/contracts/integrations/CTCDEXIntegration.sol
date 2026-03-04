// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICTCDEX {
    function swapCTCForUSDC(
        uint256 ctcAmount,
        uint256 minUSDCOut
    ) external returns (uint256 usdcOut);

    function getQuote(uint256 ctcAmount) external view returns (uint256);
}

/**
 * @title CTCDEXIntegration
 * @notice Wrapper for Credit Coin DEX integration
 */
contract CTCDEXIntegration is Ownable, ReentrancyGuard {
    IERC20 public ctc;
    IERC20 public usdc;
    ICTCDEX public dex;

    uint256 public constant MAX_SLIPPAGE = 300; // 3%
    uint256 public constant BASIS_POINTS = 10000;

    event SwapExecuted(
        uint256 indexed timestamp,
        uint256 ctcAmount,
        uint256 usdcReceived,
        uint256 effectiveRate
    );

    constructor(
        address _ctc,
        address _usdc,
        address _dex
    ) Ownable(msg.sender) {
        ctc = IERC20(_ctc);
        usdc = IERC20(_usdc);
        dex = ICTCDEX(_dex);
    }

    function swapCTCToUSDC(
        uint256 ctcAmount,
        uint256 ctcPriceUSD
    ) external nonReentrant returns (uint256 usdcReceived) {
        require(ctcAmount > 0, "Amount must be > 0");
        
        uint256 expectedUSDC = dex.getQuote(ctcAmount);
        uint256 minUSDCOut = (expectedUSDC * (BASIS_POINTS - MAX_SLIPPAGE)) / BASIS_POINTS;

        require(ctc.transferFrom(msg.sender, address(this), ctcAmount), "CTC transfer failed");
        ctc.approve(address(dex), ctcAmount);
        usdcReceived = dex.swapCTCForUSDC(ctcAmount, minUSDCOut);

        require(usdc.transfer(msg.sender, usdcReceived), "USDC transfer failed");

        uint256 effectiveRate = (usdcReceived * 1e18) / ctcAmount;
        emit SwapExecuted(block.timestamp, ctcAmount, usdcReceived, effectiveRate);
    }
}
