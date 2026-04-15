// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IYieldVaultSettlement {
    function depositSettlement(address tokenAddress, uint256 totalSettlement) external;
}

interface IPrimaryMarketListing {
    struct Listing {
        address tokenAddress;
        bytes32 assetId;
        uint8 listingType;
        uint256 staticPrice;
        uint256 minPrice;
        uint256 reservePrice;
        uint256 endTime;
        uint256 clearingPrice;
        uint8 auctionPhase;
        uint256 totalSupply;
        uint256 sold;
        bool active;
        uint256 minInvestment;
    }
    function listings(bytes32 assetId) external view returns (Listing memory);
}

/**
 * @title IssuerVault
 * @notice Holds USDC raised from primary market sales on a per-asset basis.
 *         Investors' USDC is routed here directly during purchase (via PrimaryMarket).
 *         The issuer/firm can then withdraw the liquidity after the sale closes,
 *         creating an on-chain debt. When the issuer repays principal + interest,
 *         the interest portion is automatically forwarded to YieldVault so investors
 *         can burn their RWA tokens to claim yield.
 *
 * Flow:
 *  1. PrimaryMarket calls recordDeposit() on each investor purchase (net of platform fee)
 *  2. Sale closes → listing.active == false (trustless gate)
 *  3. Issuer calls withdrawLiquidity() → debt recorded on-chain
 *  4. Issuer calls repayDebt() (partial or full)
 *  5. On full repayment → interestAmount forwarded to YieldVault.depositSettlement()
 *     → Investors burn RWA tokens to claim pro-rata interest yield
 */
