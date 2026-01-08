#!/bin/bash

# Investor Place Bid Script - All-in-One
# This script automates the complete investor bidding flow in a single script:
# 1. Checks KYC registration (registers if needed)
# 2. Authenticates investor
# 3. Places bid on-chain
# 4. Notifies backend
# 5. Verifies bid recorded

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
RPC_URL="${RPC_URL:-https://rpc.sepolia.mantle.xyz}"
INVESTOR_PRIVATE_KEY="${INVESTOR_PRIVATE_KEY}"

# Check required parameters
if [ -z "$1" ] || [ -z "$2" ] || [ -z "$3" ]; then
  echo -e "${RED}Usage: INVESTOR_PRIVATE_KEY=0x... $0 <asset-id> <token-amount> <price-per-token>${NC}"
  echo ""
  echo "Parameters:"
  echo "  asset-id:         UUID of the auction"
  echo "  token-amount:     Number of tokens to bid for (e.g., 1000)"
  echo "  price-per-token:  Price per token in USDC (e.g., 0.95)"
  echo ""
  echo "Example:"
  echo "  INVESTOR_PRIVATE_KEY=0x... $0 550e8400-e29b-41d4-a716-446655440000 1000 0.95"
  exit 1
fi

if [ -z "$INVESTOR_PRIVATE_KEY" ]; then
  echo -e "${RED}Error: INVESTOR_PRIVATE_KEY environment variable not set${NC}"
  exit 1
fi

ASSET_ID="$1"
TOKEN_AMOUNT="$2"
PRICE_PER_TOKEN="$3"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🎯 INVESTOR PLACE BID${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Asset ID:         $ASSET_ID"
echo "Token Amount:     $TOKEN_AMOUNT"
echo "Price Per Token:  $PRICE_PER_TOKEN USDC"
echo ""

# Derive wallet address
echo -e "${YELLOW}📍 Deriving wallet address...${NC}"
INVESTOR_ADDRESS=$(node -e "
  const { ethers } = require('ethers');
  const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
  console.log(wallet.address);
")
echo -e "${GREEN}✓ Investor Wallet: $INVESTOR_ADDRESS${NC}"
echo ""

# Step 1: KYC Registration
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 1: KYC Registration Check${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Checking KYC status for $INVESTOR_ADDRESS...${NC}"

# Check and register KYC using Node.js inline
KYC_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function checkAndRegisterKYC() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const IDENTITY_REGISTRY_ABI = [
      'function registerIdentity(address wallet) external',
      'function isVerified(address wallet) view returns (bool)',
    ];

    const adminPrivateKey = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
    const provider = new ethers.JsonRpcProvider('$RPC_URL');
    const wallet = new ethers.Wallet(adminPrivateKey, provider);

    const identityRegistry = new ethers.Contract(
      deployedContracts.contracts.IdentityRegistry,
      IDENTITY_REGISTRY_ABI,
      wallet
    );

    const isVerified = await identityRegistry.isVerified('$INVESTOR_ADDRESS');

    if (isVerified) {
      console.log('ALREADY_VERIFIED');
    } else {
      console.log('REGISTERING');
      const tx = await identityRegistry.registerIdentity('$INVESTOR_ADDRESS');
      await tx.wait();
      console.log('REGISTERED:' + tx.hash);
    }
  } catch (error) {
    console.error('ERROR:' + error.message);
    process.exit(1);
  }
}

checkAndRegisterKYC();
" 2>&1)

if echo "$KYC_RESULT" | grep -q "ALREADY_VERIFIED"; then
  echo -e "${GREEN}✓ Investor is already KYC verified${NC}"
elif echo "$KYC_RESULT" | grep -q "REGISTERED:"; then
  TX_HASH=$(echo "$KYC_RESULT" | grep "REGISTERED:" | cut -d':' -f2)
  echo -e "${GREEN}✓ Identity registered!${NC}"
  echo -e "${GREEN}  TX: $TX_HASH${NC}"
  echo -e "${GREEN}  Explorer: https://sepolia.mantlescan.xyz/tx/$TX_HASH${NC}"
elif echo "$KYC_RESULT" | grep -q "ERROR:"; then
  ERROR_MSG=$(echo "$KYC_RESULT" | grep "ERROR:" | cut -d':' -f2-)
  echo -e "${RED}✗ KYC registration failed: $ERROR_MSG${NC}"
  exit 1
else
  echo -e "${RED}✗ Unexpected KYC result: $KYC_RESULT${NC}"
  exit 1
fi
echo ""

# Step 2: Authenticate Investor
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 2: Investor Authentication${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Authenticating investor...${NC}"

# Authenticate using Node.js inline
JWT_TOKEN=$(node -e "
const { ethers } = require('ethers');

async function authenticate() {
  try {
    // Step 1: Request challenge
    const challengeResponse = await fetch(
      '$API_BASE_URL/auth/challenge?walletAddress=$INVESTOR_ADDRESS&role=INVESTOR'
    );
    const challengeData = await challengeResponse.json();

    if (!challengeResponse.ok) {
      throw new Error('Failed to get challenge: ' + JSON.stringify(challengeData));
    }

    // Step 2: Sign the message
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
    const signature = await wallet.signMessage(challengeData.message);

    // Step 3: Login
    const loginResponse = await fetch('$API_BASE_URL/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: '$INVESTOR_ADDRESS',
        message: challengeData.message,
        signature: signature,
      }),
    });

    const loginData = await loginResponse.json();

    if (!loginResponse.ok) {
      throw new Error('Login failed: ' + JSON.stringify(loginData));
    }

    console.log(loginData.tokens.access);
  } catch (error) {
    console.error('AUTH_ERROR:' + error.message);
    process.exit(1);
  }
}

