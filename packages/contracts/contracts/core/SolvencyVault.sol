// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// SeniorPool interface
interface ISeniorPool {
    function borrow(uint256 positionId, uint256 amount) external;

    function repay(
        uint256 positionId,
        uint256 amount
    ) external returns (uint256 principal, uint256 interest);

    function getOutstandingDebt(uint256 positionId) external view returns (uint256);

    function getAccruedInterest(uint256 positionId) external view returns (uint256);
}

// PrimaryMarket interface for liquidation listings
interface IPrimaryMarket {
    enum ListingType { STATIC, AUCTION }

    function createListing(
        bytes32 assetId,
        address tokenAddress,
        ListingType listingType,
        uint256 priceOrReserve,
        uint256 duration,
        uint256 totalSupply,
        uint256 minInvestment
    ) external;
}

// OAID interface
interface IOAID {
    function issueCreditLine(
        address user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 valueUSD,
        uint256 solvencyPositionId
    ) external returns (uint256 creditLineId);
    
    function revokeCreditLine(
        uint256 creditLineId,
        string memory reason
    ) external;
    
    function recordPayment(
        uint256 creditLineId,
        uint256 amount,
        bool onTime,
        uint256 daysLate
    ) external;

    function recordCreditUsage(
        uint256 creditLineId,
        uint256 amount
    ) external;

    function recordCreditRepayment(
        uint256 creditLineId,
        uint256 amount
    ) external;
}

// YieldVault interface
interface IYieldVault {
    function claimYield(address rwaToken, uint256 tokenAmount) external returns (uint256 usdcReceived);
}

/**
 * @title SolvencyVault
 * @notice Collateral vault for borrowing USDC against RWA tokens or Private Asset tokens
 * @dev Supports two token types with different LTV ratios and liquidation flows
 *
 * Normal Flow:
 * 1. User deposits RWA/PrivateAsset tokens as collateral
 * 2. Vault borrows USDC from SeniorPool based on LTV (70% for RWA, 60% for Private)
 * 3. If OAID enabled: Issues on-chain credit line for user
 * 4. User repays loan + interest (recorded in OAID payment history)
 * 5. User withdraws collateral after full repayment
 *
 * Liquidation Flows (health factor < 115%):
 * 
 * RWA Token Liquidation (Invoice-backed assets):
 * 1. liquidatePosition() - Marks position as liquidated, revokes OAID credit line
 * 2. Wait for invoice settlement/maturity
 * 3. settleLiquidation() - Burns RWA tokens for USDC yield via YieldVault
 * 4. Repay debt, take 10% fee, return excess to user
 * 
 * Private Asset Liquidation:
 * 1. liquidatePosition() - Marks liquidated, revokes OAID credit line
 * 2. Admin purchases collateral via purchaseAndSettleLiquidation()
 * 3. Admin sends USDC, receives Private Asset tokens
 * 4. Contract repays debt, takes 10% fee from excess, returns remainder to user
 *    (Admin can then do anything with the tokens - sell, hold, redistribute, etc.)
 */
