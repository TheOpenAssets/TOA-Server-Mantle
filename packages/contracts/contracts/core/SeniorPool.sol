// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SeniorPool
 * @notice USDC lending pool for leverage positions at 5% APR
 * @dev Provides USDC loans to LeverageVault for investor leverage purchases
 *
 * Features:
 * - USDC deposits from liquidity providers
 * - Loans with 5% APR interest accrual
 * - Liquidity reserve requirements (20-30%)
 * - Debt ceiling per position ($100k max)
 * - Interest compounding for demo mode
 */
contract SeniorPool is Ownable, ReentrancyGuard {
    IERC20 public usdc;
    address public leverageVault;
    address public solvencyVault;

    // Pool parameters
    uint256 public constant APR = 500; // 5% APR (basis points)
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant DEBT_CEILING = 100_000 * 1e6; // $100k per position (USDC 6 decimals)
    uint256 public constant RESERVE_RATIO = 2000; // 20% reserve requirement (basis points)

    // Pool state
    uint256 public totalLiquidity; // Total USDC deposited
    uint256 public totalBorrowed; // Total USDC currently borrowed
    uint256 public totalInterestEarned; // Cumulative interest earned

    // Loan tracking
    struct Loan {
        uint256 principal; // Original loan amount
        uint256 interestAccrued; // Accumulated interest
        uint256 lastUpdateTime; // Last interest calculation timestamp
        bool active; // Loan status
    }

    mapping(uint256 => Loan) public loans; // positionId => Loan

    // Demo mode for accelerated time
    bool public demoMode;
    uint256 public timeMultiplier; // e.g., 360 for 360x acceleration

    // Events
    event LiquidityDeposited(address indexed depositor, uint256 amount);
    event LiquidityWithdrawn(address indexed withdrawer, uint256 amount);
    event LoanIssued(uint256 indexed positionId, uint256 amount);
    event LoanRepaid(uint256 indexed positionId, uint256 principal, uint256 interest);
    event InterestAccrued(uint256 indexed positionId, uint256 interest);
    event DemoModeUpdated(bool enabled, uint256 multiplier);

    modifier onlyAuthorizedVault() {
        require(
            msg.sender == leverageVault || msg.sender == solvencyVault,
            "Only authorized vault"
        );
        _;
    }

    /**
     * @notice Initialize Senior Pool
     * @param _usdc USDC token address
     */
    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        demoMode = false;
        timeMultiplier = 1;
    }

    /**
     * @notice Set LeverageVault address (one-time)
     * @param _leverageVault LeverageVault contract address
     */
    function setLeverageVault(address _leverageVault) external onlyOwner {
        require(leverageVault == address(0), "LeverageVault already set");
        require(_leverageVault != address(0), "Invalid address");
        leverageVault = _leverageVault;
    }

    /**
     * @notice Set SolvencyVault address (one-time)
     * @param _solvencyVault SolvencyVault contract address
     */
    function setSolvencyVault(address _solvencyVault) external onlyOwner {
        require(solvencyVault == address(0), "SolvencyVault already set");
        require(_solvencyVault != address(0), "Invalid address");
        solvencyVault = _solvencyVault;
    }

    /**
     * @notice Enable/disable demo mode for time acceleration
     * @param _enabled Enable demo mode
     * @param _multiplier Time multiplier (e.g., 360 for 360x)
     */
    function setDemoMode(bool _enabled, uint256 _multiplier) external onlyOwner {
        require(_multiplier > 0, "Multiplier must be > 0");
        demoMode = _enabled;
        timeMultiplier = _multiplier;
        emit DemoModeUpdated(_enabled, _multiplier);
    }

    /**
     * @notice Deposit USDC liquidity into pool
     * @param amount Amount of USDC to deposit (6 decimals)
     */
    function depositLiquidity(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        totalLiquidity += amount;
        emit LiquidityDeposited(msg.sender, amount);
    }

    /**
     * @notice Withdraw USDC liquidity from pool
     * @param amount Amount of USDC to withdraw (6 decimals)
     */
    function withdrawLiquidity(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= getAvailableLiquidity(), "Insufficient available liquidity");

        totalLiquidity -= amount;
        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");

        emit LiquidityWithdrawn(msg.sender, amount);
    }

    /**
     * @notice Borrow USDC for leverage position
     * @param positionId Unique position identifier
     * @param amount Amount to borrow (6 decimals)
     */
    function borrow(uint256 positionId, uint256 amount) external onlyAuthorizedVault nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(amount <= DEBT_CEILING, "Exceeds debt ceiling");
        // Removed restriction: Users can open multiple positions
        // require(!loans[positionId].active, "Loan already exists");
        require(amount <= getAvailableLiquidity(), "Insufficient liquidity");

        // Create loan (or overwrite if exists - each position should have unique ID anyway)
        loans[positionId] = Loan({
            principal: amount,
            interestAccrued: 0,
            lastUpdateTime: block.timestamp,
            active: true
        });

        totalBorrowed += amount;

        // Transfer USDC to calling vault
        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");

        emit LoanIssued(positionId, amount);
    }

    /**
     * @notice Repay loan (principal + interest)
     * @param positionId Position identifier
     * @param amount Amount to repay (6 decimals)
     * @return principal Principal repaid
     * @return interest Interest repaid
     */
    function repay(
        uint256 positionId,
        uint256 amount
    ) external onlyAuthorizedVault nonReentrant returns (uint256 principal, uint256 interest) {
        require(loans[positionId].active, "Loan not active");

        // Update interest before repayment
        _accrueInterest(positionId);

        Loan storage loan = loans[positionId];
        uint256 totalOwed = loan.principal + loan.interestAccrued;
        require(amount <= totalOwed, "Amount exceeds debt");

        // Calculate principal and interest portions
        if (amount <= loan.interestAccrued) {
            // Repaying only interest
            interest = amount;
            principal = 0;
            loan.interestAccrued -= interest;
        } else {
            // Repaying interest + principal
            interest = loan.interestAccrued;
            principal = amount - interest;
            loan.interestAccrued = 0;
            loan.principal -= principal;
        }

        // Update pool state
        totalBorrowed -= principal;
        totalInterestEarned += interest;
        totalLiquidity += interest; // Interest stays in pool

        // Transfer USDC from calling vault
        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        // Close loan if fully repaid
        if (loan.principal == 0) {
            loan.active = false;
        }

        emit LoanRepaid(positionId, principal, interest);
    }

    /**
     * @notice Get outstanding debt for position (principal + accrued interest)
     * @param positionId Position identifier
     * @return Outstanding debt amount
     */
    function getOutstandingDebt(uint256 positionId) external view returns (uint256) {
        if (!loans[positionId].active) return 0;

        Loan memory loan = loans[positionId];
        uint256 pendingInterest = _calculateInterest(positionId);
        return loan.principal + loan.interestAccrued + pendingInterest;
    }

    /**
     * @notice Get accrued interest for position
     * @param positionId Position identifier
     * @return Accrued interest amount
     */
    function getAccruedInterest(uint256 positionId) external view returns (uint256) {
        if (!loans[positionId].active) return 0;

        Loan memory loan = loans[positionId];
        uint256 pendingInterest = _calculateInterest(positionId);
        return loan.interestAccrued + pendingInterest;
    }

    /**
     * @notice Get available liquidity for lending
     * @return Available USDC amount
     */
    function getAvailableLiquidity() public view returns (uint256) {
        // Ensure reserve requirement is met
        uint256 requiredReserve = (totalBorrowed * RESERVE_RATIO) / BASIS_POINTS;
        uint256 available = totalLiquidity > totalBorrowed
            ? totalLiquidity - totalBorrowed
            : 0;

        return available > requiredReserve ? available - requiredReserve : 0;
    }

    /**
     * @notice Accrue interest for a loan
     * @param positionId Position identifier
     */
    function accrueInterest(uint256 positionId) external {
        require(loans[positionId].active, "Loan not active");
        _accrueInterest(positionId);
    }

    /**
     * @notice Internal: Accrue interest for a loan
     * @param positionId Position identifier
     */
    function _accrueInterest(uint256 positionId) internal {
        Loan storage loan = loans[positionId];
        uint256 interest = _calculateInterest(positionId);

        if (interest > 0) {
            loan.interestAccrued += interest;
            loan.lastUpdateTime = block.timestamp;
            emit InterestAccrued(positionId, interest);
        }
    }

    /**
     * @notice Internal: Calculate pending interest
     * @param positionId Position identifier
     * @return Pending interest amount
     */
    function _calculateInterest(uint256 positionId) internal view returns (uint256) {
        Loan memory loan = loans[positionId];
        if (!loan.active || loan.principal == 0) return 0;

        uint256 timeElapsed = block.timestamp - loan.lastUpdateTime;

        // Apply time multiplier for demo mode
        if (demoMode) {
            timeElapsed = timeElapsed * timeMultiplier;
        }

        // Interest = (principal * APR * timeElapsed) / (BASIS_POINTS * SECONDS_PER_YEAR)
        // APR is in basis points (500 = 5%)
        uint256 interest = (loan.principal * APR * timeElapsed) /
            (BASIS_POINTS * 365 days);

        return interest;
    }

    /**
     * @notice Get pool statistics
     * @return Total liquidity, total borrowed, available liquidity, total interest earned
     */
    function getPoolStats()
        external
        view
        returns (uint256, uint256, uint256, uint256)
    {
        return (
            totalLiquidity,
            totalBorrowed,
            getAvailableLiquidity(),
            totalInterestEarned
        );
    }
}
