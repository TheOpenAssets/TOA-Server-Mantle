#!/bin/bash

# Asset Deployment Automation Script
# This script automates the complete asset lifecycle from approval to token deployment

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_TOKEN}"
ADMIN_WALLET="${ADMIN_WALLET:-0x23e67597f0898f747Fa3291C8920168adF9455D0}"
ASSET_ID="${1:-$ASSET_ID}"

# Function to print section headers
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
if [ -z "$ADMIN_TOKEN" ]; then
    print_error "ADMIN_TOKEN not set!"
    echo "Usage: ./deploy-asset.sh <asset-id>"
    echo "   or: export ADMIN_TOKEN=your_token && ./deploy-asset.sh <asset-id>"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "ASSET_ID not provided!"
    echo "Usage: ./deploy-asset.sh <asset-id>"
    echo "   or: export ASSET_ID=your_asset_id && ./deploy-asset.sh"
    exit 1
fi

print_header "Asset Deployment Pipeline"
print_info "API Base URL: $API_BASE_URL"
print_info "Asset ID: $ASSET_ID"
print_info "Admin Wallet: $ADMIN_WALLET"
echo ""

# Step 1: Approve Asset
print_header "Step 1: Approve Asset"
print_info "Submitting approval request..."

APPROVE_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/compliance/approve" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "{
    \"assetId\": \"$ASSET_ID\",
    \"adminWallet\": \"$ADMIN_WALLET\"
  }")

echo "Response:"
echo "$APPROVE_RESPONSE" | jq '.' 2>/dev/null || echo "$APPROVE_RESPONSE"
echo ""

# Check if approval succeeded
if echo "$APPROVE_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    STATUS=$(echo "$APPROVE_RESPONSE" | jq -r '.status')
    print_success "Asset approved! Status: $STATUS"
else
    print_error "Asset approval failed!"
    exit 1
fi

# Wait a moment for processing
sleep 2

# Step 2: Register Asset On-Chain
print_header "Step 2: Register Asset On-Chain"
print_info "Registering asset with attestation..."

REGISTER_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/assets/$ASSET_ID/register" \
  --header "Authorization: Bearer $ADMIN_TOKEN")

echo "Response:"
echo "$REGISTER_RESPONSE" | jq '.' 2>/dev/null || echo "$REGISTER_RESPONSE"
echo ""

# Check if registration succeeded
if echo "$REGISTER_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    TX_HASH=$(echo "$REGISTER_RESPONSE" | jq -r '.transactionHash')
    EXPLORER_URL=$(echo "$REGISTER_RESPONSE" | jq -r '.explorerUrl')
    print_success "Asset registered on-chain!"
    print_info "Transaction Hash: $TX_HASH"
    print_info "Explorer: $EXPLORER_URL"
else
    ERROR=$(echo "$REGISTER_RESPONSE" | jq -r '.error // .message // "Unknown error"')
    if [[ "$ERROR" == *"already registered"* ]]; then
        print_info "Asset was already registered, continuing..."
    else
        print_error "Asset registration failed: $ERROR"
        exit 1
    fi
fi

# Wait for transaction to be mined
print_info "Waiting 10 seconds for transaction confirmation..."
sleep 10

# Step 3: Update Status to REGISTERED (Manual Sync)
print_header "Step 3: Sync Registration Status"
print_info "Updating asset status in database..."

if [ ! -z "$TX_HASH" ]; then
    SYNC_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/sync/update-status" \
      --header "Authorization: Bearer $ADMIN_TOKEN" \
      --header 'Content-Type: application/json' \
      --data "{
        \"assetId\": \"$ASSET_ID\",
        \"txHash\": \"$TX_HASH\",
        \"status\": \"REGISTERED\"
      }")
    
    echo "Response:"
    echo "$SYNC_RESPONSE" | jq '.' 2>/dev/null || echo "$SYNC_RESPONSE"
    echo ""
    
    if echo "$SYNC_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        print_success "Status updated to REGISTERED"
    else
        print_info "Status sync skipped or failed (may already be updated)"
    fi
fi

# Step 4: Deploy Token
print_header "Step 4: Deploy RWA Token"
print_info "Deploying ERC-20 token contract..."

# Get token name and symbol (can be customized)
TOKEN_NAME="${TOKEN_NAME:-Tech Invoice RWA Token}"
TOKEN_SYMBOL="${TOKEN_SYMBOL:-TINV}"

print_info "Token Name: $TOKEN_NAME"
print_info "Token Symbol: $TOKEN_SYMBOL"
echo ""

DEPLOY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/assets/deploy-token" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "{
    \"assetId\": \"$ASSET_ID\",
    \"name\": \"$TOKEN_NAME\",
    \"symbol\": \"$TOKEN_SYMBOL\"
  }")

echo "Response:"
echo "$DEPLOY_RESPONSE" | jq '.' 2>/dev/null || echo "$DEPLOY_RESPONSE"
echo ""