contract SolvencyVault is Ownable, ReentrancyGuard {
    // Token types
    enum TokenType {
        RWA,            // RWA tokens from marketplace (70% LTV)
        PRIVATE_ASSET   // Private asset tokens (60% LTV)
    }

    // Position tracking
    struct Position {
        address user;               // Borrower address
        address collateralToken;    // Token address (RWA or PrivateAsset)
        uint256 collateralAmount;   // Token amount deposited (18 decimals)
        uint256 usdcBorrowed;       // USDC borrowed from SeniorPool (6 decimals)
        uint256 tokenValueUSD;      // Valuation at deposit time (6 decimals)
        uint256 createdAt;          // Position creation timestamp
        uint256 liquidatedAt;       // Liquidation timestamp (0 if not liquidated)
        uint256 creditLineId;       // OAID credit line ID (0 if not issued)
        bool active;                // Position status
        TokenType tokenType;        // RWA or PRIVATE_ASSET
    }

    // External contracts
    IERC20 public usdc;
    address public seniorPool;
    address public primaryMarket;
    address public oaid;            // Optional OAID integration

    // Position management
    mapping(uint256 => Position) public positions;
    uint256 public nextPositionId;

    // LTV and health parameters (basis points)
    uint256 public constant RWA_LTV = 7000;                     // 70%
    uint256 public constant PRIVATE_ASSET_LTV = 6000;           // 60%
    uint256 public constant LIQUIDATION_THRESHOLD = 11500;      // 115%
    uint256 public constant LIQUIDATION_FEE_BPS = 1000;         // 10% liquidation fee
    uint256 public constant BASIS_POINTS = 10000;

    // Liquidation tracking
    mapping(uint256 => bool) public positionsInLiquidation;     // positionId => liquidation status
    address public yieldVault;                                   // YieldVault contract for burning RWA tokens

    // Repayment Schedule
    struct RepaymentPlan {
        uint256 loanDuration;          // Total duration in seconds (e.g., 90 days)
        uint256 numberOfInstallments;  // Total installments (e.g., 18)
        uint256 installmentInterval;   // Duration of each interval (seconds)
        uint256 nextPaymentDue;        // Timestamp of next due date
        uint256 installmentsPaid;      // Counter
        uint256 missedPayments;        // Counter for missed/late payments
        bool isActive;                 // If plan is active
        bool defaulted;                // Marked as defaulted by admin
    }

    mapping(uint256 => RepaymentPlan) public repaymentPlans;

    // Events
    event PositionCreated(
        uint256 indexed positionId,
        address indexed user,
        address collateralToken,
        uint256 collateralAmount,
        uint256 tokenValueUSD,
        TokenType tokenType
    );
    event USDCBorrowed(
        uint256 indexed positionId,
        uint256 amount,
        uint256 totalDebt
    );
    event RepaymentPlanCreated(
        uint256 indexed positionId,
        uint256 loanDuration,
        uint256 numberOfInstallments,
        uint256 installmentInterval,
        uint256 nextPaymentDue
    );
    event LoanRepaid(
        uint256 indexed positionId,
        uint256 amount,
        uint256 principal,
        uint256 interest,
        uint256 remainingDebt
    );
    event MissedPaymentMarked(
        uint256 indexed positionId,
        uint256 missedPayments
    );
    event PositionDefaulted(
        uint256 indexed positionId
    );
    event CollateralWithdrawn(
        uint256 indexed positionId,
        address indexed user,
        uint256 amount
    );
    event PositionLiquidated(
        uint256 indexed positionId,
        uint256 liquidationTime
    );
    event LiquidationSettled(
        uint256 indexed positionId,
        uint256 yieldReceived,
        uint256 debtRepaid,
        uint256 liquidationFee,
        uint256 userRefund
    );
    event OAIDCreditIssued(
        uint256 indexed positionId,
        uint256 creditLineId,
        uint256 creditLimit
    );
    event CreditLineRevoked(
        uint256 indexed positionId,
        uint256 indexed creditLineId,
        string reason
    );
    event PrivateAssetLiquidationSettled(
        uint256 indexed positionId,
        address indexed purchaser,
        uint256 purchaseAmount,
        uint256 tokensTransferred,
        uint256 debtRepaid,
        uint256 liquidationFee,
        uint256 userRefund
    );

    /**
     * @notice Initialize Solvency Vault
     * @param _usdc USDC token address
     * @param _seniorPool SeniorPool contract address
     */
    constructor(
        address _usdc,
        address _seniorPool
    ) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        seniorPool = _seniorPool;
        nextPositionId = 1;
    }

    /**
     * @notice Set PrimaryMarket address
     * @param _primaryMarket PrimaryMarket contract address
     */
    function setPrimaryMarket(address _primaryMarket) external onlyOwner {
        require(_primaryMarket != address(0), "Invalid address");
        primaryMarket = _primaryMarket;
    }

    /**
     * @notice Set OAID address (optional)
     * @param _oaid OAID contract address
     */
    function setOAID(address _oaid) external onlyOwner {
        require(_oaid != address(0), "Invalid address");
        oaid = _oaid;
    }

    /**
     * @notice Set YieldVault address
     * @param _yieldVault YieldVault contract address
     */
    function setYieldVault(address _yieldVault) external onlyOwner {
        require(_yieldVault != address(0), "Invalid address");
        yieldVault = _yieldVault;
    }

    /**
     * @notice Deposit collateral tokens
     * @param collateralToken Token address (RWA or PrivateAsset)
     * @param collateralAmount Token amount (18 decimals)
     * @param tokenValueUSD Valuation in USD (6 decimals)
     * @param tokenType RWA or PRIVATE_ASSET
     * @param issueOAID Whether to issue OAID credit line
     * @return positionId Created position ID
     */
    function depositCollateral(
        address collateralToken,
        uint256 collateralAmount,
        uint256 tokenValueUSD,
        TokenType tokenType,
        bool issueOAID
    ) external nonReentrant returns (uint256 positionId) {
        require(collateralToken != address(0), "Invalid token");
        require(collateralAmount > 0, "Amount must be > 0");
        require(tokenValueUSD > 0, "Valuation must be > 0");

        // Transfer tokens from user to vault
        require(
            IERC20(collateralToken).transferFrom(msg.sender, address(this), collateralAmount),
            "Token transfer failed"
        );

        // Create position
        positionId = nextPositionId++;
        positions[positionId] = Position({
            user: msg.sender,
            collateralToken: collateralToken,
            collateralAmount: collateralAmount,
            usdcBorrowed: 0,
            tokenValueUSD: tokenValueUSD,
            createdAt: block.timestamp,
            liquidatedAt: 0,
            creditLineId: 0,
            active: true,
            tokenType: tokenType
        });

        emit PositionCreated(
            positionId,
            msg.sender,
            collateralToken,
            collateralAmount,
            tokenValueUSD,
            tokenType
        );

        // Issue OAID credit line if requested
        if (issueOAID && oaid != address(0)) {
            uint256 ltv = tokenType == TokenType.RWA ? RWA_LTV : PRIVATE_ASSET_LTV;
            uint256 creditLimit = (tokenValueUSD * ltv) / BASIS_POINTS;

            uint256 creditLineId = IOAID(oaid).issueCreditLine(
                msg.sender,
                collateralToken,
                collateralAmount,
                tokenValueUSD,
                positionId
            );
            // Store credit line ID in position
            positions[positionId].creditLineId = creditLineId;
            emit OAIDCreditIssued(positionId, creditLineId, creditLimit);
        }
    }

    /**
     * @notice Borrow USDC against collateral with repayment schedule
     * @param positionId Position ID
     * @param amount USDC amount to borrow (6 decimals)
     * @param loanDuration Total duration of the loan in seconds
     * @param numberOfInstallments Number of fixed installments
     */
    function borrowUSDC(
        uint256 positionId,
        uint256 amount,
        uint256 loanDuration,
        uint256 numberOfInstallments
    ) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(msg.sender == position.user, "Not position owner");
        require(amount > 0, "Amount must be > 0");

        // Validate repayment terms
        require(loanDuration > 0, "Duration must be > 0");
        require(numberOfInstallments > 0, "Installments must be > 0");
        require(loanDuration >= numberOfInstallments, "Invalid duration/installments");
        
        // Ensure no existing plan for this position (or support refinancing later)
        require(!repaymentPlans[positionId].isActive, "Plan already active");

        // Calculate max borrowable amount based on LTV
        uint256 ltv = position.tokenType == TokenType.RWA ? RWA_LTV : PRIVATE_ASSET_LTV;
        uint256 maxBorrow = (position.tokenValueUSD * ltv) / BASIS_POINTS;
        uint256 newTotalBorrowed = position.usdcBorrowed + amount;

        require(newTotalBorrowed <= maxBorrow, "Exceeds LTV limit");

        // Calculate installment interval
        uint256 installmentInterval = loanDuration / numberOfInstallments;

        // Initialize RepaymentPlan
        repaymentPlans[positionId] = RepaymentPlan({
            loanDuration: loanDuration,
            numberOfInstallments: numberOfInstallments,
            installmentInterval: installmentInterval,
            nextPaymentDue: block.timestamp + installmentInterval,
            installmentsPaid: 0,
            missedPayments: 0,
            isActive: true,
            defaulted: false
        });

        // Borrow from SeniorPool
        ISeniorPool(seniorPool).borrow(positionId, amount);

        // Update position
        position.usdcBorrowed += amount;

        // Record credit usage in OAID if credit line exists
        if (oaid != address(0) && position.creditLineId > 0) {
            IOAID(oaid).recordCreditUsage(position.creditLineId, amount);
        }

        // Transfer USDC to user
        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");

        emit USDCBorrowed(positionId, amount, position.usdcBorrowed);
        emit RepaymentPlanCreated(
            positionId,
            loanDuration,
            numberOfInstallments,
            installmentInterval,
            block.timestamp + installmentInterval
        );
    }

    /**
     * @notice Repay loan (principal + interest)
     * @param positionId Position ID
     * @param amount USDC amount to repay (6 decimals)
     */
    function repayLoan(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(msg.sender == position.user, "Not position owner");
        require(amount > 0, "Amount must be > 0");

        // Transfer USDC from user
        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        // Approve SeniorPool to take repayment
        usdc.approve(seniorPool, amount);

        // Repay to SeniorPool
        (uint256 principal, uint256 interest) = ISeniorPool(seniorPool).repay(
            positionId,
            amount
        );

        // Update position
        position.usdcBorrowed -= principal;

        uint256 remainingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);
        
        // Update Repayment Plan
        RepaymentPlan storage plan = repaymentPlans[positionId];

        if (plan.isActive) {
            // Increment installments paid
            plan.installmentsPaid++;

            // If fully repaid (based on debt, not installments count, as installments are estimated)
            if (remainingDebt == 0) {
                plan.isActive = false;
            }
        }

        // Record payment in OAID if credit line exists
        if (oaid != address(0) && position.creditLineId > 0) {
            // Reduce credit used by principal amount
            if (principal > 0) {
                IOAID(oaid).recordCreditRepayment(position.creditLineId, principal);
            }

            IOAID(oaid).recordPayment(
                position.creditLineId,
                amount,
                true, // Always mark as on-time here; missed payments are marked by admin
                0
            );
        }

        emit LoanRepaid(positionId, amount, principal, interest, remainingDebt);
    }

    /**
     * @notice Withdraw collateral (requires full loan repayment)
     * @param positionId Position ID
     * @param amount Token amount to withdraw (18 decimals)
     */
    function withdrawCollateral(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(msg.sender == position.user, "Not position owner");
        require(amount > 0, "Amount must be > 0");
        require(amount <= position.collateralAmount, "Insufficient collateral");

        // Verify no outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);
        require(outstandingDebt == 0, "Outstanding debt must be repaid");

        // Update position
        position.collateralAmount -= amount;

        // Close position if fully withdrawn
        if (position.collateralAmount == 0) {
            position.active = false;
            if (repaymentPlans[positionId].isActive) {
                repaymentPlans[positionId].isActive = false;
            }
        }

        // Transfer tokens to user
        require(
            IERC20(position.collateralToken).transfer(msg.sender, amount),
            "Token transfer failed"
        );

        emit CollateralWithdrawn(positionId, msg.sender, amount);
    }

    /**
     * @notice Mark a missed payment (Admin only)
     * @param positionId Position ID
     */
    function markMissedPayment(uint256 positionId) external onlyOwner {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        
        RepaymentPlan storage plan = repaymentPlans[positionId];
        require(plan.isActive, "Plan not active");

        plan.missedPayments++;

        // Record missed payment in OAID (0 amount, onTime=false)
        if (oaid != address(0) && position.creditLineId > 0) {
            IOAID(oaid).recordPayment(
                position.creditLineId,
                0,      // amount
                false,  // onTime (false = missed/late)
                1       // daysLate (placeholder)
            );
        }

        emit MissedPaymentMarked(positionId, plan.missedPayments);
    }

    /**
     * @notice Mark position as defaulted (Admin only)
     * @param positionId Position ID
     */
    function markDefaulted(uint256 positionId) external onlyOwner {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        
        RepaymentPlan storage plan = repaymentPlans[positionId];
        require(plan.isActive, "Plan not active");

        plan.defaulted = true;

        emit PositionDefaulted(positionId);
    }

    /**
     * @notice Mark position for liquidation (health < 115% OR marked defaulted)
     * @param positionId Position ID
     * @dev Two flows:
     *      - RWA tokens: Mark for liquidation, wait for invoice settlement
     *      - Private Assets: Mark for liquidation, admin can purchase directly
     */
    function liquidatePosition(
        uint256 positionId
    ) external onlyOwner nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(!positionsInLiquidation[positionId], "Already in liquidation");

        // Verify liquidation is necessary
        // 1. Health Factor Check (< 115%)
        uint256 healthFactor = getHealthFactor(positionId);
        bool healthLiquidatable = healthFactor < LIQUIDATION_THRESHOLD;

        // 2. Repayment Default Check (marked by admin)
        RepaymentPlan storage plan = repaymentPlans[positionId];
        bool defaultLiquidatable = plan.isActive && plan.defaulted;

        require(healthLiquidatable || defaultLiquidatable, "Position is healthy and not defaulted");

        // Mark position as liquidated (but keep active to hold tokens)
        positionsInLiquidation[positionId] = true;
        position.liquidatedAt = block.timestamp;

        // Deactivate repayment plan
        if (plan.isActive) {
            plan.isActive = false;
        }

        // Revoke OAID credit line if exists
        if (oaid != address(0) && position.creditLineId > 0) {
            string memory reason = healthLiquidatable 
                ? "Position liquidated - collateral health below threshold"
                : "Position liquidated - repayment default";
                
            IOAID(oaid).revokeCreditLine(
                position.creditLineId,
                reason
            );
            
            emit CreditLineRevoked(
                positionId,
                position.creditLineId,
                reason
            );
        }

        emit PositionLiquidated(positionId, block.timestamp);
    }

    /**
     * @notice Process liquidation settlement by burning RWA tokens for yield
     * @param positionId Position ID
     * @dev Called after RWA settlement - burns tokens, repays loan, takes 10% fee, returns excess
     *      Only for RWA token collateral
     */
    function settleLiquidation(
        uint256 positionId
    ) external onlyOwner nonReentrant returns (uint256 yieldReceived, uint256 liquidationFee, uint256 userRefund) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(positionsInLiquidation[positionId], "Position not liquidated");
        require(position.tokenType == TokenType.RWA, "Only for RWA tokens");
        require(yieldVault != address(0), "YieldVault not set");

        // Approve YieldVault to burn RWA tokens
        IERC20(position.collateralToken).approve(yieldVault, position.collateralAmount);

        // Get USDC balance before
        uint256 balanceBefore = usdc.balanceOf(address(this));

        // Burn RWA tokens to claim USDC yield using low-level call (no return value expected)
        (bool success, ) = yieldVault.call(
            abi.encodeWithSignature(
                "claimYield(address,uint256)",
                position.collateralToken,
                position.collateralAmount
            )
        );
        require(success, "YieldVault claim failed");

        // Calculate USDC received
        uint256 balanceAfter = usdc.balanceOf(address(this));
        yieldReceived = balanceAfter - balanceBefore;
        require(yieldReceived > 0, "No yield received");

        // Get outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        uint256 debtRepaid = 0;
        
        if (outstandingDebt > 0) {
            // Repay as much debt as possible
            uint256 repaymentAmount = yieldReceived > outstandingDebt
                ? outstandingDebt
                : yieldReceived;

            usdc.approve(seniorPool, repaymentAmount);
            ISeniorPool(seniorPool).repay(positionId, repaymentAmount);
            debtRepaid = repaymentAmount;
        }

        // Calculate liquidation fee and user refund from excess
        if (yieldReceived > debtRepaid) {
            uint256 excess = yieldReceived - debtRepaid;
            
            // Calculate 10% liquidation fee
            liquidationFee = (excess * LIQUIDATION_FEE_BPS) / BASIS_POINTS;
            userRefund = excess - liquidationFee;

            // Transfer liquidation fee to admin (owner)
            if (liquidationFee > 0) {
                require(
                    usdc.transfer(owner(), liquidationFee),
                    "Fee transfer failed"
                );
            }

            // Transfer remaining USDC to user
            if (userRefund > 0) {
                require(
                    usdc.transfer(position.user, userRefund),
                    "Refund transfer failed"
                );
            }
        } else {
            liquidationFee = 0;
            userRefund = 0;
        }

        // Mark position as inactive
        position.active = false;
        position.collateralAmount = 0;

        emit LiquidationSettled(positionId, yieldReceived, debtRepaid, liquidationFee, userRefund);
    }

    /**
     * @notice Admin purchases liquidated Private Asset collateral and settles position
     * @param positionId Position ID
     * @param purchaseAmount USDC amount admin is paying (6 decimals)
     * @dev Admin sends USDC, receives Private Asset tokens, contract settles debt and fees
     *      Only for Private Asset collateral that has been liquidated
     */
    function purchaseAndSettleLiquidation(
        uint256 positionId,
        uint256 purchaseAmount
    ) external onlyOwner nonReentrant returns (uint256 liquidationFee, uint256 userRefund) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(positionsInLiquidation[positionId], "Position not liquidated");
        require(position.tokenType == TokenType.PRIVATE_ASSET, "Only for Private Assets");
        require(purchaseAmount > 0, "Purchase amount must be > 0");

        // Transfer USDC from admin
        require(
            usdc.transferFrom(msg.sender, address(this), purchaseAmount),
            "USDC transfer failed"
        );

        // Transfer Private Asset tokens to admin
        require(
            IERC20(position.collateralToken).transfer(msg.sender, position.collateralAmount),
            "Token transfer failed"
        );

        // Get outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        uint256 debtRepaid = 0;
        
        if (outstandingDebt > 0) {
            // Repay as much debt as possible
            uint256 repaymentAmount = purchaseAmount > outstandingDebt
                ? outstandingDebt
                : purchaseAmount;

            usdc.approve(seniorPool, repaymentAmount);
            ISeniorPool(seniorPool).repay(positionId, repaymentAmount);
            debtRepaid = repaymentAmount;
        }

        // Calculate liquidation fee and user refund from excess
        if (purchaseAmount > debtRepaid) {
            uint256 excess = purchaseAmount - debtRepaid;
            
            // Calculate 10% liquidation fee
            liquidationFee = (excess * LIQUIDATION_FEE_BPS) / BASIS_POINTS;
            userRefund = excess - liquidationFee;

            // Transfer liquidation fee to admin (already msg.sender/owner)
            // Fee stays in contract, will be withdrawn by admin later
            // Or send to a separate fee collector address

            // Transfer remaining USDC to user
            if (userRefund > 0) {
                require(
                    usdc.transfer(position.user, userRefund),
                    "Refund transfer failed"
                );
            }
        } else {
            liquidationFee = 0;
            userRefund = 0;
        }

        // Mark position as inactive
        position.active = false;
        position.collateralAmount = 0;

        emit PrivateAssetLiquidationSettled(
            positionId,
            msg.sender,
            purchaseAmount,
            position.collateralAmount,
            debtRepaid,
            liquidationFee,
            userRefund
        );
    }

    /**
     * @notice Get health factor for position
     * @param positionId Position ID
     * @return Health factor (basis points, e.g., 15000 = 150%)
     */
    function getHealthFactor(uint256 positionId) public view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.active) return 0;

        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);
        if (outstandingDebt == 0) return type(uint256).max;

        // Health factor = (collateralValueUSD / debt) * BASIS_POINTS
        return (position.tokenValueUSD * BASIS_POINTS) / outstandingDebt;
    }

    /**
     * @notice Get position details
     * @param positionId Position ID
     * @return Position struct
     */
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    /**
     * @notice Get max borrowable amount for position
     * @param positionId Position ID
     * @return Max USDC amount (6 decimals)
     */
    function getMaxBorrow(uint256 positionId) external view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.active) return 0;

        uint256 ltv = position.tokenType == TokenType.RWA ? RWA_LTV : PRIVATE_ASSET_LTV;
        uint256 maxBorrow = (position.tokenValueUSD * ltv) / BASIS_POINTS;
        uint256 currentDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        return maxBorrow > currentDebt ? maxBorrow - currentDebt : 0;
    }

    /**
     * @notice Get repayment plan details
     * @param positionId Position ID
     * @return RepaymentPlan struct
     */
    function getRepaymentPlan(uint256 positionId) external view returns (RepaymentPlan memory) {
        return repaymentPlans[positionId];
    }
}
