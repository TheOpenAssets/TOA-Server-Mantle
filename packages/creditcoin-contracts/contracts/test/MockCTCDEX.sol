// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockCTCDEX
 * @notice Mock DEX for testing CTC ↔ USDC swaps on Credit Coin
 */
contract MockCTCDEX is Ownable, ReentrancyGuard {
    IERC20 public CTC;
    IERC20 public USDC;

    // Exchange rate: 1 CTC = X USDC (with 6 decimals to match USDC)
    uint256 public exchangeRate;

    // Liquidity reserves
    uint256 public ctcReserve;
    uint256 public usdcReserve;

    // Events
    event ExchangeRateUpdated(uint256 oldRate, uint256 newRate);
    event Swapped(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event LiquidityAdded(uint256 ctcAmount, uint256 usdcAmount);

    constructor(
        address _CTC,
        address _USDC,
        uint256 _initialExchangeRate
    ) Ownable(msg.sender) {
        CTC = IERC20(_CTC);
        USDC = IERC20(_USDC);
        exchangeRate = _initialExchangeRate;
        emit ExchangeRateUpdated(0, _initialExchangeRate);
    }

    function setExchangeRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "Rate must be greater than 0");
        uint256 oldRate = exchangeRate;
        exchangeRate = newRate;
        emit ExchangeRateUpdated(oldRate, newRate);
    }

    function getQuote(uint256 ctcAmount) external view returns (uint256) {
        return (ctcAmount * exchangeRate) / 1e18;
    }

    function swapCTCForUSDC(
        uint256 ctcAmount,
        uint256 minUSDCOut
    ) external nonReentrant returns (uint256 usdcOut) {
        require(ctcAmount > 0, "Amount must be greater than 0");
        usdcOut = (ctcAmount * exchangeRate) / 1e18;
        require(usdcOut >= minUSDCOut, "Slippage tolerance exceeded");
        require(usdcReserve >= usdcOut, "Insufficient USDC liquidity");

        require(CTC.transferFrom(msg.sender, address(this), ctcAmount), "CTC transfer failed");
        ctcReserve += ctcAmount;
        usdcReserve -= usdcOut;
        require(USDC.transfer(msg.sender, usdcOut), "USDC transfer failed");

        emit Swapped(msg.sender, address(CTC), address(USDC), ctcAmount, usdcOut);
    }

    function addLiquidity(uint256 ctcAmount, uint256 usdcAmount) external onlyOwner {
        if (ctcAmount > 0) {
            require(CTC.transferFrom(msg.sender, address(this), ctcAmount), "CTC transfer failed");
            ctcReserve += ctcAmount;
        }
        if (usdcAmount > 0) {
            require(USDC.transferFrom(msg.sender, address(this), usdcAmount), "USDC transfer failed");
            usdcReserve += usdcAmount;
        }
        emit LiquidityAdded(ctcAmount, usdcAmount);
    }
}
