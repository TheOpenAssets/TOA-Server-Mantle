// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/RWAToken.sol";
import "../core/IdentityRegistry.sol";

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
        uint256 reservePrice;   // Min price for auction
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
    
    address public platformCustody;
    IERC20 public USDC;
    address public factory;
    address public owner;

    // Authorized vaults for creating liquidation listings
    mapping(address => bool) public authorizedVaults;

    event ListingCreated(bytes32 indexed assetId, address tokenAddress, ListingType listingType, uint256 priceOrReserve);
    event TokensPurchased(bytes32 indexed assetId, address indexed buyer, uint256 amount, uint256 price, uint256 totalPayment);
    event BidSubmitted(bytes32 indexed assetId, address indexed bidder, uint256 tokenAmount, uint256 price, uint256 bidIndex);
    event AuctionEnded(bytes32 indexed assetId, uint256 clearingPrice, uint256 totalTokensSold);
    event BidSettled(bytes32 indexed assetId, address indexed bidder, uint256 tokensReceived, uint256 cost, uint256 refund);
    event VaultAuthorized(address indexed vault, bool authorized);

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

    function createListing(
        bytes32 assetId,
        address tokenAddress,
        ListingType listingType,
        uint256 priceOrReserve,
        uint256 duration,
        uint256 totalSupply,
        uint256 minInvestment
    ) external onlyOwnerOrAuthorizedVault {
        require(!listings[assetId].active, "Already listed");

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
            newListing.reservePrice = priceOrReserve;
            newListing.endTime = block.timestamp + duration;
            newListing.auctionPhase = AuctionPhase.BIDDING;
        }

        emit ListingCreated(assetId, tokenAddress, listingType, priceOrReserve);
    }

    // --- STATIC LISTING FUNCTIONS ---

    function buyTokens(bytes32 assetId, uint256 amount) external {
        Listing storage listing = listings[assetId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.STATIC, "Not a static listing");
        require(amount >= listing.minInvestment, "Below min investment");
        require(amount <= (listing.totalSupply - listing.sold), "Insufficient supply");

        uint256 price = listing.staticPrice;
        uint256 payment = price * amount / 1e18; // Price is per 1e18 tokens (1 full token)

        require(USDC.transferFrom(msg.sender, platformCustody, payment), "Payment failed");
        
        RWAToken(listing.tokenAddress).transferFrom(platformCustody, msg.sender, amount);

        listing.sold += amount;
        if (listing.sold == listing.totalSupply) {
            listing.active = false;
        }

        emit TokensPurchased(assetId, msg.sender, amount, price, payment);
    }

    // --- AUCTION FUNCTIONS ---

    function submitBid(bytes32 assetId, uint256 tokenAmount, uint256 price) external {
        Listing storage listing = listings[assetId];
        require(listing.active, "Listing not active");
        require(listing.listingType == ListingType.AUCTION, "Not an auction");
        require(listing.auctionPhase == AuctionPhase.BIDDING, "Bidding closed");
        require(block.timestamp < listing.endTime, "Auction expired");
        require(price >= listing.reservePrice, "Below reserve price");
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
        // We allow manual ending even before endTime if admin decides, or require endTime passed:
        // require(block.timestamp >= listing.endTime, "Auction not yet ended"); 

        listing.auctionPhase = AuctionPhase.ENDED;
        listing.clearingPrice = clearingPrice;
        listing.active = false; // Bidding stops

        emit AuctionEnded(assetId, clearingPrice, 0); // Emitting 0 for tokens sold as it's not known until settlement. Off-chain services should calculate this.
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
            // --- Oversubscription Protection ---
            uint256 tokensToAllocate = bid.tokenAmount;
            uint256 remainingSupply = listing.totalSupply - listing.sold;

            if (tokensToAllocate > remainingSupply) {
                tokensToAllocate = remainingSupply;
            }

            if (tokensToAllocate > 0) {
                uint256 cost = listing.clearingPrice * tokensToAllocate / 1e18;
                uint256 refund = bid.usdcDeposited - cost;

                // 1. Update sold amount BEFORE transfer
                listing.sold += tokensToAllocate;

                // 2. Transfer tokens to bidder
                RWAToken(listing.tokenAddress).transferFrom(platformCustody, bid.bidder, tokensToAllocate);
                
                // 3. Transfer cost to platform
                require(USDC.transfer(platformCustody, cost), "Platform transfer failed");
                
                // 4. Refund excess
                if (refund > 0) {
                    require(USDC.transfer(bid.bidder, refund), "Refund failed");
                }

                emit BidSettled(assetId, bid.bidder, tokensToAllocate, cost, refund);
            } else {
                // No supply left for this bid
                require(USDC.transfer(bid.bidder, bid.usdcDeposited), "Refund failed");
                emit BidSettled(assetId, bid.bidder, 0, 0, bid.usdcDeposited);
            }
        } else {
            // Losing Bid - Full Refund
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