authenticate();
" 2>&1)

if echo "$JWT_TOKEN" | grep -q "AUTH_ERROR:"; then
  ERROR_MSG=$(echo "$JWT_TOKEN" | grep "AUTH_ERROR:" | cut -d':' -f2-)
  echo -e "${RED}✗ Authentication failed: $ERROR_MSG${NC}"
  exit 1
fi

echo -e "${GREEN}✓ Authentication successful${NC}"
echo -e "${GREEN}  Token: ${JWT_TOKEN:0:50}...${NC}"
echo ""

# Step 3: Place Bid On-Chain
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 3: Place Bid On-Chain${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Placing bid on blockchain...${NC}"

# Place bid using Node.js inline
set +e  # Don't exit on error
BID_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function placeBid() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const USDC_ABI = [
      'function approve(address spender, uint256 amount) returns (bool)',
      'function allowance(address owner, address spender) view returns (uint256)',
      'function balanceOf(address account) view returns (uint256)',
    ];

    const MARKETPLACE_ABI = [
      'function submitBid(bytes32 assetId, uint256 tokenAmount, uint256 price) external',
      'function listings(bytes32) view returns (address tokenAddress, bytes32 assetId, uint8 listingType, uint256 staticPrice, uint256 reservePrice, uint256 endTime, uint256 clearingPrice, uint8 auctionPhase, uint256 totalSupply, uint256 sold, bool active, uint256 minInvestment)',
    ];

    const provider = new ethers.JsonRpcProvider('$RPC_URL');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);

    const usdcAddress = deployedContracts.contracts.USDC;
    const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;

    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
    const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);

    // Convert inputs
    const assetIdBytes32 = '0x' + '$ASSET_ID'.replace(/-/g, '').padEnd(64, '0');
    const tokenAmountWei = ethers.parseUnits('$TOKEN_AMOUNT', 18);
    const priceWei = ethers.parseUnits('$PRICE_PER_TOKEN', 6);

    // Get listing info
    const listing = await marketplaceContract.listings(assetIdBytes32);
    const listingType = listing[2];      // ListingType
    const reservePrice = listing[4];     // Reserve price (minimum price for auction)
    const minInvestment = listing[11];   // Minimum investment

    console.error('Listing Type: ' + (listingType === 1n ? 'AUCTION' : 'FIXED_PRICE'));
    console.error('Reserve Price: ' + ethers.formatUnits(reservePrice, 6) + ' USDC (minimum)');
    console.error('Min Investment: ' + ethers.formatUnits(minInvestment, 18) + ' tokens');

    // Validate
    if (listingType !== 1n) {
      throw new Error('Asset is not an auction');
    }

    // For uniform price auctions, bids must be >= reserve price
    if (priceWei < reservePrice) {
      throw new Error('Price ' + '$PRICE_PER_TOKEN' + ' USDC is below reserve price ' + ethers.formatUnits(reservePrice, 6));
    }

    if (tokenAmountWei < minInvestment) {
      throw new Error('Token amount ' + '$TOKEN_AMOUNT' + ' is below minimum investment ' + ethers.formatUnits(minInvestment, 18));
    }

    // Calculate deposit
    const depositNeeded = (priceWei * tokenAmountWei) / ethers.parseUnits('1', 18);
    console.error('Deposit Required: ' + ethers.formatUnits(depositNeeded, 6) + ' USDC');

    // Check balance
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.error('USDC Balance: ' + ethers.formatUnits(usdcBalance, 6) + ' USDC');

    if (usdcBalance < depositNeeded) {
      throw new Error('Insufficient USDC balance. Required: ' + ethers.formatUnits(depositNeeded, 6) + ', Available: ' + ethers.formatUnits(usdcBalance, 6));
    }

    // Approve USDC
    const allowance = await usdcContract.allowance(wallet.address, marketplaceAddress);
    if (allowance < depositNeeded) {
      console.error('Approving USDC...');
      const approveTx = await usdcContract.approve(marketplaceAddress, depositNeeded);
      await approveTx.wait();
      console.error('USDC approved');
    } else {
      console.error('USDC already approved');
    }

    // Submit bid
    console.error('Submitting bid...');
    const bidTx = await marketplaceContract.submitBid(assetIdBytes32, tokenAmountWei, priceWei);
    console.error('Bid TX: ' + bidTx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await bidTx.wait();
    console.error('Confirmed in block ' + receipt.blockNumber);

    // Output result as JSON
    console.log(JSON.stringify({
      txHash: bidTx.hash,
      blockNumber: receipt.blockNumber.toString(),
      tokenAmountWei: tokenAmountWei.toString(),
      priceWei: priceWei.toString(),
    }));
  } catch (error) {
    console.error('BID_ERROR:' + error.message);
    process.exit(1);
  }
}

