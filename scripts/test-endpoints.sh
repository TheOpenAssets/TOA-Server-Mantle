#!/bin/bash

# Test script for the fixed endpoints
# Run this after starting the backend server

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Fixed Endpoints${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check environment variables
if [ -z "$ADMIN_TOKEN" ]; then
    echo -e "${RED}Error: ADMIN_TOKEN not set${NC}"
    echo "Run: export ADMIN_TOKEN=your_token"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    echo -e "${RED}Error: ASSET_ID not set${NC}"
    echo "Run: export ASSET_ID=your_asset_id"
    exit 1
fi

echo -e "${GREEN}✓ Environment variables set${NC}"
echo "  ADMIN_TOKEN: ${ADMIN_TOKEN:0:20}..."
echo "  ASSET_ID: $ASSET_ID"
echo ""

# Test 1: Register Asset (if not already registered)
echo -e "${BLUE}Test 1: Testing Register Asset Endpoint${NC}"
echo "Endpoint: POST /admin/assets/:assetId/register"
echo ""

REGISTER_RESPONSE=$(curl -s -X POST "http://localhost:3000/admin/assets/$ASSET_ID/register" \
  --header "Authorization: Bearer $ADMIN_TOKEN")

echo "Response:"
echo "$REGISTER_RESPONSE" | jq '.' 2>/dev/null || echo "$REGISTER_RESPONSE"
echo ""

# Check if response is valid JSON
if echo "$REGISTER_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Register endpoint returning proper JSON response${NC}"
else
    echo -e "${RED}✗ Register endpoint not returning valid JSON${NC}"
fi
echo ""

# Test 2: Deploy Token
echo -e "${BLUE}Test 2: Testing Deploy Token Endpoint${NC}"
echo "Endpoint: POST /admin/assets/deploy-token"
echo ""

DEPLOY_RESPONSE=$(curl -s -X POST "http://localhost:3000/admin/assets/deploy-token" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data "{
    \"assetId\": \"$ASSET_ID\",
    \"name\": \"Tech Invoice RWA Token\",
    \"symbol\": \"TINV\"
  }")

echo "Response:"
echo "$DEPLOY_RESPONSE" | jq '.' 2>/dev/null || echo "$DEPLOY_RESPONSE"
echo ""

# Check if response is valid JSON
if echo "$DEPLOY_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Deploy token endpoint returning proper JSON response${NC}"
    
    # Extract transaction hash
    TX_HASH=$(echo "$DEPLOY_RESPONSE" | jq -r '.transactionHash')
    EXPLORER_URL=$(echo "$DEPLOY_RESPONSE" | jq -r '.explorerUrl')
    
    echo ""
    echo -e "${GREEN}Transaction Hash: $TX_HASH${NC}"
    echo -e "${GREEN}Explorer URL: $EXPLORER_URL${NC}"
else
    echo -e "${RED}✗ Deploy token endpoint not returning valid JSON${NC}"
fi
echo ""

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Complete${NC}"
echo -e "${BLUE}========================================${NC}"
