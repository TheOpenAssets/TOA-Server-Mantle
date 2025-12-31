// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// DEX interface
interface IFluxionDEX {
    function swapMETHForUSDC(
        uint256 mETHAmount,
        uint256 minUSDCOut
    ) external returns (uint256 usdcOut);

    function getQuote(uint256 mETHAmount) external view returns (uint256);
}

// Price oracle interface
interface IMETHPriceOracle {
    function getPrice() external view returns (uint256);
}

/**
 * @title FluxionIntegration
 * @notice Wrapper for Fluxion DEX integration with slippage protection
 * @dev Handles mETH → USDC swaps for yield harvesting with safety checks
 *
 * Features:
 * - Slippage protection (max 3%)
 * - Price validation against oracle
 * - Swap statistics tracking
 * - Emergency pause functionality
 */
contract FluxionIntegration is Ownable, ReentrancyGuard {

    IERC20 public mETH;
    IERC20 public usdc;
    IFluxionDEX public dex;
    IMETHPriceOracle public priceOracle;

    // Slippage parameters
    uint256 public constant MAX_SLIPPAGE = 300; // 3% max slippage (basis points)
    uint256 public constant BASIS_POINTS = 10000;

    // Swap statistics
    uint256 public totalSwapsExecuted;
    uint256 public totalMETHSwapped;
    uint256 public totalUSDCReceived;

    // Emergency controls
    bool public paused;

    // Events
    event SwapExecuted(
        uint256 indexed timestamp,
        uint256 mETHAmount,
        uint256 usdcReceived,
        uint256 effectiveRate
    );
    event SlippageExceeded(uint256 expected, uint256 actual, uint256 slippage);
    event PausedUpdated(bool paused);

    modifier whenNotPaused() {
        require(!paused, "Contract is paused");
        _;
    }

    /**
     * @notice Initialize Fluxion Integration
     * @param _mETH mETH token address
     * @param _usdc USDC token address
     * @param _dex Fluxion DEX address
     * @param _priceOracle Price oracle address (can be mETH token itself)
     */
    constructor(
        address _mETH,
        address _usdc,
        address _dex,
        address _priceOracle
    ) Ownable(msg.sender) {
        mETH = IERC20(_mETH);
        usdc = IERC20(_usdc);
        dex = IFluxionDEX(_dex);
        priceOracle = IMETHPriceOracle(_priceOracle);
        paused = false;
    }

    /**
     * @notice Pause/unpause swaps (emergency)
     * @param _paused New pause state
     */
    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PausedUpdated(_paused);
    }

    /**
     * @notice Update DEX address
     * @param _dex New DEX address
     */
    function setDEX(address _dex) external onlyOwner {
        require(_dex != address(0), "Invalid address");
        dex = IFluxionDEX(_dex);
    }

    /**
     * @notice Update price oracle address
     * @param _oracle New oracle address
     */
    function setPriceOracle(address _oracle) external onlyOwner {
        require(_oracle != address(0), "Invalid address");
        priceOracle = IMETHPriceOracle(_oracle);
    }

    /**
     * @notice Swap mETH for USDC with slippage protection
     * @param mETHAmount Amount of mETH to swap (18 decimals)
     * @return usdcReceived Amount of USDC received (6 decimals)
     */
    function swapMETHToUSDC(
        uint256 mETHAmount
    ) external nonReentrant whenNotPaused returns (uint256 usdcReceived) {
        require(mETHAmount > 0, "Amount must be > 0");

        // Get quote from DEX
        uint256 expectedUSDC = dex.getQuote(mETHAmount);
        require(expectedUSDC > 0, "Invalid quote");

        // Validate quote against oracle price
        _validatePrice(mETHAmount, expectedUSDC);

        // Calculate minimum output with slippage tolerance
        uint256 minUSDCOut = (expectedUSDC * (BASIS_POINTS - MAX_SLIPPAGE)) /
            BASIS_POINTS;

        // Transfer mETH from caller to this contract
        require(
            mETH.transferFrom(msg.sender, address(this), mETHAmount),
            "mETH transfer failed"
        );

        // Approve DEX to spend mETH
        mETH.approve(address(dex), mETHAmount);

        // Execute swap
        usdcReceived = dex.swapMETHForUSDC(mETHAmount, minUSDCOut);

        // Verify slippage is within tolerance
        uint256 slippageBps = ((expectedUSDC - usdcReceived) * BASIS_POINTS) /
            expectedUSDC;
        require(slippageBps <= MAX_SLIPPAGE, "Slippage exceeded");

        // Update statistics
        totalSwapsExecuted++;
        totalMETHSwapped += mETHAmount;
        totalUSDCReceived += usdcReceived;

        // Transfer USDC to caller
        require(usdc.transfer(msg.sender, usdcReceived), "USDC transfer failed");

        // Calculate effective rate (USDC per mETH, 6 decimals)
        uint256 effectiveRate = (usdcReceived * 1e18) / mETHAmount;

        emit SwapExecuted(block.timestamp, mETHAmount, usdcReceived, effectiveRate);
    }

    /**
     * @notice Get swap quote from DEX
     * @param mETHAmount Amount of mETH (18 decimals)
     * @return Expected USDC output (6 decimals)
     */
    function getQuote(uint256 mETHAmount) external view returns (uint256) {
        return dex.getQuote(mETHAmount);
    }

    /**
     * @notice Get mETH price from oracle
     * @return Price in USD (18 decimals)
     */
    function getMETHPrice() external view returns (uint256) {
        return priceOracle.getPrice();
    }

    /**
     * @notice Calculate USD value of mETH amount
     * @param mETHAmount Amount of mETH (18 decimals)
     * @return USD value (6 decimals for USDC)
     */
    function getMETHValueUSD(uint256 mETHAmount) external view returns (uint256) {
        uint256 priceUSD = priceOracle.getPrice(); // 18 decimals
        // Convert to USDC 6 decimals: (mETH * price) / 1e18 / 1e12
        return (mETHAmount * priceUSD) / 1e30;
    }

    /**
     * @notice Get swap statistics
     * @return Total swaps, total mETH swapped, total USDC received
     */
    function getSwapStats() external view returns (uint256, uint256, uint256) {
        return (totalSwapsExecuted, totalMETHSwapped, totalUSDCReceived);
    }

    /**
     * @notice Validate swap price against oracle
     * @param mETHAmount mETH amount being swapped
     * @param expectedUSDC Expected USDC from DEX quote
     */
    function _validatePrice(uint256 mETHAmount, uint256 expectedUSDC) internal view {
        uint256 oraclePrice = priceOracle.getPrice(); // USD per mETH (18 decimals)

        // Calculate expected USDC from oracle price
        uint256 oracleExpectedUSDC = (mETHAmount * oraclePrice) / 1e30; // Convert to 6 decimals

        // Allow 5% deviation between oracle and DEX
        uint256 maxDeviation = 500; // 5% in basis points
        uint256 deviationBps;

        if (expectedUSDC > oracleExpectedUSDC) {
            deviationBps =
                ((expectedUSDC - oracleExpectedUSDC) * BASIS_POINTS) /
                oracleExpectedUSDC;
        } else {
            deviationBps =
                ((oracleExpectedUSDC - expectedUSDC) * BASIS_POINTS) /
                oracleExpectedUSDC;
        }

        require(
            deviationBps <= maxDeviation,
            "Price deviation too high"
        );
    }

    /**
     * @notice Emergency withdraw tokens (owner only)
     * @param token Token address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(
        address token,
        uint256 amount
    ) external onlyOwner {
        require(IERC20(token).transfer(owner(), amount), "Transfer failed");
    }
}
