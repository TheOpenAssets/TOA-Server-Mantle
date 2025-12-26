#!/bin/bash

# Admin Settle Yield Script
# Complete yield settlement flow: record settlement → confirm USDC → distribute on-chain

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
SETTLEMENT_AMOUNT="${2}"  # In USD (e.g., 100000 for $100k)

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

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Validate inputs
if [ -z "$ADMIN_PRIVATE_KEY" ]; then
    print_error "ADMIN_PRIVATE_KEY not set!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-settle-yield.sh <asset-id> <settlement-amount>"
    echo ""
    echo "Parameters:"
    echo "  asset-id          : UUID of the asset"
    echo "  settlement-amount : Face value paid by originator in USD (e.g., 100000)"
    echo ""
    echo "Example:"
    echo "  ADMIN_PRIVATE_KEY=0x... ./admin-settle-yield.sh b6796e6c-68fa-46a6-bfeb-a661dac528a3 100000"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Asset ID not provided!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-settle-yield.sh <asset-id> <settlement-amount>"
    exit 1
fi

if [ -z "$SETTLEMENT_AMOUNT" ]; then
    print_error "Settlement amount not provided!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-settle-yield.sh <asset-id> <settlement-amount>"
    exit 1
fi

# Validate settlement amount is a number
if ! [[ "$SETTLEMENT_AMOUNT" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    print_error "Settlement amount must be a number (e.g., 100000)"
    exit 1
fi

print_header "Admin Yield Settlement"
print_info "API: $API_BASE_URL"
print_info "Asset ID: $ASSET_ID"
print_info "Settlement Amount: \$$SETTLEMENT_AMOUNT USD"
echo ""

# Get admin wallet address
ADMIN_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$ADMIN_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Admin Wallet: $ADMIN_WALLET"

# =============================================================================
# STEP 1: Admin Authentication
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
# STEP 2: Verify Asset State
# =============================================================================
print_header "Step 2: Verify Asset State"
print_info "Fetching asset details..."

ASSET_RESPONSE=$(curl -s -X GET "$API_BASE_URL/assets/$ASSET_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

ASSET_STATUS=$(echo "$ASSET_RESPONSE" | jq -r '.status')
TOKEN_ADDRESS=$(echo "$ASSET_RESPONSE" | jq -r '.token.address')
FACE_VALUE=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.faceValue')
AMOUNT_RAISED=$(echo "$ASSET_RESPONSE" | jq -r '.listing.amountRaised // "0"')

print_cyan "Asset Status: $ASSET_STATUS"
print_cyan "Token Address: $TOKEN_ADDRESS"
print_cyan "Face Value: \$$FACE_VALUE USD"
print_cyan "Amount Raised: $AMOUNT_RAISED USDC (wei)"
echo ""

if [ "$ASSET_STATUS" != "PAYOUT_COMPLETE" ]; then
    print_error "Asset must be in PAYOUT_COMPLETE status!"
    print_info "Current status: $ASSET_STATUS"
    exit 1
fi

print_success "Asset ready for yield settlement"
echo ""

# =============================================================================
# STEP 3: Record Settlement
# =============================================================================
print_header "Step 3: Record Settlement"
print_info "Creating settlement record with platform fee calculation..."

SETTLEMENT_DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

SETTLEMENT_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --argjson settlementAmount "$SETTLEMENT_AMOUNT" \
  --arg settlementDate "$SETTLEMENT_DATE" \
  '{assetId: $assetId, settlementAmount: $settlementAmount, settlementDate: $settlementDate}')

SETTLEMENT_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/yield/settlement" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$SETTLEMENT_PAYLOAD")

SETTLEMENT_ID=$(echo "$SETTLEMENT_RESPONSE" | jq -r '._id')
NET_DISTRIBUTION=$(echo "$SETTLEMENT_RESPONSE" | jq -r '.netDistribution')
PLATFORM_FEE=$(echo "$SETTLEMENT_RESPONSE" | jq -r '.platformFee')
SETTLEMENT_STATUS=$(echo "$SETTLEMENT_RESPONSE" | jq -r '.status')

if [ -z "$SETTLEMENT_ID" ] || [ "$SETTLEMENT_ID" == "null" ]; then
    print_error "Failed to record settlement"
    echo "$SETTLEMENT_RESPONSE"
    exit 1
fi

print_success "Settlement recorded!"
print_cyan "Settlement ID: $SETTLEMENT_ID"
print_cyan "Settlement Amount: \$$SETTLEMENT_AMOUNT USD"
print_cyan "Platform Fee (1.5%): \$$PLATFORM_FEE USD"
print_cyan "Net Distribution: \$$NET_DISTRIBUTION USD"
print_cyan "Status: $SETTLEMENT_STATUS"
echo ""

# =============================================================================
# STEP 4: Confirm USDC Conversion
# =============================================================================
print_header "Step 4: Confirm USDC Conversion"
print_info "Converting settlement to USDC amount..."

# Convert to USDC wei (6 decimals)
# Assuming 1 USD = 1 USDC for simplicity (adjust exchange rate if needed)
USDC_AMOUNT=$(echo "$NET_DISTRIBUTION * 1000000" | bc)
USDC_AMOUNT_INT=${USDC_AMOUNT%.*}  # Remove decimal point

USDC_HUMAN=$(echo "scale=6; $USDC_AMOUNT_INT / 1000000" | bc)

print_cyan "Net Distribution: \$$NET_DISTRIBUTION USD"
print_cyan "USDC Amount: $USDC_HUMAN USDC ($USDC_AMOUNT_INT wei)"
echo ""

CONFIRM_PAYLOAD=$(jq -n \
  --arg settlementId "$SETTLEMENT_ID" \
  --arg usdcAmount "$USDC_AMOUNT_INT" \
  '{settlementId: $settlementId, usdcAmount: $usdcAmount}')

CONFIRM_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/yield/confirm-usdc" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$CONFIRM_PAYLOAD")

