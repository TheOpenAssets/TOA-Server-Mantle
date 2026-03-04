// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISeniorPool {
    function borrow(uint256 positionId, uint256 amount) external;
    function repay(uint256 positionId, uint256 amount) external returns (uint256 principal, uint256 interest);
    function getOutstandingDebt(uint256 positionId) external view returns (uint256);
    function getAccruedInterest(uint256 positionId) external view returns (uint256);
}

interface ICTCDEXIntegration {
    function swapCTCToUSDC(uint256 ctcAmount, uint256 ctcPriceUSD) external returns (uint256);
}

interface IPrimaryMarket {
    function buyTokens(bytes32 assetId, uint256 amount) external;
}

/**
 * @title CTCLeverageVault
 * @notice Core vault for managing leveraged RWA token purchases using CTC collateral on Credit Coin
 */
contract CTCLeverageVault is Ownable, ReentrancyGuard {
    IERC20 public ctc;
    IERC20 public usdc;
    address public seniorPool;
    address public ctcDexIntegration;
    address public yieldVault;
    address public primaryMarket;

    struct Position {
        address user;
        uint256 ctcCollateral;
        uint256 usdcBorrowed;
        address rwaToken;
        uint256 rwaTokenAmount;
        string assetId;
        uint256 createdAt;
        uint256 lastHarvestTime;
        uint256 totalInterestPaid;
        uint256 liquidatedAt;
        bool active;
        bool inLiquidation;
    }

    mapping(uint256 => Position) public positions;
    uint256 public nextPositionId;

    uint256 public constant LIQUIDATION_THRESHOLD = 11500; // 115%
    uint256 public constant INITIAL_LTV = 15000; // 150%
    uint256 public constant BASIS_POINTS = 10000;

    event PositionCreated(uint256 indexed positionId, address indexed user, uint256 ctcCollateral, uint256 usdcBorrowed);
    event YieldHarvested(uint256 indexed positionId, uint256 ctcSwapped, uint256 usdcReceived, uint256 interestPaid);

    constructor(
        address _ctc,
        address _usdc,
        address _seniorPool,
        address _ctcDexIntegration
    ) Ownable(msg.sender) {
        ctc = IERC20(_ctc);
        usdc = IERC20(_usdc);
        seniorPool = _seniorPool;
        ctcDexIntegration = _ctcDexIntegration;
        nextPositionId = 1;
    }

    function setYieldVault(address _yieldVault) external onlyOwner {
        yieldVault = _yieldVault;
    }

    function setPrimaryMarket(address _primaryMarket) external onlyOwner {
        primaryMarket = _primaryMarket;
    }

    function createPosition(
        address user,
        uint256 ctcAmount,
        uint256 usdcToBorrow,
        address rwaToken,
        uint256 rwaTokenAmount,
        string memory assetId,
        bytes32 assetIdBytes,
        uint256 ctcPriceUSD
    ) external onlyOwner nonReentrant returns (uint256 positionId) {
        uint256 collateralValueUSD = (ctcAmount * ctcPriceUSD) / 1e30;
        uint256 requiredCollateral = (usdcToBorrow * INITIAL_LTV) / BASIS_POINTS;
        require(collateralValueUSD >= requiredCollateral, "Insufficient collateral");

        require(ctc.transferFrom(user, address(this), ctcAmount), "CTC transfer failed");
        ISeniorPool(seniorPool).borrow(nextPositionId, usdcToBorrow);

        usdc.approve(primaryMarket, usdcToBorrow);
        IPrimaryMarket(primaryMarket).buyTokens(assetIdBytes, rwaTokenAmount);

        positionId = nextPositionId++;
        positions[positionId] = Position({
            user: user,
            ctcCollateral: ctcAmount,
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

        emit PositionCreated(positionId, user, ctcAmount, usdcToBorrow);
    }

    function harvestYield(
        uint256 positionId,
        uint256 ctcPriceUSD
    ) external onlyOwner nonReentrant returns (uint256 ctcSwapped, uint256 usdcReceived, uint256 interestPaid) {
        Position storage position = positions[positionId];
        uint256 outstandingInterest = ISeniorPool(seniorPool).getAccruedInterest(positionId);
        require(outstandingInterest > 0, "No interest");

        ctcSwapped = (outstandingInterest * 1e30) / ctcPriceUSD;
        require(ctcSwapped <= position.ctcCollateral, "Insufficient collateral");

        ctc.approve(ctcDexIntegration, ctcSwapped);
        usdcReceived = ICTCDEXIntegration(ctcDexIntegration).swapCTCToUSDC(ctcSwapped, ctcPriceUSD);

        interestPaid = usdcReceived > outstandingInterest ? outstandingInterest : usdcReceived;
        usdc.approve(seniorPool, interestPaid);
        ISeniorPool(seniorPool).repay(positionId, interestPaid);

        position.ctcCollateral -= ctcSwapped;
        position.totalInterestPaid += interestPaid;
        position.lastHarvestTime = block.timestamp;

        emit YieldHarvested(positionId, ctcSwapped, usdcReceived, interestPaid);
    }

    function getHealthFactor(uint256 positionId, uint256 ctcPriceUSD) public view returns (uint256) {
        Position memory position = positions[positionId];
        if (!position.active) return 0;
        uint256 collateralValueUSD = (position.ctcCollateral * ctcPriceUSD) / 1e30;
        uint256 outstandingDebt = ISeniorPool(seniorPool).getOutstandingDebt(positionId);
        if (outstandingDebt == 0) return type(uint256).max;
        return (collateralValueUSD * BASIS_POINTS) / outstandingDebt;
    }
}
