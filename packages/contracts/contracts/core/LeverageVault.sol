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

// FluxionIntegration interface
interface IFluxionIntegration {
    function swapMETHToUSDC(uint256 mETHAmount, uint256 mETHPriceUSD) external returns (uint256);
}

// PrimaryMarket interface
interface IPrimaryMarket {
    function buyTokens(bytes32 assetId, uint256 amount) external;
}

/**
 * @title LeverageVault
 * @notice Core vault for managing leveraged RWA token purchases using mETH collateral
 * @dev Handles collateral custody, position management, yield harvesting, and settlement waterfall
 *
 * Flow:
 * 1. User deposits mETH as collateral (150% LTV)
 * 2. Vault borrows USDC from SeniorPool
 * 3. Backend purchases RWA tokens, transfers to vault
 * 4. Daily harvest: mETH yield → USDC → Interest payment
 * 5. Settlement: Waterfall distribution (Senior → Interest → User yield)
 * 6. Liquidation < 115%: Sell only buffer mETH (15%), return base 100% mETH to user
 * 7. RWA Settlement: Burn RWA tokens, repay loan, take 10% fee, refund user
 */
contract LeverageVault is Ownable, ReentrancyGuard {
    // External contracts
    IERC20 public mETH;
    IERC20 public usdc;
    address public seniorPool;
    address public fluxionIntegration;
    address public yieldVault;
    address public primaryMarket;

    // Position tracking
    struct Position {
        address user; // Investor address
        uint256 mETHCollateral; // mETH deposited (18 decimals)
        uint256 usdcBorrowed; // USDC borrowed from SeniorPool (6 decimals)
        address rwaToken; // RWA token address
        uint256 rwaTokenAmount; // RWA tokens held (18 decimals)
        string assetId; // Asset ID reference
        uint256 createdAt; // Position creation timestamp
        uint256 lastHarvestTime; // Last yield harvest timestamp
        uint256 totalInterestPaid; // Cumulative interest paid
        uint256 liquidatedAt; // Liquidation timestamp (0 if not liquidated)
        bool active; // Position status
        bool inLiquidation; // Whether position is in liquidation process
    }

    mapping(uint256 => Position) public positions;
    uint256 public nextPositionId;

    // Health factor parameters
    uint256 public constant LIQUIDATION_THRESHOLD = 11500; // 115% (basis points)
    uint256 public constant INITIAL_LTV = 15000; // 150% (basis points)
    uint256 public constant LIQUIDATION_FEE_BPS = 1000; // 10% liquidation fee (basis points)
    uint256 public constant BASIS_POINTS = 10000;

    // Events
    event PositionCreated(
        uint256 indexed positionId,
        address indexed user,
        uint256 mETHCollateral,
        uint256 usdcBorrowed,
        address rwaToken,
        uint256 rwaTokenAmount
    );
    event YieldHarvested(
        uint256 indexed positionId,
        uint256 mETHSwapped,
        uint256 usdcReceived,
        uint256 interestPaid
    );
    event PositionLiquidated(
        uint256 indexed positionId,
        uint256 bufferMETHSold,
        uint256 usdcRecovered,
        uint256 baseMETHReturned,
        uint256 debtRepaid
    );
    event LiquidationSettled(
        uint256 indexed positionId,
        uint256 rwaTokensBurned,
        uint256 yieldReceived,
        uint256 debtRepaid,
        uint256 liquidationFee,
        uint256 userRefund
    );
    event SettlementProcessed(
        uint256 indexed positionId,
        uint256 seniorRepayment,
        uint256 interestRepayment,
        uint256 userYield
    );
    event CollateralAdded(uint256 indexed positionId, uint256 amount);

    /**
     * @notice Initialize Leverage Vault
     * @param _mETH mETH token address
     * @param _usdc USDC token address
     * @param _seniorPool SeniorPool contract address
     * @param _fluxionIntegration FluxionIntegration contract address
     * @dev mETH price is provided by backend in each function call (no on-chain oracle)
     */
    constructor(
        address _mETH,
        address _usdc,
        address _seniorPool,
        address _fluxionIntegration
    ) Ownable(msg.sender) {
        mETH = IERC20(_mETH);
        usdc = IERC20(_usdc);
        seniorPool = _seniorPool;
        fluxionIntegration = _fluxionIntegration;
        nextPositionId = 1;
    }

    /**
     * @notice Set YieldVault address (one-time)
     * @param _yieldVault YieldVault contract address
     */
    function setYieldVault(address _yieldVault) external onlyOwner {
        require(yieldVault == address(0), "YieldVault already set");
        require(_yieldVault != address(0), "Invalid address");
        yieldVault = _yieldVault;
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
     * @notice Create leverage position
     * @param user Investor address
     * @param mETHAmount mETH collateral amount (18 decimals)
     * @param usdcToBorrow USDC to borrow (6 decimals)
     * @param rwaToken RWA token address
     * @param rwaTokenAmount RWA token amount (18 decimals)
     * @param assetId Asset ID reference (string)
     * @param assetIdBytes Asset ID reference (bytes32 for PrimaryMarket)
     * @param mETHPriceUSD Current mETH price in USD (18 decimals, e.g., 3000e18 = $3000)
     * @return positionId Created position ID
     */
    function createPosition(
        address user,
        uint256 mETHAmount,
        uint256 usdcToBorrow,
        address rwaToken,
        uint256 rwaTokenAmount,
        string memory assetId,
        bytes32 assetIdBytes,
        uint256 mETHPriceUSD
    ) external onlyOwner nonReentrant returns (uint256 positionId) {
        require(user != address(0), "Invalid user");
        require(mETHAmount > 0, "mETH amount must be > 0");
        require(usdcToBorrow > 0, "USDC amount must be > 0");
        require(rwaToken != address(0), "Invalid RWA token");
        require(mETHPriceUSD > 0, "Invalid mETH price");
        require(primaryMarket != address(0), "PrimaryMarket not set");

        // Verify LTV (collateral must be >= 150% of loan)
        // Calculate collateral value: (mETHAmount * mETHPriceUSD) / 1e30
        // 1e30 = 1e18 (mETH decimals) * 1e18 (price decimals) / 1e6 (USDC decimals)
        uint256 collateralValueUSD = (mETHAmount * mETHPriceUSD) / 1e30;
        uint256 requiredCollateral = (usdcToBorrow * INITIAL_LTV) / BASIS_POINTS;
        require(
            collateralValueUSD >= requiredCollateral,
            "Insufficient collateral (150% LTV required)"
        );

        // Transfer mETH from user to vault
        require(
            mETH.transferFrom(user, address(this), mETHAmount),
            "mETH transfer failed"
        );

        // Borrow USDC from SeniorPool
        ISeniorPool(seniorPool).borrow(nextPositionId, usdcToBorrow);

        // Buy RWA tokens from PrimaryMarket
        usdc.approve(primaryMarket, usdcToBorrow);
        IPrimaryMarket(primaryMarket).buyTokens(assetIdBytes, rwaTokenAmount);

        // Verify RWA tokens were received
        require(
            IERC20(rwaToken).balanceOf(address(this)) >= rwaTokenAmount, 
            "RWA token purchase failed"
        );

        // Create position
        positionId = nextPositionId++;
        positions[positionId] = Position({
            user: user,
            mETHCollateral: mETHAmount,
            usdcBorrowed: usdcToBorrow,
            rwaToken: rwaToken,
            rwaTokenAmount: rwaTokenAmount,
            assetId: assetId,
            createdAt: block.timestamp,
            lastHarvestTime: block.timestamp,
            totalInterestPaid: 0,
            liquidatedAt: 0,
            active: true,
            inLiquidation: false
        });

        emit PositionCreated(
            positionId,
            user,
            mETHAmount,
            usdcToBorrow,
            rwaToken,
            rwaTokenAmount
        );
    }

    /**
     * @notice Harvest mETH yield and pay interest
     * @param positionId Position ID
     * @param mETHPriceUSD Current mETH price in USD (18 decimals)
     * @return mETHSwapped Amount of mETH converted to USDC
     * @return usdcReceived Amount of USDC received from swap
     * @return interestPaid Amount of interest paid
     */
    function harvestYield(
        uint256 positionId,
        uint256 mETHPriceUSD
    )
        external
        onlyOwner
        nonReentrant
        returns (uint256 mETHSwapped, uint256 usdcReceived, uint256 interestPaid)
    {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(mETHPriceUSD > 0, "Invalid mETH price");

        // Get outstanding interest from SeniorPool
        uint256 outstandingInterest = ISeniorPool(seniorPool).getAccruedInterest(
            positionId
        );
        require(outstandingInterest > 0, "No interest to pay");

        // Determine mETH to swap (enough to cover interest)
        mETHSwapped = _calculateMETHToSwap(outstandingInterest, mETHPriceUSD);
        require(mETHSwapped <= position.mETHCollateral, "Insufficient collateral");

        // Approve and swap mETH for USDC
        mETH.approve(fluxionIntegration, mETHSwapped);
        usdcReceived = IFluxionIntegration(fluxionIntegration).swapMETHToUSDC(
            mETHSwapped,
            mETHPriceUSD
        );

        // Pay interest to SeniorPool
        interestPaid = usdcReceived > outstandingInterest
            ? outstandingInterest
            : usdcReceived;
        usdc.approve(seniorPool, interestPaid);
        ISeniorPool(seniorPool).repay(positionId, interestPaid);

        // Update position
        position.mETHCollateral -= mETHSwapped;
        position.totalInterestPaid += interestPaid;
        position.lastHarvestTime = block.timestamp;

        emit YieldHarvested(positionId, mETHSwapped, usdcReceived, interestPaid);
    }

    /**
     * @notice Liquidate position if health factor < 115%
     * @dev Sells only buffer mETH (excess over 100% LTV), returns base mETH to user, holds RWA for settlement
     * @param positionId Position ID
     * @param mETHPriceUSD Current mETH price in USD (18 decimals)
     * @return bufferMETHSold Amount of excess mETH sold
     * @return usdcRecovered USDC from buffer sale
     * @return baseMETHReturned Base mETH collateral returned to user
     * @return debtRepaid Amount of debt repaid from buffer sale
     */
    function liquidatePosition(
        uint256 positionId,
        uint256 mETHPriceUSD
    ) external onlyOwner nonReentrant returns (uint256 bufferMETHSold, uint256 usdcRecovered, uint256 baseMETHReturned, uint256 debtRepaid) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(!position.inLiquidation, "Already in liquidation");
        require(mETHPriceUSD > 0, "Invalid mETH price");

        // Verify liquidation is necessary
        uint256 healthFactor = getHealthFactor(positionId, mETHPriceUSD);
        require(healthFactor < LIQUIDATION_THRESHOLD, "Position is healthy");

        address positionUser = position.user;
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        // Calculate base collateral (100% of debt value in mETH)
        // baseMETH = (debt * 1e30) / mETHPrice
        uint256 baseMETHAmount = (outstandingDebt * 1e30) / mETHPriceUSD;
        
        // Calculate buffer (excess collateral = total - base)
        bufferMETHSold = position.mETHCollateral > baseMETHAmount 
            ? position.mETHCollateral - baseMETHAmount 
            : 0;

        require(bufferMETHSold > 0, "No buffer to sell");

        // Sell buffer mETH for USDC
        mETH.approve(fluxionIntegration, bufferMETHSold);
        usdcRecovered = IFluxionIntegration(fluxionIntegration).swapMETHToUSDC(
            bufferMETHSold,
            mETHPriceUSD
        );

        // Repay as much debt as possible with buffer proceeds
        debtRepaid = usdcRecovered > outstandingDebt ? outstandingDebt : usdcRecovered;
        if (debtRepaid > 0) {
            usdc.approve(seniorPool, debtRepaid);
            ISeniorPool(seniorPool).repay(positionId, debtRepaid);
        }

        // Return base mETH collateral to user
        baseMETHReturned = baseMETHAmount;
        if (baseMETHReturned > 0) {
            require(
                mETH.transfer(positionUser, baseMETHReturned),
                "Base mETH transfer failed"
            );
        }

        // Update position - keep active to hold RWA tokens until settlement
        position.mETHCollateral = 0; // All mETH distributed (buffer sold, base returned)
        position.inLiquidation = true;
        position.liquidatedAt = block.timestamp;

        emit PositionLiquidated(positionId, bufferMETHSold, usdcRecovered, baseMETHReturned, debtRepaid);
    }

    /**
     * @notice Claim USDC yield by burning RWA tokens held by this vault
     * @param positionId Position ID
     * @param _yieldVault YieldVault contract address
     * @param rwaToken RWA token address
     * @param tokenAmount Amount of RWA tokens to burn
     * @return usdcReceived Amount of USDC received from YieldVault
     */
    function claimYieldFromBurn(
        uint256 positionId,
        address _yieldVault,
        address rwaToken,
        uint256 tokenAmount
    ) external onlyOwner nonReentrant returns (uint256 usdcReceived) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(position.rwaToken == rwaToken, "Token mismatch");
        require(tokenAmount <= position.rwaTokenAmount, "Insufficient RWA tokens");

        // Approve YieldVault to burn tokens from this contract
        IERC20(rwaToken).approve(_yieldVault, tokenAmount);

        // Get USDC balance before claim
        uint256 balanceBefore = usdc.balanceOf(address(this));

        // Call YieldVault.claimYield to burn tokens and receive USDC
        (bool success, ) = _yieldVault.call(
            abi.encodeWithSignature("claimYield(address,uint256)", rwaToken, tokenAmount)
        );
        require(success, "YieldVault claim failed");

        // Calculate USDC received
        uint256 balanceAfter = usdc.balanceOf(address(this));
        usdcReceived = balanceAfter - balanceBefore;

        // Update position
        position.rwaTokenAmount -= tokenAmount;

        return usdcReceived;
    }

    /**
     * @notice Settle liquidated position by burning RWA tokens for yield
     * @dev Called after RWA settlement - burns RWA, repays remaining debt, takes 10% fee, refunds user
     * @param positionId Position ID
     * @return yieldReceived USDC received from burning RWA tokens
     * @return liquidationFee 10% liquidation fee sent to admin
     * @return userRefund Remaining USDC sent to user
     */
    function settleLiquidation(
        uint256 positionId
    ) external onlyOwner nonReentrant returns (uint256 yieldReceived, uint256 liquidationFee, uint256 userRefund) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(position.inLiquidation, "Position not in liquidation");
        require(yieldVault != address(0), "YieldVault not set");
        require(position.rwaTokenAmount > 0, "No RWA tokens to burn");

        // Approve YieldVault to burn RWA tokens
        IERC20(position.rwaToken).approve(yieldVault, position.rwaTokenAmount);

        // Get USDC balance before
        uint256 balanceBefore = usdc.balanceOf(address(this));

        // Burn RWA tokens to claim USDC yield
        (bool success, ) = yieldVault.call(
            abi.encodeWithSignature("claimYield(address,uint256)", position.rwaToken, position.rwaTokenAmount)
        );
        require(success, "YieldVault claim failed");

        // Calculate USDC received
        uint256 balanceAfter = usdc.balanceOf(address(this));
        yieldReceived = balanceAfter - balanceBefore;
        require(yieldReceived > 0, "No yield received");

        uint256 rwaTokensBurned = position.rwaTokenAmount;
        position.rwaTokenAmount = 0;

        // Get outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);
        uint256 debtRepaid = 0;

        if (outstandingDebt > 0) {
            // Repay as much debt as possible
            uint256 repaymentAmount = yieldReceived > outstandingDebt ? outstandingDebt : yieldReceived;
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

        emit LiquidationSettled(positionId, rwaTokensBurned, yieldReceived, debtRepaid, liquidationFee, userRefund);
    }

    /**
     * @notice Process settlement waterfall when RWA asset settles
     * @param positionId Position ID
     * @param settlementUSDC Total USDC from asset settlement
     * @return seniorRepayment Amount repaid to SeniorPool
     * @return interestRepayment Amount paid for interest
     * @return userYield Amount distributed to user
     */
    function processSettlement(
        uint256 positionId,
        uint256 settlementUSDC
    )
        external
        onlyOwner
        nonReentrant
        returns (uint256 seniorRepayment, uint256 interestRepayment, uint256 userYield)
    {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");

        // Get outstanding debt from SeniorPool
        uint256 totalDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);

        // Waterfall distribution:
        // 1. Senior Pool principal
        // 2. Accrued interest
        // 3. Remaining USDC to user
        if (settlementUSDC >= totalDebt) {
            // Full repayment + user yield
            usdc.approve(seniorPool, totalDebt);
            (seniorRepayment, interestRepayment) = ISeniorPool(seniorPool).repay(
                positionId,
                totalDebt
            );
            userYield = settlementUSDC - totalDebt;

            // Transfer user yield
            if (userYield > 0) {
                require(
                    usdc.transfer(position.user, userYield),
                    "User yield transfer failed"
                );
            }
        } else {
            // Partial repayment (prioritize principal, then interest)
            usdc.approve(seniorPool, settlementUSDC);
            (seniorRepayment, interestRepayment) = ISeniorPool(seniorPool).repay(
                positionId,
                settlementUSDC
            );
            userYield = 0;
        }

        // Return remaining mETH collateral to user
        if (position.mETHCollateral > 0) {
            require(
                mETH.transfer(position.user, position.mETHCollateral),
                "mETH return failed"
            );
        }

        // Mark position as inactive
        position.active = false;

        emit SettlementProcessed(
            positionId,
            seniorRepayment,
            interestRepayment,
            userYield
        );
    }

    /**
     * @notice Add collateral to position
     * @param positionId Position ID
     * @param mETHAmount Additional mETH collateral
     */
    function addCollateral(
        uint256 positionId,
        uint256 mETHAmount
    ) external nonReentrant {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");
        require(msg.sender == position.user, "Not position owner");
        require(mETHAmount > 0, "Amount must be > 0");

        // Transfer mETH from user
        require(
            mETH.transferFrom(msg.sender, address(this), mETHAmount),
            "mETH transfer failed"
        );

        position.mETHCollateral += mETHAmount;

        emit CollateralAdded(positionId, mETHAmount);
    }

    /**
     * @notice Get health factor for position
     * @param positionId Position ID
     * @param mETHPriceUSD Current mETH price in USD (18 decimals)
     * @return Health factor (basis points, e.g., 15000 = 150%)
     */
    function getHealthFactor(uint256 positionId, uint256 mETHPriceUSD) public view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.active) return 0;
        require(mETHPriceUSD > 0, "Invalid mETH price");

        // Calculate collateral value: (mETHAmount * mETHPriceUSD) / 1e30
        uint256 collateralValueUSD = (position.mETHCollateral * mETHPriceUSD) / 1e30;
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(
            positionId
        );

        if (outstandingDebt == 0) return type(uint256).max;

        // Health factor = (collateralValue / debt) * BASIS_POINTS
        return (collateralValueUSD * BASIS_POINTS) / outstandingDebt;
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
     * @notice Calculate mETH to swap for target USDC amount
     * @param targetUSDC Target USDC amount (6 decimals)
     * @param mETHPrice Current mETH price (18 decimals)
     * @return mETH amount needed (18 decimals)
     */
    function _calculateMETHToSwap(
        uint256 targetUSDC,
        uint256 mETHPrice
    ) internal pure returns (uint256) {
        // mETH = (targetUSDC * 1e18 * 1e12) / mETHPrice
        // 1e12 converts USDC (6 decimals) to 18 decimals
        return (targetUSDC * 1e30) / mETHPrice;
    }
}
