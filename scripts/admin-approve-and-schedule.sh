#!/bin/bash

# Admin Approve and Schedule Auction Script
# Authenticates as admin, approves an asset, and schedules an auction

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ADMIN_PRIVATE_KEY="${ADMIN_PRIVATE_KEY}"
ASSET_ID="${1}"
START_DELAY_MINUTES="${2:-5}" # Default 5 minutes if not specified

# Function to print headers
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print info
print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Function to print cyan info
print_cyan() {
    echo -e "${CYAN}$1${NC}"
}

# Validate inputs
if [ -z "$ADMIN_PRIVATE_KEY" ]; then
    print_error "ADMIN_PRIVATE_KEY not set!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh <asset-id> [start-delay-minutes]"
    echo ""
    echo "Parameters:"
    echo "  asset-id              : UUID of the asset to approve and schedule"
    echo "  start-delay-minutes   : Minutes from now when auction should start (default: 5)"
    echo ""
    echo "Example:"
    echo "  ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh 550e8400-e29b-41d4-a716-446655440000 10"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Asset ID not provided!"
    echo "Usage: ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh <asset-id> [start-delay-minutes]"
    exit 1
fi

# Get wallet address from private key using ethers.js
ADMIN_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$ADMIN_PRIVATE_KEY');
console.log(wallet.address);
")

print_header "Admin Approve & Schedule Auction"
print_info "API: $API_BASE_URL"
print_info "Admin Wallet: $ADMIN_WALLET"
print_info "Asset ID: $ASSET_ID"
print_info "Start Delay: $START_DELAY_MINUTES minutes"

# =============================================================================
# STEP 1: Get Authentication Challenge
# =============================================================================
print_header "Step 1: Get Authentication Challenge"
print_info "Requesting admin challenge from server..."

CHALLENGE_RESPONSE=$(curl -s "$API_BASE_URL/auth/challenge?walletAddress=$ADMIN_WALLET&role=ADMIN")
MESSAGE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.message')
NONCE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.nonce')

if [ -z "$MESSAGE" ] || [ "$MESSAGE" == "null" ]; then
    print_error "Failed to get challenge"
    echo "$CHALLENGE_RESPONSE"
    exit 1
fi

print_success "Challenge received"
print_info "Nonce: $NONCE"

# =============================================================================
# STEP 2: Sign Authentication Message
# =============================================================================
print_header "Step 2: Sign Authentication Message"
print_info "Signing message with admin private key..."

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
    echo "Signature output: '$SIGNATURE'"
    exit 1
fi

print_success "Message signed"
print_info "Signature: ${SIGNATURE:0:20}..."

# =============================================================================
# STEP 3: Login as Admin
# =============================================================================
print_header "Step 3: Login as Admin"
print_info "Submitting authentication..."

LOGIN_PAYLOAD=$(jq -n \
  --arg wallet "$ADMIN_WALLET" \
  --arg msg "$MESSAGE" \
  --arg sig "$SIGNATURE" \
  '{walletAddress: $wallet, message: $msg, signature: $sig}')

LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.tokens.access')
USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id')
USER_ROLE=$(echo "$LOGIN_RESPONSE" | jq -r '.user.role')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    print_error "Login failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi

print_success "Login successful"
print_info "User ID: $USER_ID"
print_info "Role: $USER_ROLE"

# =============================================================================
# STEP 4: Get Asset Details
# =============================================================================
print_header "Step 4: Get Asset Details"
print_info "Fetching asset information..."

ASSET_RESPONSE=$(curl -s -X GET "$API_BASE_URL/assets/$ASSET_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

ASSET_STATUS=$(echo "$ASSET_RESPONSE" | jq -r '.status')
ASSET_TYPE=$(echo "$ASSET_RESPONSE" | jq -r '.assetType')
INVOICE_NUMBER=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.invoiceNumber')
FACE_VALUE=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.faceValue')
INDUSTRY=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.industry')
RISK_TIER=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.riskTier')

if [ "$ASSET_STATUS" == "null" ]; then
    print_error "Failed to fetch asset details"
    echo "$ASSET_RESPONSE"
    exit 1
fi

print_success "Asset details retrieved"
echo ""
print_cyan "Asset Information:"
echo "  • Invoice Number: $INVOICE_NUMBER"
echo "  • Face Value: $FACE_VALUE USD"
echo "  • Industry: $INDUSTRY"
echo "  • Risk Tier: $RISK_TIER"
echo "  • Asset Type: $ASSET_TYPE"
echo "  • Current Status: $ASSET_STATUS"

# Validate asset type
if [ "$ASSET_TYPE" != "AUCTION" ]; then
    print_error "Asset is not an AUCTION type (found: $ASSET_TYPE)"
    exit 1
fi

# =============================================================================
# STEP 5: Approve Asset
# =============================================================================
print_header "Step 5: Approve Asset"
print_info "Submitting approval request..."

APPROVE_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --arg adminWallet "$ADMIN_WALLET" \
  '{assetId: $assetId, adminWallet: $adminWallet}')

