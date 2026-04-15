// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/RWAToken.sol";
import "../core/IdentityRegistry.sol";

interface IIssuerVault {
    function recordDeposit(bytes32 assetId, uint256 amount) external;
}

contract PrimaryMarket {
    enum ListingType { STATIC, AUCTION }
    enum AuctionPhase { BIDDING, ENDED }

    struct Bid {
        address bidder;
        uint256 tokenAmount;
        uint256 price;          // Limit price per token
        uint256 usdcDeposited;
        bool settled;
    }

    struct Listing {
        address tokenAddress;
        bytes32 assetId;
        ListingType listingType;
        // Static params
        uint256 staticPrice;
        // Auction params
        uint256 minPrice;       // Minimum bid price (lower bound of range)
        uint256 reservePrice;   // Reserve price (avg of min/max, used for clearing)
        uint256 endTime;
        uint256 clearingPrice;  // Set when auction ends
        AuctionPhase auctionPhase;
        // Common params
        uint256 totalSupply;
        uint256 sold;           // For static: amount sold. For auction: tokens allocated.
        bool active;
        uint256 minInvestment;
    }

    // AssetId => Listing
    mapping(bytes32 => Listing) public listings;
    // AssetId => Array of Bids
    mapping(bytes32 => Bid[]) public bids;

    // ─── IssuerVault routing ──────────────────────────────────────────────────
    /// @notice Per-asset IssuerVault address. If non-zero, USDC routes there directly.
    ///         If zero (old assets), USDC routes to platformCustody (backwards compatible).
    mapping(bytes32 => address) public issuerVaultForAsset;

    address public platformCustody;
    IERC20 public USDC;
    address public factory;
    address public owner;

    /// @notice Platform fee in basis points (150 = 1.5%)
    uint256 public constant PLATFORM_FEE_BPS = 150;
    uint256 public constant BASIS_POINTS = 10_000;

    // Authorized vaults for creating liquidation listings
    mapping(address => bool) public authorizedVaults;

    event ListingCreated(bytes32 indexed assetId, address tokenAddress, ListingType listingType, uint256 priceOrReserve);
    event TokensPurchased(bytes32 indexed assetId, address indexed buyer, uint256 amount, uint256 price, uint256 totalPayment);
    event BidSubmitted(bytes32 indexed assetId, address indexed bidder, uint256 tokenAmount, uint256 price, uint256 bidIndex);
    event AuctionEnded(bytes32 indexed assetId, uint256 clearingPrice, uint256 totalTokensSold);
    event BidSettled(bytes32 indexed assetId, address indexed bidder, uint256 tokensReceived, uint256 cost, uint256 refund);
    event VaultAuthorized(address indexed vault, bool authorized);
    event IssuerVaultRegistered(bytes32 indexed assetId, address indexed issuerVault);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyOwnerOrAuthorizedVault() {
        require(
            msg.sender == owner || authorizedVaults[msg.sender],
            "Only owner or authorized vault"
        );
        _;
    }

    constructor(address _factory, address _platformCustody, address _USDC) {
        owner = msg.sender;
        factory = _factory;
        platformCustody = _platformCustody;
        USDC = IERC20(_USDC);
    }

    /**
     * @notice Authorize or deauthorize vault for creating listings
     * @param vault Vault address
     * @param authorized Authorization status
     */
    function authorizeVault(address vault, bool authorized) external onlyOwner {
        require(vault != address(0), "Invalid vault address");
        authorizedVaults[vault] = authorized;
        emit VaultAuthorized(vault, authorized);
    }

    /**
     * @notice Register an IssuerVault for an asset so purchases route USDC there directly.
     *         Must be called before the listing goes live.
     * @param assetId     The asset identifier
     * @param issuerVault The deployed IssuerVault contract address
     */
    function registerIssuerVault(bytes32 assetId, address issuerVault) external onlyOwner {
        require(issuerVault != address(0), "Invalid issuerVault address");
        issuerVaultForAsset[assetId] = issuerVault;
        emit IssuerVaultRegistered(assetId, issuerVault);
    }

    /**
     * @notice Create a marketplace listing.
     * @param issuerVault  Optional IssuerVault address. If non-zero, registers vault routing
     *                     for this asset so purchases route USDC directly there.
     */
    function createListing(
        bytes32 assetId,
        address tokenAddress,
        ListingType listingType,
        uint256 priceOrReserve,
        uint256 minPrice,
        uint256 duration,
        uint256 totalSupply,
        uint256 minInvestment,
        address issuerVault
    ) external onlyOwnerOrAuthorizedVault {
        require(!listings[assetId].active, "Already listed");

        // Register IssuerVault routing if provided
        if (issuerVault != address(0)) {
            issuerVaultForAsset[assetId] = issuerVault;
            emit IssuerVaultRegistered(assetId, issuerVault);
        }

        Listing storage newListing = listings[assetId];
        newListing.tokenAddress = tokenAddress;
        newListing.assetId = assetId;
        newListing.listingType = listingType;
        newListing.totalSupply = totalSupply;
        newListing.active = true;
        newListing.minInvestment = minInvestment;

        if (listingType == ListingType.STATIC) {
            newListing.staticPrice = priceOrReserve;
        } else {
            newListing.minPrice = minPrice;
            newListing.reservePrice = priceOrReserve;
            newListing.endTime = block.timestamp + duration;
            newListing.auctionPhase = AuctionPhase.BIDDING;
        }

        emit ListingCreated(assetId, tokenAddress, listingType, priceOrReserve);
    }

    // ─── Internal: route USDC payment ─────────────────────────────────────────

    /**
     * @dev Splits payment into platform fee (to platformCustody) and net amount
     *      (to IssuerVault if registered, else to platformCustody).
     *      Calls IssuerVault.recordDeposit() to update accounting.
     * @param assetId  The asset identifier
     * @param payer    Address paying USDC
     * @param payment  Total USDC amount (gross, before fee split)
     */
    function _routePayment(bytes32 assetId, address payer, uint256 payment) internal {
        address vault = issuerVaultForAsset[assetId];

        if (vault != address(0)) {
            // Split: 1.5% fee to platformCustody, 98.5% net to IssuerVault
            uint256 fee = (payment * PLATFORM_FEE_BPS) / BASIS_POINTS;
            uint256 netToVault = payment - fee;

            // Pull full amount from payer into this contract first
            require(USDC.transferFrom(payer, address(this), payment), "Payment failed");

            // Forward fee to platform
            if (fee > 0) {
                require(USDC.transfer(platformCustody, fee), "Fee transfer failed");
            }

            // Forward net amount to IssuerVault and notify its accounting
            require(USDC.transfer(vault, netToVault), "Vault transfer failed");
            IIssuerVault(vault).recordDeposit(assetId, netToVault);
        } else {
            // Legacy path: full payment goes to platformCustody (old assets)
            require(USDC.transferFrom(payer, platformCustody, payment), "Payment failed");
        }
    }

    // ─── Static listing ───────────────────────────────────────────────────────

    function buyTokens(bytes32 assetId, uint256 amount) external {
        Listing storage listing = listings[assetId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.STATIC, "Not a static listing");
        require(amount >= listing.minInvestment, "Below min investment");
        require(amount <= (listing.totalSupply - listing.sold), "Insufficient supply");

        uint256 price = listing.staticPrice;
        uint256 payment = price * amount / 1e18; // Price is per 1e18 tokens (1 full token)

        _routePayment(assetId, msg.sender, payment);

        RWAToken(listing.tokenAddress).transferFrom(platformCustody, msg.sender, amount);

        listing.sold += amount;
        if (listing.sold == listing.totalSupply) {
            listing.active = false;
        }

        emit TokensPurchased(assetId, msg.sender, amount, price, payment);
    }

    // ─── Auction functions ────────────────────────────────────────────────────

    function submitBid(bytes32 assetId, uint256 tokenAmount, uint256 price) external {
        Listing storage listing = listings[assetId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.AUCTION, "Not an auction");
        require(listing.auctionPhase == AuctionPhase.BIDDING, "Bidding closed");
        require(block.timestamp < listing.endTime, "Auction expired");
        require(price >= listing.minPrice, "Below minimum price");
        require(tokenAmount >= listing.minInvestment, "Below min investment");

        uint256 deposit = price * tokenAmount / 1e18;
        require(USDC.transferFrom(msg.sender, address(this), deposit), "Deposit failed");

        bids[assetId].push(Bid({
            bidder: msg.sender,
            tokenAmount: tokenAmount,
            price: price,
            usdcDeposited: deposit,
            settled: false
        }));

        emit BidSubmitted(assetId, msg.sender, tokenAmount, price, bids[assetId].length - 1);
    }

    function endAuction(bytes32 assetId, uint256 clearingPrice) external onlyOwner {
        Listing storage listing = listings[assetId];
        require(listing.listingType == ListingType.AUCTION, "Not an auction");
        require(listing.auctionPhase == AuctionPhase.BIDDING, "Already ended");

        listing.auctionPhase = AuctionPhase.ENDED;
        listing.clearingPrice = clearingPrice;
        listing.active = false;

        emit AuctionEnded(assetId, clearingPrice, 0);
    }

    function settleBid(bytes32 assetId, uint256 bidIndex) external {
        Listing storage listing = listings[assetId];
        require(listing.listingType == ListingType.AUCTION, "Not an auction");
        require(listing.auctionPhase == AuctionPhase.ENDED, "Auction not ended");

        Bid storage bid = bids[assetId][bidIndex];
        require(!bid.settled, "Already settled");
        require(msg.sender == bid.bidder || msg.sender == owner, "Not authorized to settle");

        bid.settled = true;

        if (bid.price > listing.clearingPrice) {
            // ─── Oversubscription Protection ─────────────────────────────────
            uint256 tokensToAllocate = bid.tokenAmount;
            uint256 remainingSupply = listing.totalSupply - listing.sold;

            if (tokensToAllocate > remainingSupply) {
                tokensToAllocate = remainingSupply;
            }

            if (tokensToAllocate > 0) {
                uint256 cost = listing.clearingPrice * tokensToAllocate / 1e18;
                uint256 refund = bid.usdcDeposited - cost;

                listing.sold += tokensToAllocate;

                // Transfer tokens to bidder
                RWAToken(listing.tokenAddress).transferFrom(platformCustody, bid.bidder, tokensToAllocate);

                // Route cost: 1.5% fee to platformCustody, 98.5% to IssuerVault (or all to custody)
                address vault = issuerVaultForAsset[assetId];
                if (vault != address(0)) {
                    uint256 fee = (cost * PLATFORM_FEE_BPS) / BASIS_POINTS;
                    uint256 netToVault = cost - fee;

                    if (fee > 0) {
                        require(USDC.transfer(platformCustody, fee), "Fee transfer failed");
                    }
                    require(USDC.transfer(vault, netToVault), "Vault transfer failed");
                    IIssuerVault(vault).recordDeposit(assetId, netToVault);
                } else {
                    require(USDC.transfer(platformCustody, cost), "Platform transfer failed");
                }

                // Refund excess to bidder
                if (refund > 0) {
                    require(USDC.transfer(bid.bidder, refund), "Refund failed");
                }

                emit BidSettled(assetId, bid.bidder, tokensToAllocate, cost, refund);
            } else {
                // No supply left — full refund
                require(USDC.transfer(bid.bidder, bid.usdcDeposited), "Refund failed");
                emit BidSettled(assetId, bid.bidder, 0, 0, bid.usdcDeposited);
            }
        } else {
            // Losing bid — full refund
            require(USDC.transfer(bid.bidder, bid.usdcDeposited), "Refund failed");
            emit BidSettled(assetId, bid.bidder, 0, 0, bid.usdcDeposited);
        }
    }

    // Helper to get bid count
    function getBidCount(bytes32 assetId) external view returns (uint256) {
        return bids[assetId].length;
    }

    function closeListing(bytes32 assetId) external onlyOwner {
        listings[assetId].active = false;
    }
}