CONFIRMED_STATUS=$(echo "$CONFIRM_RESPONSE" | jq -r '.status')

if [ "$CONFIRMED_STATUS" != "READY_FOR_DISTRIBUTION" ]; then
    print_error "Failed to confirm USDC conversion"
    echo "$CONFIRM_RESPONSE"
    exit 1
fi

print_success "USDC conversion confirmed!"
print_cyan "Status: $CONFIRMED_STATUS"
echo ""

# =============================================================================
# STEP 5: Distribute Yield On-Chain
# =============================================================================
print_header "Step 5: Distribute Yield On-Chain"
print_warning "This will execute blockchain transactions!"
print_info "  • USDC approval to YieldVault"
print_info "  • Deposit USDC to YieldVault"
print_info "  • Distribute to all token holders (time-weighted)"
echo ""

read -p "Continue with on-chain distribution? (y/n): " CONTINUE

if [ "$CONTINUE" != "y" ]; then
    print_warning "Distribution cancelled. You can resume later using:"
    echo "  curl -X POST $API_BASE_URL/admin/yield/distribute \\"
    echo "    -H 'Authorization: Bearer \$ACCESS_TOKEN' \\"
    echo "    -H 'Content-Type: application/json' \\"
    echo "    -d '{\"settlementId\": \"$SETTLEMENT_ID\"}'"
    exit 0
fi

print_info "Triggering time-weighted yield distribution..."
print_info "This may take a while (approx 30-60 seconds)..."
echo ""

DISTRIBUTE_PAYLOAD=$(jq -n \
  --arg settlementId "$SETTLEMENT_ID" \
  '{settlementId: $settlementId}')

DISTRIBUTE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/yield/distribute" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$DISTRIBUTE_PAYLOAD")

DIST_MESSAGE=$(echo "$DISTRIBUTE_RESPONSE" | jq -r '.message')
DIST_TOTAL=$(echo "$DISTRIBUTE_RESPONSE" | jq -r '.totalDistributed')
DIST_HOLDERS=$(echo "$DISTRIBUTE_RESPONSE" | jq -r '.holders')
DIST_TOKEN_DAYS=$(echo "$DISTRIBUTE_RESPONSE" | jq -r '.totalTokenDays')
DIST_YIELD=$(echo "$DISTRIBUTE_RESPONSE" | jq -r '.effectiveYield')

if [ -z "$DIST_MESSAGE" ] || [ "$DIST_MESSAGE" == "null" ]; then
    print_error "Distribution failed"
    echo "$DISTRIBUTE_RESPONSE"
    exit 1
fi

print_success "Distribution complete!"
echo ""

# =============================================================================
# STEP 6: Show Distribution Results
# =============================================================================
print_header "Step 6: Distribution Results"

DIST_USDC_HUMAN=$(echo "scale=6; $DIST_TOTAL / 1000000" | bc)

print_cyan "Message: $DIST_MESSAGE"
print_cyan "Total Distributed: $DIST_USDC_HUMAN USDC ($DIST_TOTAL wei)"
print_cyan "Holders: $DIST_HOLDERS"
print_cyan "Total Token-Days: $DIST_TOKEN_DAYS"
print_cyan "Effective Yield: $DIST_YIELD"
echo ""

# Get final settlement status
SETTLEMENT_CHECK=$(curl -s -X GET "$API_BASE_URL/admin/yield/settlement/$SETTLEMENT_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN" 2>/dev/null || echo '{"status":"UNKNOWN"}')

FINAL_STATUS=$(echo "$SETTLEMENT_CHECK" | jq -r '.status')

if [ "$FINAL_STATUS" == "DISTRIBUTED" ]; then
    print_success "Settlement status: DISTRIBUTED ✓"
else
    print_warning "Settlement status: $FINAL_STATUS"
fi

echo ""

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "Yield Settlement Complete! 🎉"
print_success "Asset ID: $ASSET_ID"
print_success "Settlement ID: $SETTLEMENT_ID"
print_success "Token Address: $TOKEN_ADDRESS"
echo ""
print_cyan "Settlement Summary:"
echo "  Settlement Amount:     \$$SETTLEMENT_AMOUNT USD"
echo "  Platform Fee (1.5%):   \$$PLATFORM_FEE USD"
echo "  Net Distribution:      \$$NET_DISTRIBUTION USD"
echo "  USDC Distributed:      $DIST_USDC_HUMAN USDC"
echo ""
print_cyan "Distribution Summary:"
echo "  Holders:               $DIST_HOLDERS"
echo "  Total Token-Days:      $DIST_TOKEN_DAYS"
echo "  Effective Yield:       $DIST_YIELD"
echo ""
print_cyan "What happens next:"
echo "  1. Investors can now claim their USDC yield"
echo "  2. Each investor calls claimAllYield() on YieldVault"
echo "  3. USDC is transferred to investor's wallet"
echo ""
print_info "Verify on-chain:"
echo "  YieldVault.getUserClaimable(holderAddress)"
echo ""
print_info "Token Address: $TOKEN_ADDRESS"
echo ""
