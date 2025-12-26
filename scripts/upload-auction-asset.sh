#!/bin/bash

# Originator Auction Asset Upload Script
# Authenticates as originator and uploads an invoice asset for auction

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ORIGINATOR_PRIVATE_KEY="${ORIGINATOR_PRIVATE_KEY}"
INVOICE_FILE="${1}"

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

# Validate inputs
if [ -z "$ORIGINATOR_PRIVATE_KEY" ]; then
    print_error "ORIGINATOR_PRIVATE_KEY not set!"
    echo "Usage: ORIGINATOR_PRIVATE_KEY=0x... ./upload-auction-asset.sh <path-to-invoice.pdf>"
    exit 1
fi

if [ -z "$INVOICE_FILE" ]; then
    print_error "Invoice file path not provided!"
    echo "Usage: ORIGINATOR_PRIVATE_KEY=0x... ./upload-auction-asset.sh <path-to-invoice.pdf>"
    exit 1
fi

if [ ! -f "$INVOICE_FILE" ]; then
    print_error "File not found: $INVOICE_FILE"
    exit 1
fi

# Get wallet address from private key using ethers.js
WALLET_ADDRESS=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$ORIGINATOR_PRIVATE_KEY');
console.log(wallet.address);
")

print_header "Originator Auction Asset Upload"
print_info "API: $API_BASE_URL"
print_info "Originator: $WALLET_ADDRESS"
print_info "Invoice: $(basename "$INVOICE_FILE")"

# Step 1: Get Challenge
print_header "Step 1: Get Authentication Challenge"
print_info "Requesting challenge from server..."

CHALLENGE_RESPONSE=$(curl -s "$API_BASE_URL/auth/challenge?walletAddress=$WALLET_ADDRESS&role=ORIGINATOR")
MESSAGE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.message')
NONCE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.nonce')

if [ -z "$MESSAGE" ] || [ "$MESSAGE" == "null" ]; then
    print_error "Failed to get challenge"
    echo "$CHALLENGE_RESPONSE"
    exit 1
fi

print_success "Challenge received"
print_info "Nonce: $NONCE"

# Step 2: Sign Message
print_header "Step 2: Sign Authentication Message"
print_info "Signing message with private key..."

