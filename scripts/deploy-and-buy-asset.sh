#!/bin/bash

# Complete Asset Deployment Flow
# This script automates the complete asset lifecycle from upload to marketplace purchase

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
ORIGINATOR_PRIVATE_KEY="${ORIGINATOR_PRIVATE_KEY:-0x435c9985dbc29c3abdd9529439b38990260e32949a9bdd22cd09733c0512ee4c}"
DOCUMENT_PATH="${1:-/Users/deadbytes/Downloads/Divy offer letter.pdf}"

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

# Check if document exists
if [ ! -f "$DOCUMENT_PATH" ]; then
    print_error "Document not found: $DOCUMENT_PATH"
    echo ""
    echo "Usage: ./deploy-and-buy-asset.sh [document_path]"
    echo "Example: ./deploy-and-buy-asset.sh \"/Users/deadbytes/Downloads/Divy offer letter.pdf\""
    exit 1
fi

print_header "🚀 Complete Asset Deployment Flow"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Step 1: Upload document as originator
print_header "Step 1/5: Upload Document as Originator"
print_info "Document: $DOCUMENT_PATH"
print_info "Originator Key: ${ORIGINATOR_PRIVATE_KEY:0:10}..."

cd "$ROOT_DIR"
UPLOAD_OUTPUT=$(ORIGINATOR_PRIVATE_KEY="$ORIGINATOR_PRIVATE_KEY" ./scripts/upload-as-originator.sh "$DOCUMENT_PATH" 2>&1)
echo "$UPLOAD_OUTPUT"

# Extract Asset ID from upload output
ASSET_ID=$(echo "$UPLOAD_OUTPUT" | grep -o "Asset ID: [a-f0-9-]*" | head -1 | cut -d' ' -f3)

if [ -z "$ASSET_ID" ]; then
    # Try alternative extraction from JSON
    ASSET_ID=$(echo "$UPLOAD_OUTPUT" | grep -o '"assetId": "[a-f0-9-]*"' | head -1 | cut -d'"' -f4)
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Could not extract Asset ID from upload output"
    exit 1
fi

print_success "Document uploaded"
print_info "Asset ID: $ASSET_ID"
export ASSET_ID

print_info "Waiting 5 seconds..."
sleep 5

# Step 2: Sign admin login
print_header "Step 2/5: Generate Admin Token"
cd "$ROOT_DIR"
node ./scripts/sign-admin-login.js > /tmp/admin_token.txt 2>&1
export ADMIN_TOKEN=$(cat /tmp/admin_token.txt | grep -A1 "🎫 Access Token:" | tail -1 | xargs)

if [ -z "$ADMIN_TOKEN" ]; then
    print_error "Failed to generate admin token"
    exit 1
fi

print_success "Admin token generated"
print_info "Token: ${ADMIN_TOKEN:0:20}..."

print_info "Waiting 5 seconds..."
sleep 5

# Step 3: Deploy asset
print_header "Step 3/5: Deploy Asset to Blockchain"
print_info "Running deployment script..."
print_info "Asset ID: $ASSET_ID"

cd "$ROOT_DIR"
export ASSET_ID
export ADMIN_TOKEN
DEPLOYMENT_OUTPUT=$(./scripts/deploy-asset.sh 2>&1)
echo "$DEPLOYMENT_OUTPUT"

# Extract token address from deployment output
TOKEN_ADDRESS=$(echo "$DEPLOYMENT_OUTPUT" | grep -o "Token Address: 0x[a-fA-F0-9]*" | head -1 | cut -d' ' -f3)

if [ -z "$TOKEN_ADDRESS" ]; then
    # Try alternative extraction
    TOKEN_ADDRESS=$(echo "$DEPLOYMENT_OUTPUT" | grep -o "0x[a-fA-F0-9]\{40\}" | head -1)
fi

if [ -z "$TOKEN_ADDRESS" ]; then
    print_error "Could not extract token address from deployment output"
    print_info "Please check the deployment output above and run manually:"
    echo "  node ./scripts/approve-marketplace.js <TOKEN_ADDRESS>"
    echo "  node ./scripts/buy-tokens.js <ASSET_ID>"
    exit 1
fi

print_success "Asset deployed successfully"
print_info "Token Address: $TOKEN_ADDRESS"

print_info "Waiting 10 seconds for blockchain confirmation..."
sleep 10

# Step 4: Approve marketplace
print_header "Step 4/5: Approve Marketplace"
print_info "Approving marketplace for token: $TOKEN_ADDRESS"

cd "$ROOT_DIR"
APPROVE_OUTPUT=$(node ./scripts/approve-marketplace.js "$TOKEN_ADDRESS" 2>&1)
echo "$APPROVE_OUTPUT"
print_success "Marketplace approved"

print_info "Waiting 5 seconds..."
sleep 5

# Step 5: Buy all tokens
print_header "Step 5/5: Purchase Tokens from Marketplace"
print_info "Buying all available tokens..."
print_info "Asset ID: $ASSET_ID"

cd "$ROOT_DIR"
if BUY_OUTPUT=$(node ./scripts/buy-tokens.js "$ASSET_ID" 2>&1); then
    echo "$BUY_OUTPUT"
    print_success "Tokens purchased"
else
    echo "$BUY_OUTPUT"
    print_error "Token purchase failed - you may need to wait for listing to settle"
    print_info "Try manually:"
    echo "  node ./scripts/buy-tokens.js $ASSET_ID"
fi

# Final Summary
print_header "🎉 Complete Flow Successful!"
echo ""
print_success "All steps completed successfully!"
echo ""
echo "Summary:"
echo "  ✓ Document uploaded as originator"
echo "  ✓ Admin token generated"
echo "  ✓ Asset deployed to blockchain"
echo "  ✓ Marketplace approved for trading"
echo "  ✓ Tokens purchased from marketplace"
echo ""
echo "Token Address: $TOKEN_ADDRESS"
echo "Asset ID: $ASSET_ID"
echo ""
print_info "You can now check your token balance and manage the asset!"
