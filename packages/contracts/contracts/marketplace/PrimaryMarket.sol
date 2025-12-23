// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../core/RWAToken.sol";
import "../core/IdentityRegistry.sol";

contract PrimaryMarket {
    enum ListingType { STATIC, AUCTION }

    struct Listing {
        address tokenAddress;
        bytes32 assetId;
        ListingType listingType;
        uint256 staticPrice;
        uint256 startPrice;
        uint256 endPrice;
        uint256 duration;
        uint256 startTime;
        uint256 totalSupply;
        uint256 sold;
        bool active;
        uint256 minInvestment;
    }

    mapping(bytes32 => Listing) public listings;
    address public platformCustody;
    IERC20 public USDC;
    address public factory;
    address public owner;

    event ListingCreated(bytes32 indexed assetId, address tokenAddress, ListingType listingType, uint256 price);
    event TokensPurchased(bytes32 indexed assetId, address indexed buyer, uint256 amount, uint256 price, uint256 totalPayment);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _factory, address _platformCustody, address _USDC) {
        owner = msg.sender;
        factory = _factory;
        platformCustody = _platformCustody;
        USDC = IERC20(_USDC);
    }

    function createListing(
        bytes32 assetId,
        address tokenAddress,
        ListingType listingType,
        uint256 priceOrStart,
        uint256 endPrice,
        uint256 duration,
        uint256 totalSupply,
        uint256 minInvestment
    ) external onlyOwner {
        require(!listings[assetId].active, "Already listed");

        listings[assetId] = Listing({
            tokenAddress: tokenAddress,
            assetId: assetId,
            listingType: listingType,
            staticPrice: listingType == ListingType.STATIC ? priceOrStart : 0,
            startPrice: listingType == ListingType.AUCTION ? priceOrStart : 0,
            endPrice: endPrice,
            duration: duration,
            startTime: block.timestamp,
            totalSupply: totalSupply,
            sold: 0,
            active: true,
            minInvestment: minInvestment
        });

        emit ListingCreated(assetId, tokenAddress, listingType, priceOrStart);
    }

    function getCurrentPrice(bytes32 assetId) public view returns (uint256) {
        Listing memory listing = listings[assetId];
        if (listing.listingType == ListingType.STATIC) {
            return listing.staticPrice;
        } else {
            uint256 elapsed = block.timestamp - listing.startTime;
            if (elapsed >= listing.duration) return listing.endPrice;
            
            uint256 priceDrop = (listing.startPrice - listing.endPrice) * elapsed / listing.duration;
            return listing.startPrice - priceDrop;
        }
    }

    function buyTokens(bytes32 assetId, uint256 amount) external {
        Listing storage listing = listings[assetId];
        require(listing.active, "Listing not active");
        require(amount >= listing.minInvestment, "Below min investment");
        require(amount <= (listing.totalSupply - listing.sold), "Insufficient supply");

        // RWAToken token = RWAToken(listing.tokenAddress);
        // require(token.identityRegistry().isVerified(msg.sender), "User not KYC verified"); 
        // Token contract handles KYC in _beforeTokenTransfer, but checking here saves gas on payment transfer if fail

        uint256 price = getCurrentPrice(assetId);
        uint256 payment = price * amount / 1e18; // Assuming 18 decimals for token, normalize if price is per whole token

        require(USDC.transferFrom(msg.sender, platformCustody, payment), "Payment failed");
        
        // Transfer tokens from platform custody to buyer
        RWAToken(listing.tokenAddress).transferFrom(platformCustody, msg.sender, amount);

        listing.sold += amount;
        if (listing.sold == listing.totalSupply) {
            listing.active = false;
        }

        emit TokensPurchased(assetId, msg.sender, amount, price, payment);
    }

    function closeListing(bytes32 assetId) external onlyOwner {
        listings[assetId].active = false;
    }
}