# Sign using inline node command (more reliable than temp files)
SIGNATURE=$(node -e "
const { ethers } = require('ethers');
(async () => {
  try {
    const wallet = new ethers.Wallet('$ORIGINATOR_PRIVATE_KEY');
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

# Step 3: Login
print_header "Step 3: Login to Platform"
print_info "Submitting authentication..."

# Create JSON payload properly with jq to handle escaping
LOGIN_PAYLOAD=$(jq -n \
  --arg wallet "$WALLET_ADDRESS" \
  --arg msg "$MESSAGE" \
  --arg sig "$SIGNATURE" \
  '{walletAddress: $wallet, message: $msg, signature: $sig}')

LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.tokens.access')
USER_ID=$(echo "$LOGIN_RESPONSE" | jq -r '.user.id')
USER_ROLE=$(echo "$LOGIN_RESPONSE" | jq -r '.user.role')
KYC_STATUS=$(echo "$LOGIN_RESPONSE" | jq -r '.user.kyc')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    print_error "Login failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi

print_success "Login successful"
print_info "User ID: $USER_ID"
print_info "Role: $USER_ROLE"
print_info "KYC Status: $KYC_STATUS"

# Step 4: Upload Auction Asset
print_header "Step 4: Upload Auction Asset"
print_info "Uploading asset with auction parameters..."

INVOICE_NUMBER="INV-AUCTION-$(date +%s | tail -c 7)"

# Invoice Details
FACE_VALUE="100000"  # Face value in USD (no decimals)
CURRENCY="USD"
ISSUE_DATE="2025-01-01"
DUE_DATE="2025-07-01"
BUYER_NAME="Tech Solutions Inc"
INDUSTRY="Technology"
RISK_TIER="A"

# Token Parameters
TOTAL_SUPPLY="100000000000000000000000"  # 100,000 tokens (18 decimals)
MIN_INVESTMENT="1000000000000000000000"  # 1,000 USDC (minimum investment per bidder, 18 decimals)

# Raise Parameters (as percentage of face value)
# Platform fee is 1.5%, we want 5% margin for yield = 95% max
MIN_RAISE_PERCENTAGE="80"  # Minimum 80% of face value must be raised (80,000 USD)
MAX_RAISE_PERCENTAGE="95"  # Maximum 95% of face value (95,000 USD, leaving room for yield)

# Auction Duration
AUCTION_DURATION="900"  # 15 minutes in seconds

print_info "Pricing Calculation:"
print_info "  Face Value: $FACE_VALUE USD"
print_info "  Min Raise: ${MIN_RAISE_PERCENTAGE}% = $((FACE_VALUE * MIN_RAISE_PERCENTAGE / 100)) USD"
print_info "  Max Raise: ${MAX_RAISE_PERCENTAGE}% = $((FACE_VALUE * MAX_RAISE_PERCENTAGE / 100)) USD"
print_info "  This leaves ~5% margin for platform fees (1.5%) and investor yield"
echo ""

UPLOAD_RESPONSE=$(curl -s -X POST "$API_BASE_URL/assets/upload" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@$INVOICE_FILE" \
  -F "invoiceNumber=$INVOICE_NUMBER" \
  -F "faceValue=$FACE_VALUE" \
  -F "currency=$CURRENCY" \
  -F "issueDate=$ISSUE_DATE" \
  -F "dueDate=$DUE_DATE" \
  -F "buyerName=$BUYER_NAME" \
  -F "industry=$INDUSTRY" \
  -F "riskTier=$RISK_TIER" \
  -F "assetType=AUCTION" \
  -F "totalSupply=$TOTAL_SUPPLY" \
  -F "minInvestment=$MIN_INVESTMENT" \
  -F "minRaisePercentage=$MIN_RAISE_PERCENTAGE" \
  -F "maxRaisePercentage=$MAX_RAISE_PERCENTAGE" \
  -F "auctionDuration=$AUCTION_DURATION")

ASSET_ID=$(echo "$UPLOAD_RESPONSE" | jq -r '.assetId')
STATUS=$(echo "$UPLOAD_RESPONSE" | jq -r '.status')
ASSET_TYPE=$(echo "$UPLOAD_RESPONSE" | jq -r '.assetType')
MESSAGE_TEXT=$(echo "$UPLOAD_RESPONSE" | jq -r '.message')
MIN_PRICE_WEI=$(echo "$UPLOAD_RESPONSE" | jq -r '.priceRange.min')
MAX_PRICE_WEI=$(echo "$UPLOAD_RESPONSE" | jq -r '.priceRange.max')
MIN_RAISE_WEI=$(echo "$UPLOAD_RESPONSE" | jq -r '.priceRange.minRaise')
MAX_RAISE_WEI=$(echo "$UPLOAD_RESPONSE" | jq -r '.priceRange.maxRaise')

if [ -z "$ASSET_ID" ] || [ "$ASSET_ID" == "null" ]; then
    print_error "Upload failed"
    echo "$UPLOAD_RESPONSE"
    exit 1
fi

# Convert USDC wei to human readable (divide by 10^6 for USDC)
# Use Number() to handle decimals properly
MIN_PRICE_USD=$(node -e "console.log((Number('$MIN_PRICE_WEI') / 1000000).toFixed(2))")
MAX_PRICE_USD=$(node -e "console.log((Number('$MAX_PRICE_WEI') / 1000000).toFixed(2))")
MIN_RAISE_USD=$(node -e "console.log((Number('$MIN_RAISE_WEI') / 1000000).toFixed(0))")
MAX_RAISE_USD=$(node -e "console.log((Number('$MAX_RAISE_WEI') / 1000000).toFixed(0))")

print_success "Auction asset uploaded successfully!"
echo ""
echo "Response:"
echo "$UPLOAD_RESPONSE" | jq '.'

# Summary
print_header "Upload Complete! 🎉"
print_success "Asset ID: $ASSET_ID"
print_success "Status: $STATUS"
print_success "Asset Type: $ASSET_TYPE"
print_success "Message: $MESSAGE_TEXT"
echo ""
print_info "Invoice Details:"
echo "  • Invoice Number: $INVOICE_NUMBER"
echo "  • Face Value: $FACE_VALUE $CURRENCY"
echo "  • Buyer: $BUYER_NAME"
echo "  • Industry: $INDUSTRY"
echo "  • Risk Tier: $RISK_TIER"
echo "  • Issue Date: $ISSUE_DATE"
echo "  • Due Date: $DUE_DATE"
echo ""
print_info "Calculated Auction Parameters:"
echo "  • Total Supply: 100,000 tokens"
echo "  • Min Raise: ${MIN_RAISE_PERCENTAGE}% ($MIN_RAISE_USD USD)"
echo "  • Max Raise: ${MAX_RAISE_PERCENTAGE}% ($MAX_RAISE_USD USD)"
echo "  • Min Price/Token: \$${MIN_PRICE_USD} USD (reserve price)"
echo "  • Max Price/Token: \$${MAX_PRICE_USD} USD"
echo "  • Yield Margin: ~5% (includes platform fee 1.5%)"
echo "  • Min Investment: 1,000 USDC"
echo "  • Duration:  '$((AUCTION_DURATION / 60)) minutes'"
echo ""
print_info "Next Steps:"
echo "1. Wait for asset processing (hash computation, merkle tree)"
echo "2. Admin approves the asset"
echo "3. Asset gets registered on-chain"
echo "4. Token gets deployed"
echo "5. Auction listing is created on marketplace"
echo ""
print_info "To check asset status:"
echo "curl -X GET \"$API_BASE_URL/assets/$ASSET_ID\" \\"
echo "  --header \"Authorization: Bearer $ACCESS_TOKEN\" | jq"
echo ""
print_info "Save this Asset ID:"
echo "export ASSET_ID=\"$ASSET_ID\""
echo ""
