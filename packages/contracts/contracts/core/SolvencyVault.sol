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
}

/**
 * @title SolvencyVault
 * @notice Collateral vault for borrowing USDC against RWA tokens or Private Asset tokens
 * @dev Supports two token types with different LTV ratios, manual admin-triggered liquidation
 *
 * Flow:
 * 1. User deposits RWA/PrivateAsset tokens as collateral
 * 2. Vault borrows USDC from SeniorPool based on LTV
 * 3. User repays loan + interest
 * 4. User withdraws collateral after full repayment
 * 5. Liquidation: If health factor < 110%, admin creates marketplace listing
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
    uint256 public constant LIQUIDATION_THRESHOLD = 11000;      // 110%
    uint256 public constant BASIS_POINTS = 10000;

    // Liquidation tracking
    mapping(uint256 => bytes32) public liquidationListings;     // positionId => marketplace assetId

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
    event LoanRepaid(
        uint256 indexed positionId,
        uint256 amount,
        uint256 principal,
        uint256 interest,
        uint256 remainingDebt
    );
    event CollateralWithdrawn(
        uint256 indexed positionId,
        address indexed user,
        uint256 amount
    );
    event PositionLiquidated(
        uint256 indexed positionId,
        bytes32 marketplaceAssetId,
        uint256 discountedPrice
    );
    event OAIDCreditIssued(
        uint256 indexed positionId,
        uint256 creditLineId,
        uint256 creditLimit
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

            emit OAIDCreditIssued(positionId, creditLineId, creditLimit);
        }
    }

    /**
     * @notice Borrow USDC against collateral
     * @param positionId Position ID
     * @param amount USDC amount to borrow (6 decimals)
     */
    function borrowUSDC(uint256 positionId, uint256 amount) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(msg.sender == position.user, "Not position owner");
        require(amount > 0, "Amount must be > 0");

        // Calculate max borrowable amount based on LTV
        uint256 ltv = position.tokenType == TokenType.RWA ? RWA_LTV : PRIVATE_ASSET_LTV;
        uint256 maxBorrow = (position.tokenValueUSD * ltv) / BASIS_POINTS;
        uint256 newTotalBorrowed = position.usdcBorrowed + amount;

        require(newTotalBorrowed <= maxBorrow, "Exceeds LTV limit");

        // Borrow from SeniorPool
        ISeniorPool(seniorPool).borrow(positionId, amount);

        // Update position
        position.usdcBorrowed += amount;

        // Transfer USDC to user
        require(usdc.transfer(msg.sender, amount), "USDC transfer failed");

        emit USDCBorrowed(positionId, amount, position.usdcBorrowed);
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
        }

        // Transfer tokens to user
        require(
            IERC20(position.collateralToken).transfer(msg.sender, amount),
            "Token transfer failed"
        );

        emit CollateralWithdrawn(positionId, msg.sender, amount);
    }

    /**
     * @notice Liquidate position (admin-only)
     * @param positionId Position ID
     * @param marketplaceAssetId Marketplace asset ID for listing
     * @dev Creates discounted listing on PrimaryMarket (90% of valuation)
     */
    function liquidatePosition(
        uint256 positionId,
        bytes32 marketplaceAssetId
    ) external onlyOwner nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");

        // Verify liquidation is necessary (health < 110%)
        uint256 healthFactor = getHealthFactor(positionId);
        require(healthFactor < LIQUIDATION_THRESHOLD, "Position is healthy");

        // Calculate discounted price (90% of valuation)
        // tokenValueUSD is per collateralAmount, so calculate per-token price
        uint256 totalValue = position.tokenValueUSD; // Already in 6 decimals
        uint256 discountedValue = (totalValue * 9000) / BASIS_POINTS; // 90%
        uint256 pricePerToken = (discountedValue * 1e18) / position.collateralAmount;

        // Create static listing on PrimaryMarket with no duration and min investment 0
        IERC20(position.collateralToken).approve(primaryMarket, position.collateralAmount);

        IPrimaryMarket(primaryMarket).createListing(
            marketplaceAssetId,
            position.collateralToken,
            IPrimaryMarket.ListingType.STATIC,
            pricePerToken,
            0, // duration (not used for STATIC)
            position.collateralAmount,
            0  // minInvestment (no minimum for liquidation sales)
        );

        // Track liquidation
        liquidationListings[positionId] = marketplaceAssetId;
        position.active = false;

        emit PositionLiquidated(positionId, marketplaceAssetId, pricePerToken);
    }

    /**
     * @notice Process liquidation settlement (called after marketplace sale)
     * @param positionId Position ID
     * @param saleProceeds USDC received from sale (6 decimals)
     */
    function processLiquidationSettlement(
        uint256 positionId,
        uint256 saleProceeds
    ) external onlyOwner nonReentrant {
        Position storage position = positions[positionId];
        require(!position.active, "Position still active");
        require(liquidationListings[positionId] != bytes32(0), "Not liquidated");

        // Get outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        if (outstandingDebt > 0) {
            // Repay as much debt as possible
            uint256 repaymentAmount = saleProceeds > outstandingDebt
                ? outstandingDebt
                : saleProceeds;

            usdc.approve(seniorPool, repaymentAmount);
            ISeniorPool(seniorPool).repay(positionId, repaymentAmount);

            // Return surplus to user (if any)
            if (saleProceeds > outstandingDebt) {
                uint256 surplus = saleProceeds - outstandingDebt;
                require(
                    usdc.transfer(position.user, surplus),
                    "Surplus transfer failed"
                );
            }
        }
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
}
