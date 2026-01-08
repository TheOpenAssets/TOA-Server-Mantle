#!/bin/bash

# Investor Settle Bid Script
# Settles an auction bid after the auction has ended

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
INVESTOR_PRIVATE_KEY="${INVESTOR_PRIVATE_KEY}"
ASSET_ID="${1}"
BID_INDEX="${2}"

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
if [ -z "$INVESTOR_PRIVATE_KEY" ]; then
    print_error "INVESTOR_PRIVATE_KEY not set!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-settle-bid.sh <asset-id> <bid-index>"
    echo ""
    echo "Parameters:"
    echo "  asset-id   : UUID of the auction"
    echo "  bid-index  : Index of your bid (usually 0 for first bid)"
    echo ""
    echo "Example:"
    echo "  INVESTOR_PRIVATE_KEY=0x... ./investor-settle-bid.sh 550e8400-e29b-41d4-a716-446655440000 0"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Asset ID not provided!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-settle-bid.sh <asset-id> <bid-index>"
    exit 1
fi

if [ -z "$BID_INDEX" ]; then
    print_error "Bid index not provided!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-settle-bid.sh <asset-id> <bid-index>"
    exit 1
fi

# Validate bid index is a number
if ! [[ "$BID_INDEX" =~ ^[0-9]+$ ]]; then
    print_error "Bid index must be a number"
    exit 1
fi

print_header "Settle Auction Bid"
print_info "API: $API_BASE_URL"
print_info "Asset ID: $ASSET_ID"
print_info "Bid Index: $BID_INDEX"
echo ""

# Get investor wallet address
INVESTOR_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Investor Wallet: $INVESTOR_WALLET"

# =============================================================================
# STEP 1: Investor Authentication
# =============================================================================
print_header "Step 1: Investor Authentication"
print_info "Requesting challenge..."

CHALLENGE_RESPONSE=$(curl -s "$API_BASE_URL/auth/challenge?walletAddress=$INVESTOR_WALLET&role=INVESTOR")
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
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
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
  --arg wallet "$INVESTOR_WALLET" \
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
# STEP 2: Settle Bid On-Chain
# =============================================================================
print_header "Step 2: Settle Bid On-Chain"
print_info "Calling settleBid() on PrimaryMarketplace contract..."
echo ""

set +e  # Don't exit on error, we want to capture it
SETTLE_RESULT=$(node --trace-warnings -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function settleBid() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const MARKETPLACE_ABI = [
      'function settleBid(bytes32 assetId, uint256 bidIndex) external',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);

    const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;
    const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);

    // Convert UUID to bytes32
    const assetIdBytes32 = '0x' + '$ASSET_ID'.replace(/-/g, '').padEnd(64, '0');

    console.error('Asset ID (bytes32): ' + assetIdBytes32);
    console.error('Bid Index: $BID_INDEX');
    console.error('Investor: ' + wallet.address);
    console.error('');

    // Settle the bid
    console.error('Submitting settleBid transaction...');
    const tx = await marketplaceContract.settleBid(assetIdBytes32, $BID_INDEX);
    console.error('TX Hash: ' + tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Confirmed in block ' + receipt.blockNumber);
    console.error('');

    // Return result
    console.log(JSON.stringify({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber.toString()
    }));

  } catch (error) {
    console.error('SETTLE_ERROR:' + error.message);
    if (error.reason) console.error('Reason: ' + error.reason);
    if (error.code) console.error('Code: ' + error.code);
    if (error.data) console.error('Data: ' + JSON.stringify(error.data));
    console.error('Full error:' + JSON.stringify(error, Object.getOwnPropertyNames(error)));
    process.exit(1);
  }
}

settleBid().catch(err => {
  console.error('SETTLE_ERROR:Unhandled error: ' + err.message);
  process.exit(1);
});
" 2>&1)
NODE_EXIT_CODE=$?
set -e  # Re-enable exit on error

# ALWAYS show the output, even if empty
echo "━━━━━━━━━━━━━━━ Raw Settlement Output ━━━━━━━━━━━━━━━"
if [ -z "$SETTLE_RESULT" ]; then
  print_error "NO OUTPUT CAPTURED (node exit code: $NODE_EXIT_CODE)"
else
  echo "$SETTLE_RESULT"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check for errors
if [ "$NODE_EXIT_CODE" -ne 0 ] || echo "$SETTLE_RESULT" | grep -q "SETTLE_ERROR:"; then
  print_error "Settlement transaction failed!"
  exit 1
fi

# Extract JSON result
TX_DATA=$(echo "$SETTLE_RESULT" | tail -1)
TX_HASH=$(echo "$TX_DATA" | jq -r '.txHash')
BLOCK_NUMBER=$(echo "$TX_DATA" | jq -r '.blockNumber')

print_success "Bid settled on-chain!"
print_info "TX Hash: $TX_HASH"
print_info "Block: $BLOCK_NUMBER"
print_info "Explorer: https://sepolia.mantlescan.xyz/tx/$TX_HASH"
echo ""

# =============================================================================
# STEP 3: Notify Backend
# =============================================================================
print_header "Step 3: Notify Backend"
print_info "Updating bid status in database..."

NOTIFY_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --argjson bidIndex "$BID_INDEX" \
  --arg txHash "$TX_HASH" \
  --argjson blockNumber "$BLOCK_NUMBER" \
  '{assetId: $assetId, bidIndex: $bidIndex, txHash: $txHash, blockNumber: $blockNumber}')

NOTIFY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/marketplace/bids/settle-notify" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$NOTIFY_PAYLOAD")

echo "━━━━━━━━━━━━━━━ Backend API Response ━━━━━━━━━━━━━━━"
echo "$NOTIFY_RESPONSE" | jq '.' || echo "$NOTIFY_RESPONSE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

NOTIFY_SUCCESS=$(echo "$NOTIFY_RESPONSE" | jq -r '.success')

if [ "$NOTIFY_SUCCESS" == "true" ]; then
    STATUS=$(echo "$NOTIFY_RESPONSE" | jq -r '.status')
    TOKENS_RECEIVED=$(echo "$NOTIFY_RESPONSE" | jq -r '.tokensReceived')
    REFUND_AMOUNT=$(echo "$NOTIFY_RESPONSE" | jq -r '.refundAmount')

    print_success "Backend notified successfully!"
    print_info "Status: $STATUS"

    if [ "$TOKENS_RECEIVED" != "0" ]; then
        print_cyan "🎉 Winning Bid!"
        print_cyan "   Tokens Received: $(echo "scale=2; $TOKENS_RECEIVED / 10^18" | bc -l) tokens"
        if [ "$REFUND_AMOUNT" != "0" ]; then
            print_cyan "   Refund: $(echo "scale=2; $REFUND_AMOUNT / 10^6" | bc -l) USDC (price difference)"
        fi
    else
        print_cyan "💸 Losing Bid - Full Refund"
        print_cyan "   Refund: $(echo "scale=2; $REFUND_AMOUNT / 10^6" | bc -l) USDC"
    fi
else
    print_error "Backend notification may have failed - check response above"
fi

echo ""

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "Settlement Complete! 🎉"
print_success "Asset ID: $ASSET_ID"
print_success "Bid Index: $BID_INDEX"
echo ""
print_info "Check your wallet for tokens/refund"
echo ""