APPROVE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/compliance/approve" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$APPROVE_PAYLOAD")

APPROVE_SUCCESS=$(echo "$APPROVE_RESPONSE" | jq -r '.success')
NEW_STATUS=$(echo "$APPROVE_RESPONSE" | jq -r '.status')

if [ "$APPROVE_SUCCESS" != "true" ]; then
    print_error "Asset approval failed"
    echo "$APPROVE_RESPONSE"
    exit 1
fi

print_success "Asset approved successfully!"
print_info "New Status: $NEW_STATUS"

# Wait for processing
sleep 2

# =============================================================================
# STEP 5.5: Register Asset On-Chain
# =============================================================================
print_header "Step 5.5: Register Asset On-Chain"
print_info "Registering asset with attestation..."

REGISTER_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/assets/$ASSET_ID/register" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

REGISTER_SUCCESS=$(echo "$REGISTER_RESPONSE" | jq -r '.success')
REGISTER_TX_HASH=$(echo "$REGISTER_RESPONSE" | jq -r '.transactionHash')

if [ "$REGISTER_SUCCESS" == "true" ]; then
  print_success "Asset registered on-chain!"
  print_info "Transaction Hash: $REGISTER_TX_HASH"
else
  ERROR_MSG=$(echo "$REGISTER_RESPONSE" | jq -r '.error // .message // "Unknown error"')
  if [[ "$ERROR_MSG" == *"already registered"* ]]; then
    print_info "Asset was already registered, continuing..."
  else
    print_error "Asset registration failed: $ERROR_MSG"
    echo "$REGISTER_RESPONSE"
    exit 1
  fi
fi

# Wait for transaction confirmation
print_info "Waiting 10 seconds for transaction confirmation..."
sleep 10

# =============================================================================
# STEP 5.75: Deploy Token
# =============================================================================
print_header "Step 5.75: Deploy RWA Token"
print_info "Deploying ERC-20 token contract..."

# Extract token details from asset
TOKEN_NAME=$(echo "$ASSET_RESPONSE" | jq -r '.metadata.invoiceNumber // "Auction Token"' | sed 's/^/Auction RWA Token - /')
TOKEN_SYMBOL="ARWA"

print_info "Token Name: $TOKEN_NAME"
print_info "Token Symbol: $TOKEN_SYMBOL"

DEPLOY_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --arg name "$TOKEN_NAME" \
  --arg symbol "$TOKEN_SYMBOL" \
  '{assetId: $assetId, name: $name, symbol: $symbol}')

DEPLOY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/assets/deploy-token" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$DEPLOY_PAYLOAD")

DEPLOY_SUCCESS=$(echo "$DEPLOY_RESPONSE" | jq -r '.success')
TOKEN_ADDRESS=$(echo "$DEPLOY_RESPONSE" | jq -r '.tokenAddress')
DEPLOY_TX_HASH=$(echo "$DEPLOY_RESPONSE" | jq -r '.transactionHash')

if [ "$DEPLOY_SUCCESS" == "true" ]; then
  print_success "Token deployed successfully!"
  print_info "Token Address: $TOKEN_ADDRESS"
  print_info "Transaction Hash: $DEPLOY_TX_HASH"
else
  ERROR_MSG=$(echo "$DEPLOY_RESPONSE" | jq -r '.error // .message // "Unknown error"')
  if [[ "$ERROR_MSG" == *"already deployed"* ]] || [[ "$ERROR_MSG" == *"already tokenized"* ]]; then
    print_info "Token was already deployed for this asset"
    # Get token address from asset data
    ASSET_REFRESH=$(curl -s -X GET "$API_BASE_URL/assets/$ASSET_ID" \
      -H "Authorization: Bearer $ACCESS_TOKEN")
    TOKEN_ADDRESS=$(echo "$ASSET_REFRESH" | jq -r '.token.address // empty')
    if [ ! -z "$TOKEN_ADDRESS" ]; then
      print_info "Found existing token address: $TOKEN_ADDRESS"
    fi
  else
    print_error "Token deployment failed: $ERROR_MSG"
    echo "$DEPLOY_RESPONSE"
    exit 1
  fi
fi

