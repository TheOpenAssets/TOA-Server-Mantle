// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBurnableToken {
    function burn(uint256 amount) external;
    function burnFrom(address account, uint256 amount) external;
    function totalSupply() external view returns (uint256);
}

contract YieldVault {
    struct AssetYield {
        address tokenAddress;
        bytes32 assetId;
        address issuer;
        uint256 totalSettlement;      // Total USDC deposited for settlement (after platform fee)
        uint256 totalTokenSupply;     // Total RWA token supply at settlement time
        uint256 totalClaimed;         // Total USDC claimed by investors
        uint256 totalTokensBurned;    // Total RWA tokens burned during claims
        uint256 settlementTimestamp;  // When settlement was deposited
        bool isSettled;               // Whether settlement has been deposited
    }

    struct UserYield {
        uint256 totalClaimable;       // DEPRECATED - kept for backwards compatibility
        uint256 lastClaimTime;
    }

    IERC20 public USDC;
    address public platform;
    address public factory;

    mapping(address => AssetYield) public assets;
    mapping(address => UserYield) public userYields;
    address[] public registeredAssets;

    event AssetRegistered(address indexed tokenAddress, bytes32 indexed assetId, address issuer);
    event SettlementDeposited(address indexed tokenAddress, bytes32 indexed assetId, uint256 totalSettlement, uint256 totalTokenSupply, uint256 timestamp);
    event YieldClaimed(address indexed user, address indexed tokenAddress, uint256 tokensBurned, uint256 usdcReceived, uint256 timestamp);

    // DEPRECATED EVENTS - kept for backwards compatibility
    event YieldDeposited(address indexed tokenAddress, bytes32 indexed assetId, uint256 amount, uint256 timestamp);
    event YieldDistributed(address indexed tokenAddress, uint256 totalAmount, uint256 holderCount, uint256 timestamp);

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

    /**
     * @notice Deposit settlement USDC for an asset (new burn-to-claim model)
     * @param tokenAddress The RWA token address
     * @param totalSettlement The total USDC to distribute (after platform fee)
     */
    function depositSettlement(address tokenAddress, uint256 totalSettlement) external onlyPlatform {
        require(assets[tokenAddress].tokenAddress != address(0), "Asset not registered");
        require(!assets[tokenAddress].isSettled, "Settlement already deposited");
        require(totalSettlement > 0, "Settlement must be > 0");

        // Get total token supply at settlement time
        uint256 totalTokenSupply = IBurnableToken(tokenAddress).totalSupply();
        require(totalTokenSupply > 0, "Token supply is zero");

        // Transfer USDC from platform to vault
        require(USDC.transferFrom(msg.sender, address(this), totalSettlement), "USDC transfer failed");

        // Record settlement
        assets[tokenAddress].totalSettlement = totalSettlement;
        assets[tokenAddress].totalTokenSupply = totalTokenSupply;
        assets[tokenAddress].settlementTimestamp = block.timestamp;
        assets[tokenAddress].isSettled = true;

        emit SettlementDeposited(tokenAddress, assets[tokenAddress].assetId, totalSettlement, totalTokenSupply, block.timestamp);
    }

    /**
     * @notice DEPRECATED: Old yield deposit function (kept for backwards compatibility)
     */
    function depositYield(address tokenAddress, uint256 amount) external onlyPlatform {
        require(assets[tokenAddress].tokenAddress != address(0), "Asset not registered");
        require(amount > 0, "Amount must be > 0");

        require(USDC.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        // For backwards compatibility, treat as settlement if not yet settled
        if (!assets[tokenAddress].isSettled) {
            uint256 totalTokenSupply = IBurnableToken(tokenAddress).totalSupply();
            assets[tokenAddress].totalSettlement = amount;
            assets[tokenAddress].totalTokenSupply = totalTokenSupply;
            assets[tokenAddress].settlementTimestamp = block.timestamp;
            assets[tokenAddress].isSettled = true;
        }

        emit YieldDeposited(tokenAddress, assets[tokenAddress].assetId, amount, block.timestamp);
    }

    /**
     * @notice DEPRECATED: Old batch distribution function (kept for backwards compatibility)
     */
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

        // Note: Old accounting fields removed in new model
        // This function is kept only for emergency backwards compatibility
        emit YieldDistributed(tokenAddress, totalAmount, holders.length, block.timestamp);
    }

    /**
     * @notice Claim yield by burning RWA tokens (new burn-to-claim model)
     * @param tokenAddress The RWA token address
     * @param tokenAmount The amount of RWA tokens to burn and claim yield for
     */
    function claimYield(address tokenAddress, uint256 tokenAmount) external {
        require(assets[tokenAddress].isSettled, "Settlement not deposited yet");
        require(tokenAmount > 0, "Token amount must be > 0");

        AssetYield storage asset = assets[tokenAddress];

        // Calculate USDC to send: (tokenAmount / totalTokenSupply) * totalSettlement
        uint256 usdcAmount = (tokenAmount * asset.totalSettlement) / asset.totalTokenSupply;
        require(usdcAmount > 0, "USDC amount too small");

        // Ensure vault has enough USDC
        uint256 remainingSettlement = asset.totalSettlement - asset.totalClaimed;
        require(usdcAmount <= remainingSettlement, "Insufficient USDC in vault");

        // Burn investor's RWA tokens
        IBurnableToken(tokenAddress).burnFrom(msg.sender, tokenAmount);

        // Update accounting
        asset.totalClaimed += usdcAmount;
        asset.totalTokensBurned += tokenAmount;
        userYields[msg.sender].lastClaimTime = block.timestamp;

        // Transfer USDC to investor
        require(USDC.transfer(msg.sender, usdcAmount), "USDC transfer failed");

        emit YieldClaimed(msg.sender, tokenAddress, tokenAmount, usdcAmount, block.timestamp);
    }

    /**
     * @notice DEPRECATED: Old claim function (kept for backwards compatibility)
     */
    function claimAllYield() external {
        uint256 claimable = userYields[msg.sender].totalClaimable;
        require(claimable > 0, "Nothing to claim");

        userYields[msg.sender].totalClaimable = 0;
        userYields[msg.sender].lastClaimTime = block.timestamp;

        require(USDC.transfer(msg.sender, claimable), "Transfer failed");

        // Note: Cannot emit new YieldClaimed event format without tokenAddress
        // Keep old behavior for backwards compatibility
    }

    /**
     * @notice Get claimable USDC for a token amount (new model)
     * @param tokenAddress The RWA token address
     * @param tokenAmount The amount of tokens to check
     * @return The USDC amount claimable for the given token amount
     */
    function getClaimableForTokens(address tokenAddress, uint256 tokenAmount) external view returns (uint256) {
        if (!assets[tokenAddress].isSettled || tokenAmount == 0) {
            return 0;
        }

        return (tokenAmount * assets[tokenAddress].totalSettlement) / assets[tokenAddress].totalTokenSupply;
    }

    /**
     * @notice Get settlement info for an asset
     * @param tokenAddress The RWA token address
     * @return totalSettlement Total USDC deposited
     * @return totalTokenSupply Total RWA token supply at settlement
     * @return totalClaimed Total USDC claimed so far
     * @return totalTokensBurned Total tokens burned so far
     * @return yieldPerToken USDC yield per token (in 6 decimals)
     */
    function getSettlementInfo(address tokenAddress) external view returns (
        uint256 totalSettlement,
        uint256 totalTokenSupply,
        uint256 totalClaimed,
        uint256 totalTokensBurned,
        uint256 yieldPerToken
    ) {
        AssetYield storage asset = assets[tokenAddress];
        totalSettlement = asset.totalSettlement;
        totalTokenSupply = asset.totalTokenSupply;
        totalClaimed = asset.totalClaimed;
        totalTokensBurned = asset.totalTokensBurned;
        yieldPerToken = totalTokenSupply > 0 ? (totalSettlement * 1e18) / totalTokenSupply : 0;
    }

    /**
     * @notice DEPRECATED: Old getUserClaimable (kept for backwards compatibility)
     */
    function getUserClaimable(address user) external view returns (uint256) {
        return userYields[user].totalClaimable;
    }
}
