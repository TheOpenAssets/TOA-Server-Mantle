#!/bin/bash

# Admin End Auction Script
# Ends an auction by setting the clearing price and creating the final announcement

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ADMIN_PRIVATE_KEY="${ADMIN_PRIVATE_KEY}"
ASSET_ID="${1}"
CLEARING_PRICE="${2}"

# Helper functions
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_cyan() {
    echo -e "${CYAN}$1${NC}"
}

# Validate inputs
if [ -z "$ADMIN_PRIVATE_KEY" ]; then
    print_error "ADMIN_PRIVATE_KEY not set!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-end-auction.sh <asset-id> <clearing-price>"
    echo ""
    echo "Parameters:"
    echo "  asset-id        : UUID of the auction"
    echo "  clearing-price  : Final clearing price in USDC (e.g., 0.85)"
    echo ""
    echo "Example:"
    echo "  ADMIN_PRIVATE_KEY=0x... ./admin-end-auction.sh 550e8400-e29b-41d4-a716-446655440000 0.85"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Asset ID not provided!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-end-auction.sh <asset-id> <clearing-price>"
    exit 1
fi

if [ -z "$CLEARING_PRICE" ]; then
    print_error "Clearing price not provided!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-end-auction.sh <asset-id> <clearing-price>"
    exit 1
fi

