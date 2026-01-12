#!/bin/bash

# Comprehensive Marketplace Seeding Script
# Creates 10 static assets and 3 auction assets with realistic varied parameters
# Handles authentication and uploads with proper timing

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse flags
AUTO_YES=false
while getopts "y" opt; do
  case $opt in
    y) AUTO_YES=true ;;
    *) echo "Usage: $0 [-y]"; exit 1 ;;
  esac
done

# Validate environment variables
if [ -z "$ORIGINATOR_PRIVATE_KEY" ]; then
  echo -e "${RED}❌ Error: ORIGINATOR_PRIVATE_KEY environment variable not set${NC}"
  echo "Usage: ORIGINATOR_PRIVATE_KEY=0x... ADMIN_KEY=0x... ./seed-marketplace.sh [-y]"
  exit 1
fi

if [ -z "$ADMIN_KEY" ]; then
  echo -e "${RED}❌ Error: ADMIN_KEY environment variable not set${NC}"
  echo "Usage: ORIGINATOR_PRIVATE_KEY=0x... ADMIN_KEY=0x... ./seed-marketplace.sh [-y]"
  exit 1
fi

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "============================================================"
echo "🌱 Seeding Marketplace with Mock Data"
echo "============================================================"
echo ""
echo "This will create:"
echo "  • 10 Static listing assets (various industries & ranges)"
echo "  • 3 Auction assets (1 hour, 1 day, 3 days)"
echo ""
echo "Process:"
echo "  1. Authenticate as originator"
echo "  2. Upload 10 static assets with varied parameters"
echo "  3. Upload 3 auction assets with different durations"
echo "  4. Wait for DB commits (2s delays)"
echo "  5. Admin approves and deploys contracts (8s delays)"
echo "  6. Admin approves marketplace for tokens"
echo ""
echo "⏱️  Total estimated time: ~5-7 minutes"
echo ""

if [ "$AUTO_YES" = false ]; then
  read -p "Continue? (y/n) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      exit 0
  fi
fi

# Get wallet address from private key
ORIGINATOR_ADDRESS=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$ORIGINATOR_PRIVATE_KEY');
console.log(wallet.address);
")

echo "Originator Address: $ORIGINATOR_ADDRESS"
echo ""

# Arrays to store asset IDs
declare -a STATIC_ASSET_IDS
declare -a AUCTION_ASSET_IDS

# Helper function to create mock PDF
create_mock_pdf() {
  local filename=$1
  local content=$2
  echo "$content" > "$TEMP_DIR/$filename"
}

