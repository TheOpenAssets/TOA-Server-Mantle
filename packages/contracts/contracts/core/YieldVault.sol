// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract YieldVault {
    struct AssetYield {
        address tokenAddress;
        bytes32 assetId;
        address issuer;
        uint256 totalDeposited;
        uint256 totalDistributed;
        uint256 pendingDistribution;
        uint256 lastDistributionTime;
        uint256 distributionCount;
    }

    struct UserYield {
        uint256 totalClaimable;
        uint256 lastClaimTime;
    }

    IERC20 public USDC;
    address public platform;
    address public factory;
    
    mapping(address => AssetYield) public assets;
    mapping(address => UserYield) public userYields;
    address[] public registeredAssets;

    event AssetRegistered(address indexed tokenAddress, bytes32 indexed assetId, address issuer);
    event YieldDeposited(address indexed tokenAddress, bytes32 indexed assetId, uint256 amount, uint256 timestamp);
    event YieldDistributed(address indexed tokenAddress, uint256 totalAmount, uint256 holderCount, uint256 timestamp);
    event YieldClaimed(address indexed user, uint256 amount, uint256 timestamp);

    modifier onlyPlatform() {
        require(msg.sender == platform, "Only platform");
        _;
    }

    modifier onlyFactory() {
        require(msg.sender == factory, "Only factory");
        _;
    }

    constructor(address _USDC, address _platform) {
        USDC = IERC20(_USDC);
        platform = _platform;
    }

    function setFactory(address _factory) external {
        require(factory == address(0), "Factory already set");
        factory = _factory;
    }

    function registerAsset(address tokenAddress, bytes32 assetId, address issuer) external onlyFactory {
        assets[tokenAddress].tokenAddress = tokenAddress;
        assets[tokenAddress].assetId = assetId;
        assets[tokenAddress].issuer = issuer;
        registeredAssets.push(tokenAddress);
        emit AssetRegistered(tokenAddress, assetId, issuer);
    }

    function depositYield(address tokenAddress, uint256 amount) external onlyPlatform {
        require(assets[tokenAddress].tokenAddress != address(0), "Asset not registered");
        require(amount > 0, "Amount must be > 0");

        require(USDC.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        assets[tokenAddress].totalDeposited += amount;
        assets[tokenAddress].pendingDistribution += amount;

        emit YieldDeposited(tokenAddress, assets[tokenAddress].assetId, amount, block.timestamp);
    }

    function distributeYieldBatch(
        address tokenAddress,
        address[] calldata holders,
        uint256[] calldata amounts
    ) external onlyPlatform {
        require(holders.length == amounts.length, "Array mismatch");
        uint256 totalAmount = 0;

        for (uint256 i = 0; i < amounts.length; i++) {
            totalAmount += amounts[i];
            userYields[holders[i]].totalClaimable += amounts[i];
        }

        require(totalAmount <= assets[tokenAddress].pendingDistribution, "Insufficient pending yield");

        assets[tokenAddress].pendingDistribution -= totalAmount;
        assets[tokenAddress].totalDistributed += totalAmount;
        assets[tokenAddress].lastDistributionTime = block.timestamp;
        assets[tokenAddress].distributionCount++;

        emit YieldDistributed(tokenAddress, totalAmount, holders.length, block.timestamp);
    }

    function claimAllYield() external {
        uint256 claimable = userYields[msg.sender].totalClaimable;
        require(claimable > 0, "Nothing to claim");

        userYields[msg.sender].totalClaimable = 0;
        userYields[msg.sender].lastClaimTime = block.timestamp;

        require(USDC.transfer(msg.sender, claimable), "Transfer failed");
        emit YieldClaimed(msg.sender, claimable, block.timestamp);
    }

    function getUserClaimable(address user) external view returns (uint256) {
        return userYields[user].totalClaimable;
    }
}