placeBid();
" 2>&1)
BID_EXIT_CODE=$?
set -e

# Show all output for debugging
echo "$BID_RESULT"
echo ""

# Check exit code
if [ $BID_EXIT_CODE -ne 0 ]; then
  echo -e "${RED}✗ Node.js script failed with exit code: $BID_EXIT_CODE${NC}"
  exit 1
fi

# Extract result or error
if echo "$BID_RESULT" | grep -q "BID_ERROR:"; then
  ERROR_MSG=$(echo "$BID_RESULT" | grep "BID_ERROR:" | cut -d':' -f2-)
  echo -e "${RED}✗ Bid placement failed: $ERROR_MSG${NC}"
  exit 1
fi

# Show stderr output (progress messages)
echo "$BID_RESULT" | grep -v "^{" | sed '/^$/d'
echo ""

# Parse JSON result (last line)
BID_JSON=$(echo "$BID_RESULT" | grep "^{")
TX_HASH=$(echo "$BID_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0)); console.log(data.txHash);")
BLOCK_NUMBER=$(echo "$BID_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0)); console.log(data.blockNumber);")
TOKEN_AMOUNT_WEI=$(echo "$BID_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0)); console.log(data.tokenAmountWei);")
PRICE_WEI=$(echo "$BID_JSON" | node -e "const data=JSON.parse(require('fs').readFileSync(0)); console.log(data.priceWei);")

echo -e "${GREEN}✓ Bid placed on-chain${NC}"
echo -e "${GREEN}  TX Hash: $TX_HASH${NC}"
echo -e "${GREEN}  Block: $BLOCK_NUMBER${NC}"
echo ""

# Step 4: Notify Backend
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 4: Notify Backend${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Notifying backend about bid...${NC}"
NOTIFY_RESPONSE=$(curl -s -X POST "$API_BASE_URL/marketplace/bids/notify" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d "{
    \"txHash\": \"$TX_HASH\",
    \"assetId\": \"$ASSET_ID\",
    \"tokenAmount\": \"$TOKEN_AMOUNT_WEI\",
    \"price\": \"$PRICE_WEI\",
    \"blockNumber\": \"$BLOCK_NUMBER\"
  }")

echo "Response:"
echo "$NOTIFY_RESPONSE" | jq '.' || echo "$NOTIFY_RESPONSE"
echo ""

# Check if notification was successful
if echo "$NOTIFY_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
  echo -e "${GREEN}✓ Backend notified successfully${NC}"
  BID_ID=$(echo "$NOTIFY_RESPONSE" | jq -r '.bidId')
  echo -e "${GREEN}  Bid ID: $BID_ID${NC}"
else
  echo -e "${RED}✗ Failed to notify backend${NC}"
  exit 1
fi
echo ""

# Step 5: Verify Bid Recorded
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}Step 5: Verify Bid Recorded${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}Fetching investor's bids...${NC}"
MY_BIDS=$(curl -s "$API_BASE_URL/marketplace/bids/my-bids?assetId=$ASSET_ID" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "My Bids:"
echo "$MY_BIDS" | jq '.' || echo "$MY_BIDS"
echo ""

echo -e "${YELLOW}Fetching all auction bids...${NC}"
ALL_BIDS=$(curl -s "$API_BASE_URL/marketplace/auctions/$ASSET_ID/bids" \
  -H "Authorization: Bearer $JWT_TOKEN")

echo "All Auction Bids:"
echo "$ALL_BIDS" | jq '.' || echo "$ALL_BIDS"
echo ""

# Success Summary
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ BID PLACED SUCCESSFULLY!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Summary:"
echo "  Investor:      $INVESTOR_ADDRESS"
echo "  Asset ID:      $ASSET_ID"
echo "  Token Amount:  $TOKEN_AMOUNT tokens"
echo "  Price:         $PRICE_PER_TOKEN USDC/token"
echo "  TX Hash:       $TX_HASH"
echo "  Bid ID:        $BID_ID"
echo ""
echo "Explorer: https://sepolia.mantlescan.xyz/tx/$TX_HASH"
echo ""