# Validate clearing price is a number
if ! [[ "$CLEARING_PRICE" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    print_error "Clearing price must be a number (e.g., 0.85)"
    exit 1
fi

print_header "Admin End Auction"
print_info "API: $API_BASE_URL"
print_info "Asset ID: $ASSET_ID"
print_info "Clearing Price: $CLEARING_PRICE USDC"
echo ""

# Get admin wallet address
ADMIN_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$ADMIN_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Admin Wallet: $ADMIN_WALLET"

# =============================================================================
# STEP 1: Get Authentication Challenge
# =============================================================================
print_header "Step 1: Admin Authentication"
print_info "Requesting challenge..."

CHALLENGE_RESPONSE=$(curl -s "$API_BASE_URL/auth/challenge?walletAddress=$ADMIN_WALLET&role=ADMIN")
MESSAGE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.message')
NONCE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.nonce')

if [ -z "$MESSAGE" ] || [ "$MESSAGE" == "null" ]; then
    print_error "Failed to get challenge"
    echo "$CHALLENGE_RESPONSE"
    exit 1
fi

print_success "Challenge received"

# Sign message
SIGNATURE=$(node -e "
const { ethers } = require('ethers');
(async () => {
  try {
    const wallet = new ethers.Wallet('$ADMIN_PRIVATE_KEY');
    const signature = await wallet.signMessage(\`$MESSAGE\`);
    process.stdout.write(signature);
  } catch (error) {
    console.error('Sign error:', error.message);
    process.exit(1);
  }
})();
" 2>&1 | tail -1)

if [ -z "$SIGNATURE" ] || [[ ! "$SIGNATURE" =~ ^0x[a-fA-F0-9]+$ ]]; then
    print_error "Failed to sign message"
    exit 1
fi

# Login
LOGIN_PAYLOAD=$(jq -n \
  --arg wallet "$ADMIN_WALLET" \
  --arg msg "$MESSAGE" \
  --arg sig "$SIGNATURE" \
  '{walletAddress: $wallet, message: $msg, signature: $sig}')

LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.tokens.access')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    print_error "Login failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi

print_success "Authenticated successfully"
echo ""

# =============================================================================
# STEP 2: End Auction On-Chain
# =============================================================================
print_header "Step 2: End Auction On-Chain"
print_info "Calling endAuction() on PrimaryMarketplace contract..."
echo ""

END_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function endAuction() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const MARKETPLACE_ABI = [
      'function endAuction(bytes32 assetId, uint256 clearingPrice) external',
      'function listings(bytes32) view returns (address tokenAddress, bytes32 assetId, uint8 listingType, uint256 staticPrice, uint256 reservePrice, uint256 endTime, uint256 clearingPrice, uint8 auctionPhase, uint256 totalSupply, uint256 sold, bool active, uint256 minInvestment)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$ADMIN_PRIVATE_KEY', provider);

    const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;
    const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);

    // Convert UUID to bytes32
    const assetIdBytes32 = '0x' + '$ASSET_ID'.replace(/-/g, '').padEnd(64, '0');

    // Convert clearing price to USDC wei (6 decimals)
    const clearingPriceWei = ethers.parseUnits('$CLEARING_PRICE', 6);

    console.error('Asset ID (bytes32): ' + assetIdBytes32);
    console.error('Clearing Price: $CLEARING_PRICE USDC (' + clearingPriceWei.toString() + ' wei)');
    console.error('');

    // Get current listing status
    console.error('Fetching current auction status...');
    const listing = await marketplaceContract.listings(assetIdBytes32);
    const auctionPhase = listing[7]; // auctionPhase
    const sold = listing[9]; // sold
    const totalSupply = listing[8]; // totalSupply

    console.error('Current Phase: ' + (auctionPhase === 0n ? 'BIDDING' : 'ENDED'));
    console.error('Tokens Sold: ' + ethers.formatUnits(sold, 18) + ' / ' + ethers.formatUnits(totalSupply, 18));
    console.error('');

    // End the auction
    console.error('Submitting endAuction transaction...');
    const tx = await marketplaceContract.endAuction(assetIdBytes32, clearingPriceWei);
    console.error('TX Hash: ' + tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Confirmed in block ' + receipt.blockNumber);
    console.error('');

    // Return result
    console.log(JSON.stringify({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      clearingPrice: clearingPriceWei.toString()
    }));

  } catch (error) {
    console.error('END_ERROR:' + error.message);
    process.exit(1);
  }
}

endAuction();
" 2>&1)

# Check for errors
if echo "$END_RESULT" | grep -q "END_ERROR:"; then
  ERROR_MSG=$(echo "$END_RESULT" | grep "END_ERROR:" | cut -d':' -f2-)
  print_error "Failed to end auction: $ERROR_MSG"
  exit 1
fi

# Extract JSON result
TX_DATA=$(echo "$END_RESULT" | tail -1)
TX_HASH=$(echo "$TX_DATA" | jq -r '.txHash')
BLOCK_NUMBER=$(echo "$TX_DATA" | jq -r '.blockNumber')
CLEARING_PRICE_WEI=$(echo "$TX_DATA" | jq -r '.clearingPrice')

print_success "Auction ended on-chain!"
print_info "TX Hash: $TX_HASH"
print_info "Block: $BLOCK_NUMBER"
print_info "Explorer: https://sepolia.mantlescan.xyz/tx/$TX_HASH"
echo ""

# =============================================================================
# STEP 3: Create AUCTION_ENDED Announcement
# =============================================================================
print_header "Step 3: Create AUCTION_ENDED Announcement"
print_info "Notifying backend..."

END_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --arg clearingPrice "$CLEARING_PRICE_WEI" \
  --arg txHash "$TX_HASH" \
  '{assetId: $assetId, clearingPrice: $clearingPrice, transactionHash: $txHash}')

END_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/compliance/end-auction" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$END_PAYLOAD")

END_SUCCESS=$(echo "$END_RESPONSE" | jq -r '.success')

if [ "$END_SUCCESS" == "true" ]; then
    print_success "AUCTION_ENDED announcement created!"
else
    print_info "Backend notification completed (announcement may have been created by job)"
    echo "$END_RESPONSE" | jq '.'
fi

echo ""

# =============================================================================
# STEP 4: Show Auction Results
# =============================================================================
print_header "Step 4: Auction Results"

# Get all bids
BIDS_RESPONSE=$(curl -s -X GET "$API_BASE_URL/marketplace/auctions/$ASSET_ID/bids" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

TOTAL_BIDS=$(echo "$BIDS_RESPONSE" | jq '.bids | length')
print_cyan "Total Bids: $TOTAL_BIDS"
echo ""

if [ "$TOTAL_BIDS" -gt 0 ]; then
    print_cyan "Bid Summary:"
    echo "$BIDS_RESPONSE" | jq -r '.bids[] | "  • \(.bidder | .[0:10])... - \(.tokenAmount) tokens @ \(.price) USDC (Status: \(.status))"'
    echo ""

    print_cyan "Price Points:"
    echo "$BIDS_RESPONSE" | jq -r '.pricePoints[] | "  • \(.price) USDC: \(.totalTokens) tokens (\(.bidCount) bids)"'
fi

echo ""

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "Auction Ended Successfully! 🎉"
print_success "Asset ID: $ASSET_ID"
print_success "Clearing Price: $CLEARING_PRICE USDC"
echo ""
print_cyan "What happens next:"
echo "  1. Investors can now settle their bids"
echo "  2. Winning bids (>= $CLEARING_PRICE) receive tokens + refund"
echo "  3. Losing bids (< $CLEARING_PRICE) receive full USDC refund"
echo ""
print_info "Investors settle bids by calling:"
echo "  ./scripts/investor-settle-bid.sh <asset-id> <bid-index>"
echo ""
