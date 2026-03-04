// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title MockArbitrumDEX
 * @notice Mock DEX for testing stARB ↔ USDC swaps on Arbitrum
 * @dev Simulates an AMM with configurable exchange rates for demo scenarios
 *
 * Features:
 * - Swap stARB for USDC (and vice versa)
 * - Configurable exchange rate for demo
 * - Slippage simulation
 * - Liquidity tracking
 */
contract MockArbitrumDEX is Ownable, ReentrancyGuard {
    IERC20 public stARB;
    IERC20 public USDC;

    // Exchange rate: 1 stARB = X USDC (with 6 decimals to match USDC)
    // Example: 0.8 * 1e6 = 800000 USDC per stARB
    uint256 public exchangeRate;

    // Liquidity reserves
    uint256 public stARBReserve;
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
    event LiquidityAdded(uint256 stARBAmount, uint256 usdcAmount);

    /**
     * @notice Initialize Mock Arbitrum DEX
     * @param _stARB MockStARB token address
     * @param _USDC USDC token address
     * @param _initialExchangeRate Initial exchange rate (USDC per stARB, 6 decimals)
     */
    constructor(
        address _stARB,
        address _USDC,
        uint256 _initialExchangeRate
    ) Ownable(msg.sender) {
        stARB = IERC20(_stARB);
        USDC = IERC20(_USDC);
        exchangeRate = _initialExchangeRate;
        emit ExchangeRateUpdated(0, _initialExchangeRate);
    }

    /**
     * @notice Set exchange rate (for demo scenarios)
     * @param newRate New exchange rate (USDC per stARB, 6 decimals)
     */
    function setExchangeRate(uint256 newRate) external onlyOwner {
        require(newRate > 0, "Rate must be greater than 0");
        uint256 oldRate = exchangeRate;
        exchangeRate = newRate;
        emit ExchangeRateUpdated(oldRate, newRate);
    }

    /**
     * @notice Get quote for stARB → USDC swap
     * @param stARBAmount Amount of stARB to swap (18 decimals)
     * @return Expected USDC output (6 decimals)
     */
    function getQuote(uint256 stARBAmount) external view returns (uint256) {
        // Convert stARB (18 decimals) to USDC (6 decimals) using exchange rate
        return (stARBAmount * exchangeRate) / 1e18;
    }

    /**
     * @notice Get quote for USDC → stARB swap
     * @param usdcAmount Amount of USDC to swap (6 decimals)
     * @return Expected stARB output (18 decimals)
     */
    function getQuoteReverse(uint256 usdcAmount) external view returns (uint256) {
        // Convert USDC (6 decimals) to stARB (18 decimals) using exchange rate
        return (usdcAmount * 1e18) / exchangeRate;
    }

    /**
     * @notice Swap stARB for USDC
     * @param stARBAmount Amount of stARB to swap (18 decimals)
     * @param minUSDCOut Minimum USDC output (slippage protection, 6 decimals)
     * @return usdcOut Actual USDC output
     */
    function swapStARBForUSDC(
        uint256 stARBAmount,
        uint256 minUSDCOut
    ) external nonReentrant returns (uint256 usdcOut) {
        require(stARBAmount > 0, "Amount must be greater than 0");

        // Calculate USDC output
        usdcOut = (stARBAmount * exchangeRate) / 1e18;
        require(usdcOut >= minUSDCOut, "Slippage tolerance exceeded");
        require(usdcReserve >= usdcOut, "Insufficient USDC liquidity");

        // Transfer stARB from user to DEX
        require(
            stARB.transferFrom(msg.sender, address(this), stARBAmount),
            "stARB transfer failed"
        );

        // Update reserves
        stARBReserve += stARBAmount;
        usdcReserve -= usdcOut;

        // Transfer USDC to user
        require(USDC.transfer(msg.sender, usdcOut), "USDC transfer failed");

        emit Swapped(msg.sender, address(stARB), address(USDC), stARBAmount, usdcOut);
    }

    /**
     * @notice Swap USDC for stARB
     * @param usdcAmount Amount of USDC to swap (6 decimals)
     * @param minStARBOut Minimum stARB output (slippage protection, 18 decimals)
     * @return stARBOut Actual stARB output
     */
    function swapUSDCForStARB(
        uint256 usdcAmount,
        uint256 minStARBOut
    ) external nonReentrant returns (uint256 stARBOut) {
        require(usdcAmount > 0, "Amount must be greater than 0");

        // Calculate stARB output
        stARBOut = (usdcAmount * 1e18) / exchangeRate;
        require(stARBOut >= minStARBOut, "Slippage tolerance exceeded");
        require(stARBReserve >= stARBOut, "Insufficient stARB liquidity");

        // Transfer USDC from user to DEX
        require(
            USDC.transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Update reserves
        usdcReserve += usdcAmount;
        stARBReserve -= stARBOut;

        // Transfer stARB to user
        require(stARB.transfer(msg.sender, stARBOut), "stARB transfer failed");

        emit Swapped(msg.sender, address(USDC), address(stARB), usdcAmount, stARBOut);
    }

    /**
     * @notice Swap exact stARB for exact USDC (backend calculates amounts)
     * @dev This is the preferred method - backend calculates exchange rate off-chain using historical data
     * @param stARBAmount Exact amount of stARB to swap (18 decimals)
     * @param exactUSDCOut Exact amount of USDC to receive (6 decimals) - calculated by backend
     * @return usdcOut Actual USDC output (should match exactUSDCOut)
     */
    function swapStARBForUSDCExact(
        uint256 stARBAmount,
        uint256 exactUSDCOut
    ) external nonReentrant returns (uint256 usdcOut) {
        require(stARBAmount > 0, "stARB amount must be greater than 0");
        require(exactUSDCOut > 0, "USDC amount must be greater than 0");
        require(usdcReserve >= exactUSDCOut, "Insufficient USDC liquidity");

        // Transfer stARB from user to DEX
        require(
            stARB.transferFrom(msg.sender, address(this), stARBAmount),
            "stARB transfer failed"
        );

        // Update reserves
        stARBReserve += stARBAmount;
        usdcReserve -= exactUSDCOut;

        // Transfer exact USDC to user
        require(USDC.transfer(msg.sender, exactUSDCOut), "USDC transfer failed");

        emit Swapped(msg.sender, address(stARB), address(USDC), stARBAmount, exactUSDCOut);
        return exactUSDCOut;
    }

    /**
     * @notice Swap exact USDC for exact stARB (backend calculates amounts)
     * @dev This is the preferred method - backend calculates exchange rate off-chain using historical data
     * @param usdcAmount Exact amount of USDC to swap (6 decimals)
     * @param exactStARBOut Exact amount of stARB to receive (18 decimals) - calculated by backend
     * @return stARBOut Actual stARB output (should match exactStARBOut)
     */
    function swapUSDCForStARBExact(
        uint256 usdcAmount,
        uint256 exactStARBOut
    ) external nonReentrant returns (uint256 stARBOut) {
        require(usdcAmount > 0, "USDC amount must be greater than 0");
        require(exactStARBOut > 0, "stARB amount must be greater than 0");
        require(stARBReserve >= exactStARBOut, "Insufficient stARB liquidity");

        // Transfer USDC from user to DEX
        require(
            USDC.transferFrom(msg.sender, address(this), usdcAmount),
            "USDC transfer failed"
        );

        // Update reserves
        usdcReserve += usdcAmount;
        stARBReserve -= exactStARBOut;

        // Transfer exact stARB to user
        require(stARB.transfer(msg.sender, exactStARBOut), "stARB transfer failed");

        emit Swapped(msg.sender, address(USDC), address(stARB), usdcAmount, exactStARBOut);
        return exactStARBOut;
    }

    /**
     * @notice Add liquidity to DEX (for testing)
     * @param stARBAmount Amount of stARB to add
     * @param usdcAmount Amount of USDC to add
     */
    function addLiquidity(uint256 stARBAmount, uint256 usdcAmount) external onlyOwner {
        if (stARBAmount > 0) {
            require(
                stARB.transferFrom(msg.sender, address(this), stARBAmount),
                "stARB transfer failed"
            );
            stARBReserve += stARBAmount;
        }

        if (usdcAmount > 0) {
            require(
                USDC.transferFrom(msg.sender, address(this), usdcAmount),
                "USDC transfer failed"
            );
            usdcReserve += usdcAmount;
        }

        emit LiquidityAdded(stARBAmount, usdcAmount);
    }

    /**
     * @notice Get current reserves
     * @return stARB reserve and USDC reserve
     */
    function getReserves() external view returns (uint256, uint256) {
        return (stARBReserve, usdcReserve);
    }
}
