#!/bin/bash

# Upload a single static asset to the marketplace
# Usage: ./upload-static-asset.sh <name> <symbol> <totalSupply> <pricePerToken> <category> <description>

if [ -z "$ORIGINATOR_PRIVATE_KEY" ]; then
  echo "❌ Error: ORIGINATOR_PRIVATE_KEY environment variable not set"
  exit 1
fi

NAME=${1:-"Tech Invoice"}
SYMBOL=${2:-"TINV"}
TOTAL_SUPPLY=${3:-1000}
PRICE_PER_TOKEN=${4:-0.85}
CATEGORY=${5:-"Invoice"}
DESCRIPTION=${6:-"High-quality tech sector invoice financing"}

echo "============================================================"
echo "Upload Static Asset to Marketplace"
echo "============================================================"
echo ""
echo "Asset Details:"
echo "  Name: $NAME"
echo "  Symbol: $SYMBOL"
echo "  Total Supply: $TOTAL_SUPPLY tokens"
echo "  Price per Token: \$$PRICE_PER_TOKEN"
echo "  Category: $CATEGORY"
echo ""

# Step 1: Upload asset metadata to backend
echo "📤 Step 1: Uploading asset metadata to backend..."

ASSET_ID=$(uuidgen | tr '[:upper:]' '[:lower:]')

curl -X POST http://localhost:3000/api/assets \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$ASSET_ID\",
    \"name\": \"$NAME\",
    \"symbol\": \"$SYMBOL\",
    \"description\": \"$DESCRIPTION\",
    \"category\": \"$CATEGORY\",
    \"totalSupply\": $TOTAL_SUPPLY,
    \"pricePerToken\": $PRICE_PER_TOKEN,
    \"originator\": \"0xCFCC97f7Ed394CB0a454345465996CC9f12F0e25\",
    \"listingType\": \"STATIC\"
  }"

echo ""
echo ""

# Step 2: Deploy token contract
echo "📝 Step 2: Deploying RWA token..."
cd packages/contracts
ASSET_ID=$ASSET_ID npx hardhat run scripts/deploy/deploy_token.ts --network mantleTestnet

# Step 3: Create marketplace listing
echo ""
echo "📊 Step 3: Creating marketplace listing..."
cd ../..
node scripts/create-static-listing.js $ASSET_ID

echo ""
echo "✅ Static asset uploaded successfully!"
echo "   Asset ID: $ASSET_ID"
echo ""