# Wait for transaction to settle
print_info "Waiting 10 seconds for token deployment to settle..."
sleep 10

# =============================================================================
# STEP 6: Schedule Auction
# =============================================================================
print_header "Step 6: Schedule Auction"
print_info "Scheduling auction to start in $START_DELAY_MINUTES minutes..."

SCHEDULE_PAYLOAD=$(jq -n \
  --arg assetId "$ASSET_ID" \
  --argjson delay "$START_DELAY_MINUTES" \
  '{assetId: $assetId, startDelayMinutes: $delay}')

SCHEDULE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/compliance/schedule-auction" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$SCHEDULE_PAYLOAD")

SCHEDULE_SUCCESS=$(echo "$SCHEDULE_RESPONSE" | jq -r '.success')
SCHEDULED_START=$(echo "$SCHEDULE_RESPONSE" | jq -r '.scheduledStartTime')
SCHEDULE_MESSAGE=$(echo "$SCHEDULE_RESPONSE" | jq -r '.message')

if [ "$SCHEDULE_SUCCESS" != "true" ]; then
    print_error "Auction scheduling failed"
    echo "$SCHEDULE_RESPONSE"
    exit 1
fi

print_success "Auction scheduled successfully!"
print_info "$SCHEDULE_MESSAGE"
print_info "Scheduled Start Time: $SCHEDULED_START"

# =============================================================================
# STEP 7: Verify Announcement Created
# =============================================================================
print_header "Step 7: Verify Announcement Created"
print_info "Fetching announcements for this asset..."

sleep 1 # Give the system a moment to create the announcement

ANNOUNCEMENTS_RESPONSE=$(curl -s -X GET "$API_BASE_URL/announcements/asset/$ASSET_ID")
ANNOUNCEMENT_COUNT=$(echo "$ANNOUNCEMENTS_RESPONSE" | jq '. | length')

if [ "$ANNOUNCEMENT_COUNT" -gt 0 ]; then
    print_success "Found $ANNOUNCEMENT_COUNT announcement(s)"
    echo ""
    print_cyan "Latest Announcement:"
    LATEST_ANNOUNCEMENT=$(echo "$ANNOUNCEMENTS_RESPONSE" | jq '.[0]')
    ANNOUNCEMENT_TYPE=$(echo "$LATEST_ANNOUNCEMENT" | jq -r '.type')
    ANNOUNCEMENT_TITLE=$(echo "$LATEST_ANNOUNCEMENT" | jq -r '.title')
    ANNOUNCEMENT_MESSAGE=$(echo "$LATEST_ANNOUNCEMENT" | jq -r '.message')

    echo "  • Type: $ANNOUNCEMENT_TYPE"
    echo "  • Title: $ANNOUNCEMENT_TITLE"
    echo "  • Message: $ANNOUNCEMENT_MESSAGE"
else
    print_error "No announcements found (this might be a timing issue)"
fi

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "Complete! 🎉"
print_success "Asset ID: $ASSET_ID"
print_success "Token Address: $TOKEN_ADDRESS"
print_success "Status: TOKENIZED & SCHEDULED"
echo ""
print_cyan "Timeline:"
echo "  1. ✓ Asset approved (status: $NEW_STATUS)"
echo "  2. ✓ Asset registered on-chain"
echo "  3. ✓ Token deployed at: $TOKEN_ADDRESS"
echo "  4. ✓ Auction scheduled for: $SCHEDULED_START"
echo "  5. ⏳ Auction will activate in $START_DELAY_MINUTES minutes"
echo "  6. ⏳ Status check will run 1 minute after activation"
echo ""
print_cyan "What happens next:"
echo "  • In $START_DELAY_MINUTES min: Auction activates"
echo "    - Creates on-chain listing in PrimaryMarketplace contract"
echo "    - Updates database (listing.active = true)"
echo "  • In $((START_DELAY_MINUTES + 1)) min: System checks if auction is live"
echo "  • If successful: AUCTION_LIVE announcement created"
echo "  • If failed: AUCTION_FAILED announcement created with reason"
echo ""
print_info "Monitor announcements:"
echo "  curl -X GET \"$API_BASE_URL/announcements/asset/$ASSET_ID\" | jq"
echo ""
print_info "Check all active auctions:"
echo "  curl -X GET \"$API_BASE_URL/announcements?type=AUCTION_LIVE&status=ACTIVE\" | jq"
echo ""
print_info "Save these for reference:"
echo "  export ASSET_ID=\"$ASSET_ID\""
echo "  export ADMIN_TOKEN=\"$ACCESS_TOKEN\""
echo ""