# Helper function to authenticate and get access token
get_access_token() {
  # Get challenge
  local challenge_response=$(curl -s "$API_URL/auth/challenge?walletAddress=$ORIGINATOR_ADDRESS&role=ORIGINATOR")
  local message=$(echo "$challenge_response" | jq -r '.message')
  local nonce=$(echo "$challenge_response" | jq -r '.nonce')

  if [ -z "$message" ] || [ "$message" == "null" ]; then
    echo -e "${RED}Failed to get challenge${NC}" >&2
    return 1
  fi

  # Sign message
  local signature=$(node -e "
const { ethers } = require('ethers');
(async () => {
  const wallet = new ethers.Wallet('$ORIGINATOR_PRIVATE_KEY');
  const signature = await wallet.signMessage(\`$message\`);
  console.log(signature);
})();
" 2>/dev/null)

  if [ -z "$signature" ]; then
    echo -e "${RED}Failed to sign message${NC}" >&2
    return 1
  fi

  # Login
  local login_payload=$(jq -n \
    --arg wallet "$ORIGINATOR_ADDRESS" \
    --arg msg "$message" \
    --arg sig "$signature" \
    '{walletAddress: $wallet, message: $msg, signature: $sig}')

  local login_response=$(curl -s -X POST "$API_URL/auth/login" \
    -H 'Content-Type: application/json' \
    -d "$login_payload")

  local access_token=$(echo "$login_response" | jq -r '.tokens.access')

  if [ -z "$access_token" ] || [ "$access_token" == "null" ]; then
    echo -e "${RED}Login failed${NC}" >&2
    return 1
  fi

  echo "$access_token"
}

# Helper function to upload static asset
upload_static_asset() {
  local invoice_num=$1
  local face_value=$2
  local buyer_name=$3
  local industry=$4
  local risk_tier=$5
  local min_raise_pct=$6
  local issue_date=$7
  local due_date=$8
  local access_token=$9

  # Create mock PDF
  local pdf_name="${invoice_num}.pdf"
  create_mock_pdf "$pdf_name" "Mock Invoice ${invoice_num} - ${buyer_name}"

  echo "  Uploading: ${buyer_name} (${industry}, Risk: ${risk_tier})"
  echo "    Face Value: \$${face_value}, Min Raise: ${min_raise_pct}%"

  # Upload
  local upload_response=$(curl -s -X POST "$API_URL/assets/upload" \
    -H "Authorization: Bearer $access_token" \
    -F "file=@$TEMP_DIR/$pdf_name" \
    -F "invoiceNumber=$invoice_num" \
    -F "faceValue=$face_value" \
    -F "currency=USD" \
    -F "issueDate=$issue_date" \
    -F "dueDate=$due_date" \
    -F "buyerName=$buyer_name" \
    -F "industry=$industry" \
    -F "riskTier=$risk_tier" \
    -F "assetType=STATIC" \
    -F "totalSupply=100000000000000000000" \
    -F "minInvestment=10000000000000000000" \
    -F "minRaisePercentage=$min_raise_pct" \
    -F "maxRaisePercentage=95")

  local asset_id=$(echo "$upload_response" | jq -r '.assetId')

  if [ -z "$asset_id" ] || [ "$asset_id" == "null" ]; then
    echo -e "${RED}    ✗ Upload failed${NC}"
    echo "$upload_response" | jq '.'
    return 1
  fi

  echo -e "${GREEN}    ✓ Asset ID: $asset_id${NC}"
  STATIC_ASSET_IDS+=("$asset_id")

  # Wait for DB commit
  sleep 2
}

# Helper function to upload auction asset
upload_auction_asset() {
  local invoice_num=$1
  local face_value=$2
  local buyer_name=$3
  local industry=$4
  local risk_tier=$5
  local min_raise_pct=$6
  local duration=$7
  local issue_date=$8
  local due_date=$9
  local access_token=${10}

  # Create mock PDF
  local pdf_name="${invoice_num}.pdf"
  create_mock_pdf "$pdf_name" "Mock Auction ${invoice_num} - ${buyer_name}"

  echo "  Uploading: ${buyer_name} (${industry}, Duration: ${duration}s)"
  echo "    Face Value: \$${face_value}, Min Raise: ${min_raise_pct}%"

  # Upload
  local upload_response=$(curl -s -X POST "$API_URL/assets/upload" \
    -H "Authorization: Bearer $access_token" \
    -F "file=@$TEMP_DIR/$pdf_name" \
    -F "invoiceNumber=$invoice_num" \
    -F "faceValue=$face_value" \
    -F "currency=USD" \
    -F "issueDate=$issue_date" \
    -F "dueDate=$due_date" \
    -F "buyerName=$buyer_name" \
    -F "industry=$industry" \
    -F "riskTier=$risk_tier" \
    -F "assetType=AUCTION" \
    -F "totalSupply=100000000000000000000" \
    -F "minInvestment=10000000000000000000" \
    -F "minRaisePercentage=$min_raise_pct" \
    -F "maxRaisePercentage=95" \
    -F "auctionDuration=$duration")

  local asset_id=$(echo "$upload_response" | jq -r '.assetId')

  if [ -z "$asset_id" ] || [ "$asset_id" == "null" ]; then
    echo -e "${RED}    ✗ Upload failed${NC}"
    echo "$upload_response" | jq '.'
    return 1
  fi

  echo -e "${GREEN}    ✓ Asset ID: $asset_id${NC}"
  AUCTION_ASSET_IDS+=("$asset_id")

  # Wait for DB commit
  sleep 2
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Authenticating Originator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ACCESS_TOKEN=$(get_access_token)

if [ -z "$ACCESS_TOKEN" ]; then
  echo -e "${RED}❌ Failed to authenticate${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Authentication successful${NC}"
echo ""

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 PHASE 1: Upload Static Assets (10 assets)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Format: invoice_num, face_value, buyer_name, industry, risk_tier, min_raise_%, issue_date, due_date, token

echo "[1/10]"
upload_static_asset "INV-TECH-001" "50000" "Tech Corp International" "Technology" "A" "75" "2025-01-01" "2025-04-01" "$ACCESS_TOKEN"

echo "[2/10]"
upload_static_asset "INV-HLTH-002" "120000" "MediCare Systems LLC" "Healthcare" "A" "80" "2025-01-05" "2025-05-05" "$ACCESS_TOKEN"

echo "[3/10]"
upload_static_asset "INV-ECOM-003" "35000" "ShopFast E-commerce" "E-commerce" "B" "70" "2025-01-10" "2025-03-10" "$ACCESS_TOKEN"

echo "[4/10]"
upload_static_asset "INV-MFG-004" "200000" "Industrial Manufacturing Co" "Manufacturing" "A" "85" "2025-01-15" "2025-06-15" "$ACCESS_TOKEN"

echo "[5/10]"
upload_static_asset "INV-LOG-005" "75000" "Global Freight Services" "Logistics" "B" "72" "2025-01-20" "2025-04-20" "$ACCESS_TOKEN"

echo "[6/10]"
upload_static_asset "INV-TEL-006" "90000" "TelcoNet Communications" "Telecommunications" "A" "78" "2025-02-01" "2025-05-01" "$ACCESS_TOKEN"

echo "[7/10]"
upload_static_asset "INV-ENRG-007" "150000" "GreenPower Solutions Inc" "Energy" "A" "82" "2025-02-05" "2025-07-05" "$ACCESS_TOKEN"

echo "[8/10]"
upload_static_asset "INV-RTL-008" "60000" "Retail Partners Group" "Retail" "B" "73" "2025-02-10" "2025-04-10" "$ACCESS_TOKEN"

echo "[9/10]"
upload_static_asset "INV-SAAS-009" "45000" "CloudSoft Technologies" "SaaS" "A" "76" "2025-02-15" "2025-04-15" "$ACCESS_TOKEN"

echo "[10/10]"
upload_static_asset "INV-CNST-010" "250000" "BuildRight Construction" "Construction" "B" "80" "2025-03-01" "2025-08-01" "$ACCESS_TOKEN"

echo ""
echo -e "${GREEN}✅ All 10 static assets uploaded!${NC}"
echo ""

sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎯 PHASE 2: Upload Auction Assets (3 auctions)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

echo "[1/3] 1-Hour Quick Auction"
upload_auction_asset "AUC-RE-001" "300000" "Premium Office REIT" "Real Estate" "A" "78" "3600" "2025-01-20" "2026-01-20" "$ACCESS_TOKEN"

echo "[2/3] 1-Day Standard Auction"
upload_auction_asset "AUC-EQ-002" "175000" "Industrial Equipment Fund" "Equipment" "B" "75" "86400" "2025-01-25" "2026-01-25" "$ACCESS_TOKEN"

echo "[3/3] 3-Day Extended Auction"
upload_auction_asset "AUC-LUX-003" "500000" "Luxury Retail Property" "Real Estate" "A" "82" "259200" "2025-02-01" "2026-02-01" "$ACCESS_TOKEN"

echo ""
echo -e "${GREEN}✅ All 3 auction assets uploaded!${NC}"
echo ""

sleep 3

# Get admin token
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 Authenticating Admin"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

ADMIN_TOKEN=$(ADMIN_KEY=$ADMIN_KEY API_URL=$API_URL node "$SCRIPT_DIR/get-admin-token.js" 2>/dev/null)

if [ -z "$ADMIN_TOKEN" ] || [ "$ADMIN_TOKEN" = "null" ]; then
  echo -e "${RED}❌ Failed to get admin token${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Admin authenticated${NC}"
echo ""

export ADMIN_TOKEN

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔨 PHASE 3: Admin Approves & Deploys Static Assets"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏱️  Using 8-second delays between blockchain transactions"
echo ""

counter=1
for asset_id in "${STATIC_ASSET_IDS[@]}"; do
  echo "[$counter/10] Deploying: $asset_id"

  if ADMIN_KEY=$ADMIN_KEY ASSET_ID=$asset_id API_URL=$API_URL bash "$SCRIPT_DIR/deploy-asset.sh" 2>&1 | grep -q "success\|deployed"; then
    echo -e "${GREEN}  ✓ Deployed${NC}"
  else
    echo -e "${YELLOW}  ⚠ Check manually${NC}"
  fi

  if [ $counter -lt 10 ]; then
    sleep 8
  fi

  counter=$((counter + 1))
done

echo ""
echo -e "${GREEN}✅ Static assets deployment complete!${NC}"
echo ""

sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎪 PHASE 4: Admin Approves & Schedules Auctions"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏱️  Using 10-second delays between blockchain transactions"
echo ""

counter=1
durations=(3600 86400 259200)
duration_labels=("1 hour" "1 day" "3 days")

for asset_id in "${AUCTION_ASSET_IDS[@]}"; do
  duration=${durations[$((counter-1))]}
  duration_label=${duration_labels[$((counter-1))]}

  echo "[$counter/3] Deploying auction: $asset_id ($duration_label)"

  if ADMIN_KEY=$ADMIN_KEY ASSET_ID=$asset_id DURATION=$duration API_URL=$API_URL \
     bash "$SCRIPT_DIR/admin-approve-and-schedule.sh" 2>&1 | grep -q "success\|scheduled"; then
    echo -e "${GREEN}  ✓ Deployed and scheduled${NC}"
  else
    echo -e "${YELLOW}  ⚠ Check manually${NC}"
  fi

  if [ $counter -lt 3 ]; then
    sleep 10
  fi

  counter=$((counter + 1))
done

echo ""
echo -e "${GREEN}✅ Auction deployment complete!${NC}"
echo ""

sleep 3

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ PHASE 5: Approve Marketplace for All Tokens"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Fetch and approve tokens
for asset_id in "${STATIC_ASSET_IDS[@]}" "${AUCTION_ASSET_IDS[@]}"; do
  asset_json=$(curl -s "$API_URL/api/assets/$asset_id")
  token_address=$(echo "$asset_json" | jq -r '.token.address // empty')

  if [ ! -z "$token_address" ] && [ "$token_address" != "null" ]; then
    echo "Approving token: $token_address (Asset: $asset_id)"

    if ADMIN_KEY=$ADMIN_KEY node "$SCRIPT_DIR/approve-marketplace.js" "$token_address" 2>&1 | grep -q "success\|approved"; then
      echo -e "${GREEN}  ✓ Approved${NC}"
    else
      echo -e "${YELLOW}  ⚠ Already approved or check manually${NC}"
    fi

    sleep 5
  fi
done

echo ""
echo -e "${GREEN}✅ All tokens approved!${NC}"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Marketplace Seeding Complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Summary:"
echo "  ✓ 10 Static listings: varied industries, face values \$35k-\$250k"
echo "  ✓ 3 Auctions: 1 hour, 1 day, 3 days durations"
echo "  ✓ All tokens deployed and approved for trading"
echo ""
echo "📊 View at: ${API_URL}/api/assets"
echo "💰 Marketplace is ready!"
echo ""
