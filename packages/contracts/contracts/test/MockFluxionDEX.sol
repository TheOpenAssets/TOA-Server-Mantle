// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockFluxionDEX
 * @notice Mock DEX for testing mETH ↔ USDC swaps
 * @dev Simulates Fluxion DEX with configurable exchange rates for demo scenarios
 *
 * Features:
 * - Swap mETH for USDC (and vice versa)
 * - Configurable exchange rate for demo
 * - Slippage simulation
 * - Liquidity tracking
 */
contract MockFluxionDEX is Ownable, ReentrancyGuard {
    IERC20 public mETH;
    IERC20 public USDC;

    // Exchange rate: 1 mETH = X USDC (with 6 decimals to match USDC)
    // Example: 3000 * 1e6 = 3000 USDC per mETH
    uint256 public exchangeRate;

    // Liquidity reserves
    uint256 public mETHReserve;
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
    event LiquidityAdded(uint256 mETHAmount, uint256 usdcAmount);

    /**
     * @notice Initialize Mock DEX
     * @param _mETH MockMETH token address
     * @param _USDC USDC token address
     * @param _initialExchangeRate Initial exchange rate (USDC per mETH, 6 decimals)
     */
    constructor(
        address _mETH,
        address _USDC,
        uint256 _initialExchangeRate
    ) Ownable(msg.sender) {
        mETH = IERC20(_mETH);
        USDC = IERC20(_USDC);
        exchangeRate = _initialExchangeRate;
        emit ExchangeRateUpdated(0, _initialExchangeRate);
    }

    /**
     * @notice Set exchange rate (for demo scenarios)
     * @param newRate New exchange rate (USDC per mETH, 6 decimals)
     */
    function setExchangeRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "Rate must be greater than 0");
        uint256 oldRate = exchangeRate;
        exchangeRate = newRate;
        emit ExchangeRateUpdated(oldRate, newRate);
    }

    /**
     * @notice Get quote for mETH → USDC swap
     * @param mETHAmount Amount of mETH to swap (18 decimals)
     * @return Expected USDC output (6 decimals)
     */
    function getQuote(uint256 mETHAmount) external view returns (uint256) {
        // Convert mETH (18 decimals) to USDC (6 decimals) using exchange rate
        return (mETHAmount * exchangeRate) / 1e18;
    }

    /**
     * @notice Get quote for USDC → mETH swap
     * @param usdcAmount Amount of USDC to swap (6 decimals)
     * @return Expected mETH output (18 decimals)
     */
    function getQuoteReverse(uint256 usdcAmount) external view returns (uint256) {
        // Convert USDC (6 decimals) to mETH (18 decimals) using exchange rate
        return (usdcAmount * 1e18) / exchangeRate;
    }

    /**
     * @notice Swap mETH for USDC
     * @param mETHAmount Amount of mETH to swap (18 decimals)
     * @param minUSDCOut Minimum USDC output (slippage protection, 6 decimals)
     * @return usdcOut Actual USDC output
     */
    function swapMETHForUSDC(
        uint256 mETHAmount,
        uint256 minUSDCOut
    ) external nonReentrant returns (uint256 usdcOut) {
        require(mETHAmount > 0, "Amount must be greater than 0");

        // Calculate USDC output
        usdcOut = (mETHAmount * exchangeRate) / 1e18;
        require(usdcOut >= minUSDCOut, "Slippage tolerance exceeded");
        require(usdcReserve >= usdcOut, "Insufficient USDC liquidity");

        // Transfer mETH from user to DEX
        require(
            mETH.transferFrom(msg.sender, address(this), mETHAmount),
            "mETH transfer failed"
        );

        // Update reserves
        mETHReserve += mETHAmount;
        usdcReserve -= usdcOut;

        // Transfer USDC to user
        require(USDC.transfer(msg.sender, usdcOut), "USDC transfer failed");

        emit Swapped(msg.sender, address(mETH), address(USDC), mETHAmount, usdcOut);
    }

    /**
     * @notice Swap USDC for mETH
     * @param usdcAmount Amount of USDC to swap (6 decimals)
     * @param minMETHOut Minimum mETH output (slippage protection, 18 decimals)
     * @return mETHOut Actual mETH output
     */
    function swapUSDCForMETH(
        uint256 usdcAmount,
        uint256 minMETHOut
    ) external nonReentrant returns (uint256 mETHOut) {
        require(usdcAmount > 0, "Amount must be greater than 0");

        // Calculate mETH output
        mETHOut = (usdcAmount * 1e18) / exchangeRate;
        require(mETHOut >= minMETHOut, "Slippage tolerance exceeded");
        require(mETHReserve >= mETHOut, "Insufficient mETH liquidity");

        // Transfer USDC from user to DEX
        require(
            USDC.transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Update reserves
        usdcReserve += usdcAmount;
        mETHReserve -= mETHOut;

        // Transfer mETH to user
        require(mETH.transfer(msg.sender, mETHOut), "mETH transfer failed");

        emit Swapped(msg.sender, address(USDC), address(mETH), usdcAmount, mETHOut);
    }

    /**
     * @notice Add liquidity to DEX (for testing)
     * @param mETHAmount Amount of mETH to add
     * @param usdcAmount Amount of USDC to add
     */
    function addLiquidity(uint256 mETHAmount, uint256 usdcAmount) external onlyOwner {
        if (mETHAmount > 0) {
            require(
                mETH.transferFrom(msg.sender, address(this), mETHAmount),
                "mETH transfer failed"
            );
            mETHReserve += mETHAmount;
        }

        if (usdcAmount > 0) {
            require(
                USDC.transferFrom(msg.sender, address(this), usdcAmount),
                "USDC transfer failed"
            );
            usdcReserve += usdcAmount;
        }

        emit LiquidityAdded(mETHAmount, usdcAmount);
    }

    /**
     * @notice Get current reserves
     * @return mETH reserve and USDC reserve
     */
    function getReserves() external view returns (uint256, uint256) {
        return (mETHReserve, usdcReserve);
    }
}
