// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

// Price oracle interface
interface IMETHPriceOracle {
    function getPrice() external view returns (uint256);
}

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
    function swapMETHToUSDC(uint256 mETHAmount) external returns (uint256);
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
 * 6. Liquidation: If health factor < 110%
 */
contract LeverageVault is Ownable, ReentrancyGuard {
    // External contracts
    IERC20 public mETH;
    IERC20 public usdc;
    address public seniorPool;
    address public fluxionIntegration;
    address public yieldVault;
    IMETHPriceOracle public priceOracle;

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
        bool active; // Position status
    }

    mapping(uint256 => Position) public positions;
    uint256 public nextPositionId;

    // Health factor parameters
    uint256 public constant LIQUIDATION_THRESHOLD = 11000; // 110% (basis points)
    uint256 public constant INITIAL_LTV = 15000; // 150% (basis points)
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
        uint256 mETHSold,
        uint256 usdcRecovered,
        uint256 shortfall
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
     * @param _priceOracle Price oracle address
     */
    constructor(
        address _mETH,
        address _usdc,
        address _seniorPool,
        address _fluxionIntegration,
        address _priceOracle
    ) Ownable(msg.sender) {
        mETH = IERC20(_mETH);
        usdc = IERC20(_usdc);
        seniorPool = _seniorPool;
        fluxionIntegration = _fluxionIntegration;
        priceOracle = IMETHPriceOracle(_priceOracle);
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
     * @notice Create leverage position
     * @param user Investor address
     * @param mETHAmount mETH collateral amount (18 decimals)
     * @param usdcToBorrow USDC to borrow (6 decimals)
     * @param rwaToken RWA token address
     * @param rwaTokenAmount RWA token amount (18 decimals)
     * @param assetId Asset ID reference
     * @return positionId Created position ID
     */
    function createPosition(
        address user,
        uint256 mETHAmount,
        uint256 usdcToBorrow,
        address rwaToken,
        uint256 rwaTokenAmount,
        string memory assetId
    ) external onlyOwner nonReentrant returns (uint256 positionId) {
        require(user != address(0), "Invalid user");
        require(mETHAmount > 0, "mETH amount must be > 0");
        require(usdcToBorrow > 0, "USDC amount must be > 0");
        require(rwaToken != address(0), "Invalid RWA token");

        // Verify LTV (collateral must be >= 150% of loan)
        uint256 collateralValueUSD = _getMETHValueUSD(mETHAmount);
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
            active: true
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
     * @return mETHSwapped Amount of mETH converted to USDC
     * @return usdcReceived Amount of USDC received from swap
     * @return interestPaid Amount of interest paid
     */
    function harvestYield(
        uint256 positionId
    )
        external
        onlyOwner
        nonReentrant
        returns (uint256 mETHSwapped, uint256 usdcReceived, uint256 interestPaid)
    {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");

        // Get outstanding interest from SeniorPool
        uint256 outstandingInterest = ISeniorPool(seniorPool).getAccruedInterest(
            positionId
        );
        require(outstandingInterest > 0, "No interest to pay");

        // Calculate mETH appreciation since last harvest
        uint256 mETHPrice = priceOracle.getPrice();
        uint256 currentValue = _getMETHValueUSD(position.mETHCollateral);

        // Determine mETH to swap (enough to cover interest)
        mETHSwapped = _calculateMETHToSwap(outstandingInterest, mETHPrice);
        require(mETHSwapped <= position.mETHCollateral, "Insufficient collateral");

        // Approve and swap mETH for USDC
        mETH.approve(fluxionIntegration, mETHSwapped);
        usdcReceived = IFluxionIntegration(fluxionIntegration).swapMETHToUSDC(
            mETHSwapped
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
     * @notice Liquidate position if health factor < 110%
     * @param positionId Position ID
     * @return usdcRecovered USDC recovered from liquidation
     * @return shortfall USDC shortfall (if any)
     */
    function liquidatePosition(
        uint256 positionId
    ) external onlyOwner nonReentrant returns (uint256 usdcRecovered, uint256 shortfall) {
        Position storage position = positions[positionId];
        require(position.active, "Position not active");

        // Verify liquidation is necessary
        uint256 healthFactor = getHealthFactor(positionId);
        require(healthFactor < LIQUIDATION_THRESHOLD, "Position is healthy");

        // Swap all mETH collateral for USDC
        uint256 mETHAmount = position.mETHCollateral;
        mETH.approve(fluxionIntegration, mETHAmount);
        usdcRecovered = IFluxionIntegration(fluxionIntegration).swapMETHToUSDC(
            mETHAmount
        );

        // Get outstanding debt
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(
            positionId
        );

        // Repay as much as possible
        uint256 repaymentAmount = usdcRecovered > outstandingDebt
            ? outstandingDebt
            : usdcRecovered;
        usdc.approve(seniorPool, repaymentAmount);
        ISeniorPool(seniorPool).repay(positionId, repaymentAmount);

        // Calculate shortfall
        shortfall = outstandingDebt > usdcRecovered
            ? outstandingDebt - usdcRecovered
            : 0;

        // Mark position as inactive
        position.active = false;
        position.mETHCollateral = 0;

        emit PositionLiquidated(positionId, mETHAmount, usdcRecovered, shortfall);
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
     * @return Health factor (basis points, e.g., 15000 = 150%)
     */
    function getHealthFactor(uint256 positionId) public view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.active) return 0;

        uint256 collateralValueUSD = _getMETHValueUSD(position.mETHCollateral);
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

    /**
     * @notice Get USD value of mETH amount
     * @param mETHAmount mETH amount (18 decimals)
     * @return USD value (6 decimals for USDC)
     */
    function _getMETHValueUSD(uint256 mETHAmount) internal view returns (uint256) {
        uint256 price = priceOracle.getPrice(); // 18 decimals
        // Convert to USDC 6 decimals: (mETH * price) / 1e30
        return (mETHAmount * price) / 1e30;
    }
}