contract IssuerVault is Ownable, ReentrancyGuard {

    // ─── Vault state per asset ────────────────────────────────────────────────

    struct VaultAsset {
        bytes32 assetId;
        address rwaTokenAddress;    // RWA token investors hold
        address issuerAddress;      // Wallet authorised to withdraw
        uint256 principalHeld;      // Net USDC deposited (after platform fee)
        uint256 amountWithdrawn;    // USDC the issuer has pulled out
        uint256 outstandingDebt;    // Principal not yet repaid
        uint256 agreedRateBps;      // Annual simple interest rate (basis points, e.g. 1000 = 10%)
        uint256 withdrawalTimestamp;// When issuer first withdrew (interest starts here)
        uint256 totalInterestPaid;  // Cumulative interest repaid
        uint256 totalPrincipalRepaid;
        bool isRegistered;
        bool isFullyRepaid;
    }

    IERC20 public immutable USDC;
    address public yieldVault;
    address public primaryMarket;

    /// @notice Per-asset vault state
    mapping(bytes32 => VaultAsset) public vaults;

    /// @notice Markets authorised to call recordDeposit() (i.e. PrimaryMarket)
    mapping(address => bool) public authorizedMarkets;

    uint256 public constant BASIS_POINTS = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AssetRegistered(bytes32 indexed assetId, address rwaToken, address issuer, uint256 rateBps);
    event DepositReceived(bytes32 indexed assetId, uint256 amount, uint256 totalHeld);
    event LiquidityWithdrawn(bytes32 indexed assetId, address indexed issuer, uint256 amount, uint256 timestamp);
    event DebtRepaid(bytes32 indexed assetId, uint256 principalRepaid, uint256 interestRepaid, uint256 remainingDebt);
    event VaultFullyRepaid(bytes32 indexed assetId, uint256 totalPrincipal, uint256 totalInterest);
    event YieldDistributionTriggered(bytes32 indexed assetId, address yieldVault, uint256 interestAmount);
    event MarketAuthorized(address indexed market, bool authorized);
    event YieldVaultSet(address yieldVault);
    event InterestRateUpdated(bytes32 indexed assetId, uint256 oldRateBps, uint256 newRateBps);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyAuthorizedMarket() {
        require(authorizedMarkets[msg.sender], "Only authorized market");
        _;
    }

    modifier onlyIssuerOf(bytes32 assetId) {
        require(vaults[assetId].isRegistered, "Asset not registered");
        require(msg.sender == vaults[assetId].issuerAddress, "Not asset issuer");
        _;
    }

    modifier onlyRegistered(bytes32 assetId) {
        require(vaults[assetId].isRegistered, "Asset not registered");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _usdc, address _primaryMarket, address _yieldVault) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC");
        require(_primaryMarket != address(0), "Invalid PrimaryMarket");
        require(_yieldVault != address(0), "Invalid YieldVault");
        USDC = IERC20(_usdc);
        primaryMarket = _primaryMarket;
        yieldVault = _yieldVault;
        authorizedMarkets[_primaryMarket] = true;
        emit MarketAuthorized(_primaryMarket, true);
    }

    // ─── Admin config ─────────────────────────────────────────────────────────

    /**
     * @notice Register a new asset vault before its listing goes live.
     *         Must be called by admin before createListing() on PrimaryMarket.
     */
    function registerAsset(
        bytes32 assetId,
        address rwaTokenAddress,
        address issuerAddress,
        uint256 agreedRateBps
    ) external onlyOwner {
        require(!vaults[assetId].isRegistered, "Already registered");
        require(rwaTokenAddress != address(0), "Invalid token");
        require(issuerAddress != address(0), "Invalid issuer");
        require(agreedRateBps <= 5000, "Rate too high (max 50%)");

        vaults[assetId] = VaultAsset({
            assetId: assetId,
            rwaTokenAddress: rwaTokenAddress,
            issuerAddress: issuerAddress,
            principalHeld: 0,
            amountWithdrawn: 0,
            outstandingDebt: 0,
            agreedRateBps: agreedRateBps,
            withdrawalTimestamp: 0,
            totalInterestPaid: 0,
            totalPrincipalRepaid: 0,
            isRegistered: true,
            isFullyRepaid: false
        });

        emit AssetRegistered(assetId, rwaTokenAddress, issuerAddress, agreedRateBps);
    }

    /**
     * @notice Update interest rate before issuer has withdrawn (can't change mid-debt)
     */
    function updateInterestRate(bytes32 assetId, uint256 newRateBps) external onlyOwner onlyRegistered(assetId) {
        VaultAsset storage vault = vaults[assetId];
        require(vault.amountWithdrawn == 0, "Cannot change rate after withdrawal");
        require(newRateBps <= 5000, "Rate too high (max 50%)");
        uint256 oldRate = vault.agreedRateBps;
        vault.agreedRateBps = newRateBps;
        emit InterestRateUpdated(assetId, oldRate, newRateBps);
    }

    /**
     * @notice Authorize or revoke a market contract (PrimaryMarket) to call recordDeposit
     */
    function authorizeMarket(address market, bool authorized) external onlyOwner {
        require(market != address(0), "Invalid address");
        authorizedMarkets[market] = authorized;
        emit MarketAuthorized(market, authorized);
    }

    /**
     * @notice Update the YieldVault address (in case of upgrade)
     */
    function setYieldVault(address _yieldVault) external onlyOwner {
        require(_yieldVault != address(0), "Invalid address");
        yieldVault = _yieldVault;
        emit YieldVaultSet(_yieldVault);
    }

    // ─── Market-callable ──────────────────────────────────────────────────────

    /**
     * @notice Called by PrimaryMarket after routing net USDC here during a purchase.
     *         USDC has already been transferred to this contract by the market.
     * @param assetId  The asset identifier
     * @param amount   Net USDC received (after platform fee split in PrimaryMarket)
     */
    function recordDeposit(bytes32 assetId, uint256 amount) external onlyAuthorizedMarket {
        require(vaults[assetId].isRegistered, "Asset not registered");
        require(amount > 0, "Amount must be > 0");
        vaults[assetId].principalHeld += amount;
        emit DepositReceived(assetId, amount, vaults[assetId].principalHeld);
    }

    // ─── Issuer actions ───────────────────────────────────────────────────────

    /**
     * @notice Issuer withdraws available USDC liquidity after the sale closes.
     *         The listing must be inactive (sale ended) — enforced trustlessly
     *         by reading PrimaryMarket state.
     * @param assetId  The asset identifier
     * @param amount   USDC amount to withdraw (must be <= available balance)
     */
    function withdrawLiquidity(bytes32 assetId, uint256 amount)
        external
        nonReentrant
        onlyIssuerOf(assetId)
    {
        VaultAsset storage vault = vaults[assetId];
        require(!vault.isFullyRepaid, "Vault already settled");
        require(amount > 0, "Amount must be > 0");

        // Trustless gate: sale must be over before issuer can withdraw
        bool saleActive = IPrimaryMarketListing(primaryMarket).listings(assetId).active;
        require(!saleActive, "Sale still active");

        uint256 available = vault.principalHeld - vault.amountWithdrawn;
        require(amount <= available, "Insufficient available balance");

        // Record withdrawal timestamp on first withdrawal (interest clock starts)
        if (vault.withdrawalTimestamp == 0) {
            vault.withdrawalTimestamp = block.timestamp;
        }

        vault.amountWithdrawn += amount;
        vault.outstandingDebt += amount;

        require(USDC.transfer(vault.issuerAddress, amount), "USDC transfer failed");

        emit LiquidityWithdrawn(assetId, vault.issuerAddress, amount, block.timestamp);
    }

    /**
     * @notice Repay outstanding debt (principal + interest). Partial repayments allowed.
     *         When fully repaid, interest is forwarded to YieldVault to distribute to investors.
     * @param assetId  The asset identifier
     * @param amount   USDC amount being repaid
     */
    function repayDebt(bytes32 assetId, uint256 amount)
        external
        nonReentrant
        onlyRegistered(assetId)
    {
        VaultAsset storage vault = vaults[assetId];
        require(!vault.isFullyRepaid, "Already fully repaid");
        require(vault.amountWithdrawn > 0, "No debt to repay");
        require(amount > 0, "Amount must be > 0");

        uint256 interestOwed = calculateInterestOwed(assetId);
        uint256 totalOwed = vault.outstandingDebt + interestOwed;
        require(amount <= totalOwed, "Overpayment: reduce amount");

        require(USDC.transferFrom(msg.sender, address(this), amount), "USDC transfer failed");

        // Allocate repayment: interest first, then principal
        uint256 interestRepaid;
        uint256 principalRepaid;

        if (amount <= interestOwed) {
            interestRepaid = amount;
            principalRepaid = 0;
        } else {
            interestRepaid = interestOwed;
            principalRepaid = amount - interestOwed;
        }

        vault.totalInterestPaid += interestRepaid;
        vault.totalPrincipalRepaid += principalRepaid;
        vault.outstandingDebt = vault.outstandingDebt > principalRepaid
            ? vault.outstandingDebt - principalRepaid
            : 0;

        uint256 remainingDebt = vault.outstandingDebt + (interestOwed - interestRepaid);

        emit DebtRepaid(assetId, principalRepaid, interestRepaid, remainingDebt);

        // Full repayment: forward the complete settlement (principal + interest) to YieldVault
        // so investors can burn their RWA tokens to claim their pro-rata share.
        // At this point IssuerVault holds: principalHeld (original deposits) + totalInterestPaid (repaid interest)
        if (vault.outstandingDebt == 0 && interestRepaid >= interestOwed) {
            vault.isFullyRepaid = true;
            uint256 totalInterest = vault.totalInterestPaid;
            // Full settlement = original principal raised + all interest repaid
            uint256 totalSettlement = vault.principalHeld + totalInterest;

            emit VaultFullyRepaid(assetId, vault.totalPrincipalRepaid, totalInterest);

            if (totalSettlement > 0) {
                // Approve YieldVault to pull the full settlement (principal + interest)
                USDC.approve(yieldVault, totalSettlement);
                IYieldVaultSettlement(yieldVault).depositSettlement(
                    vault.rwaTokenAddress,
                    totalSettlement
                );
                emit YieldDistributionTriggered(assetId, yieldVault, totalSettlement);
            }
        }
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    /**
     * @notice Calculate simple interest owed on withdrawn principal.
     *         Interest = principal × rate × elapsed / SECONDS_PER_YEAR / BASIS_POINTS
     */
    function calculateInterestOwed(bytes32 assetId) public view returns (uint256) {
        VaultAsset memory vault = vaults[assetId];
        if (vault.withdrawalTimestamp == 0 || vault.amountWithdrawn == 0) {
            return 0;
        }
        uint256 elapsed = block.timestamp - vault.withdrawalTimestamp;
        uint256 grossInterest = (vault.amountWithdrawn * vault.agreedRateBps * elapsed)
            / (BASIS_POINTS * SECONDS_PER_YEAR);
        // Subtract interest already paid in previous partial repayments
        return grossInterest > vault.totalInterestPaid
            ? grossInterest - vault.totalInterestPaid
            : 0;
    }

    /**
     * @notice Full debt summary for the frontend / backend to display
     */
    function getDebtSummary(bytes32 assetId)
        external
        view
        returns (
            uint256 principalHeld,
            uint256 amountWithdrawn,
            uint256 outstandingDebt,
            uint256 interestOwed,
            uint256 totalOwed,
            uint256 agreedRateBps,
            uint256 withdrawalTimestamp,
            bool isFullyRepaid
        )
    {
        VaultAsset memory vault = vaults[assetId];
        principalHeld = vault.principalHeld;
        amountWithdrawn = vault.amountWithdrawn;
        outstandingDebt = vault.outstandingDebt;
        interestOwed = calculateInterestOwed(assetId);
        totalOwed = outstandingDebt + interestOwed;
        agreedRateBps = vault.agreedRateBps;
        withdrawalTimestamp = vault.withdrawalTimestamp;
        isFullyRepaid = vault.isFullyRepaid;
    }

    /**
     * @notice Available balance issuer can still withdraw (principalHeld - amountWithdrawn)
     */
    function availableToWithdraw(bytes32 assetId) external view returns (uint256) {
        VaultAsset memory vault = vaults[assetId];
        if (vault.amountWithdrawn >= vault.principalHeld) return 0;
        return vault.principalHeld - vault.amountWithdrawn;
    }
}