# Check if deployment succeeded
if echo "$DEPLOY_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    DEPLOY_TX_HASH=$(echo "$DEPLOY_RESPONSE" | jq -r '.transactionHash')
    DEPLOY_EXPLORER=$(echo "$DEPLOY_RESPONSE" | jq -r '.explorerUrl')
    print_success "Token deployment submitted!"
    print_info "Transaction Hash: $DEPLOY_TX_HASH"
    print_info "Explorer: $DEPLOY_EXPLORER"
    print_info "Note: Token address will be available in the transaction logs"
    echo ""
    print_info "View transaction to get token address:"
    echo "   $DEPLOY_EXPLORER"
else
    ERROR=$(echo "$DEPLOY_RESPONSE" | jq -r '.error // .message // "Unknown error"')
    if [[ "$ERROR" == *"already deployed"* ]] || [[ "$ERROR" == *"already tokenized"* ]]; then
        print_info "Token was already deployed for this asset"
    else
        print_error "Token deployment failed: $ERROR"
        exit 1
    fi
fi

# Wait for transaction to be mined
print_info "Waiting 15 seconds for transaction confirmation..."
sleep 15

# Step 5: Get Token Address from Explorer
print_header "Step 5: Get Token Address"
print_info "Please check the transaction on the explorer to get the token address:"
echo "   $DEPLOY_EXPLORER"
echo ""
print_info "Look for the 'TokenSuiteDeployed' event in the logs"
echo ""
echo -n "Enter the Token Address (or press Enter to skip): "
read TOKEN_ADDRESS

if [ ! -z "$TOKEN_ADDRESS" ]; then
    print_success "Token Address: $TOKEN_ADDRESS"
    
    # Step 6: Update Status to TOKENIZED
    print_header "Step 6: Sync Tokenization Status"
    print_info "Updating asset status to TOKENIZED..."
    
    SYNC_TOKENIZED_RESPONSE=$(curl -s -X POST "$API_BASE_URL/admin/sync/update-status" \
      --header "Authorization: Bearer $ADMIN_TOKEN" \
      --header 'Content-Type: application/json' \
      --data "{
        \"assetId\": \"$ASSET_ID\",
        \"txHash\": \"$DEPLOY_TX_HASH\",
        \"status\": \"TOKENIZED\",
        \"tokenAddress\": \"$TOKEN_ADDRESS\"
      }")
    
    echo "Response:"
    echo "$SYNC_TOKENIZED_RESPONSE" | jq '.' 2>/dev/null || echo "$SYNC_TOKENIZED_RESPONSE"
    echo ""
    
    if echo "$SYNC_TOKENIZED_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        print_success "Status updated to TOKENIZED"
    else
        print_info "Status sync failed (may need manual update)"
    fi
else
    print_info "Token address skipped. You can update it manually later."
    echo ""
    print_info "To update status manually, use:"
    echo ""
    echo "curl -X POST \"$API_BASE_URL/admin/sync/update-status\" \\"
    echo "  --header \"Authorization: Bearer \$ADMIN_TOKEN\" \\"
    echo "  --header 'Content-Type: application/json' \\"
    echo "  --data '{"
    echo "    \"assetId\": \"$ASSET_ID\","
    echo "    \"txHash\": \"$DEPLOY_TX_HASH\","
    echo "    \"status\": \"TOKENIZED\","
    echo "    \"tokenAddress\": \"YOUR_TOKEN_ADDRESS\""
    echo "  }'"
    echo ""
fi

# Final Summary
print_header "Deployment Summary"
print_success "Asset lifecycle completed!"
echo ""
echo "Asset ID: $ASSET_ID"
if [ ! -z "$TOKEN_ADDRESS" ]; then
    echo "Token Address: $TOKEN_ADDRESS"
    echo "Status: TOKENIZED ✓"
    echo ""
    echo "Next Step: List on Marketplace"
    echo ""
    echo "Run this command to list the asset:"
    echo ""
    echo "curl -X POST \"$API_BASE_URL/admin/assets/list-on-marketplace\" \\"
    echo "  --header \"Authorization: Bearer \$ADMIN_TOKEN\" \\"
    echo "  --header 'Content-Type: application/json' \\"
    echo "  --data '{"
    echo "    \"assetId\": \"$ASSET_ID\","
    echo "    \"type\": \"STATIC\","
    echo "    \"price\": \"1000000\","
    echo "    \"minInvestment\": \"1000000\""
    echo "  }' | jq"
else
    echo "Status: REGISTERED (token deployed, needs manual sync)"
    echo ""
    echo "Next Steps:"
    echo "1. Get token address from: $DEPLOY_EXPLORER"
    echo "2. Update status to TOKENIZED (see command above)"
    echo "3. List on marketplace"
fi
echo ""

print_header "Deployment Complete! 🎉"
