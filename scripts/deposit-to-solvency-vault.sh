#!/bin/bash

# Deposit RWA Tokens to Solvency Vault & Borrow USDC
# Allows users to use their RWA tokens as collateral for USDC loans

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
INVESTOR_PRIVATE_KEY="${INVESTOR_PRIVATE_KEY}"
ASSET_ID="${1}"                # Asset ID (UUID)
DEPOSIT_AMOUNT="${2}"          # Amount of tokens to deposit (in human readable format, e.g., 90)
BORROW_AMOUNT="${3}"           # Amount of USDC to borrow (optional, in USD, e.g., 50000)
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"

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
if [ -z "$INVESTOR_PRIVATE_KEY" ]; then
    print_error "INVESTOR_PRIVATE_KEY not set!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./deposit-to-solvency-vault.sh <asset-id> <deposit-amount> [borrow-amount]"
    echo ""
    echo "Parameters:"
    echo "  asset-id       : Asset UUID from assets collection"
    echo "  deposit-amount : Amount of RWA tokens to deposit (e.g., 90)"
    echo "  borrow-amount  : (Optional) Amount of USDC to borrow in USD (e.g., 50000)"
    echo ""
    echo "Example:"
    echo "  INVESTOR_PRIVATE_KEY=0x... ./deposit-to-solvency-vault.sh 571d718d-186f-4c07-9a0d-d6e5e870483a 10"
    exit 1
fi

if [ -z "$ASSET_ID" ]; then
    print_error "Asset ID not provided!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./deposit-to-solvency-vault.sh <asset-id> <deposit-amount> [borrow-amount]"
    exit 1
fi

if [ -z "$DEPOSIT_AMOUNT" ]; then
    print_error "Deposit amount not provided!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./deposit-to-solvency-vault.sh <asset-id> <deposit-amount> [borrow-amount]"
    exit 1
fi

print_header "💰 Deposit to Solvency Vault & Borrow USDC"

# Get investor wallet address
INVESTOR_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Investor Wallet: $INVESTOR_WALLET"
print_info "Asset ID: $ASSET_ID"
print_info "API URL: $API_BASE_URL"
echo ""

# =============================================================================
# STEP 1: Authenticate with Backend
# =============================================================================
print_header "Step 1: Authenticate with Backend"
print_info "Requesting challenge from server..."

CHALLENGE_RESPONSE=$(curl -s "$API_BASE_URL/auth/challenge?walletAddress=$INVESTOR_WALLET&role=INVESTOR")
MESSAGE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.message')
NONCE=$(echo "$CHALLENGE_RESPONSE" | jq -r '.nonce')

if [ -z "$MESSAGE" ] || [ "$MESSAGE" == "null" ]; then
    print_error "Failed to get challenge"
    echo "$CHALLENGE_RESPONSE"
    exit 1
fi

print_success "Challenge received"
print_info "Signing message with private key..."

# Sign using inline node command
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

print_success "Message signed"

# Login
print_info "Submitting authentication..."

LOGIN_PAYLOAD=$(jq -n \
  --arg wallet "$INVESTOR_WALLET" \
  --arg msg "$MESSAGE" \
  --arg sig "$SIGNATURE" \
  '{walletAddress: $wallet, message: $msg, signature: $sig}')

LOGIN_RESPONSE=$(curl -s -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$LOGIN_PAYLOAD")

ACCESS_TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.tokens.access')
USER_ROLE=$(echo "$LOGIN_RESPONSE" | jq -r '.user.role')

if [ -z "$ACCESS_TOKEN" ] || [ "$ACCESS_TOKEN" == "null" ]; then
    print_error "Login failed"
    echo "$LOGIN_RESPONSE"
    exit 1
fi

print_success "Login successful (Role: $USER_ROLE)"
echo ""

# =============================================================================
# STEP 2: Get Asset Info from Backend
# =============================================================================
print_header "Step 2: Fetch Asset Information"

ASSET_RESPONSE=$(curl -s "$API_BASE_URL/assets/$ASSET_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

ASSET_STATUS=$(echo "$ASSET_RESPONSE" | jq -r '.status')
TOKEN_ADDRESS=$(echo "$ASSET_RESPONSE" | jq -r '.token.address')
TOKEN_PRICE_USD=$(echo "$ASSET_RESPONSE" | jq -r '.listing.price // .listing.staticPrice')

if [ "$TOKEN_ADDRESS" == "null" ] || [ -z "$TOKEN_ADDRESS" ]; then
    print_error "Asset not found or token not deployed"
    echo "$ASSET_RESPONSE" | jq '.'
    exit 1
fi

print_success "Asset Status: $ASSET_STATUS"
print_info "Token Address: $TOKEN_ADDRESS"
print_info "Token Price: \$$(echo "scale=2; $TOKEN_PRICE_USD / 1000000" | bc) per token"
echo ""

# =============================================================================
# STEP 3: Check Token Balance & Contract Info
# =============================================================================
print_header "Step 3: Check Token Balance & Contract Info"

CHECK_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function checkBalance() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const ERC20_ABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const tokenContract = new ethers.Contract('$TOKEN_ADDRESS', ERC20_ABI, provider);

    const balance = await tokenContract.balanceOf('$INVESTOR_WALLET');
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    const balanceFormatted = ethers.formatUnits(balance, decimals);

    console.error('Your RWA Token Balance: ' + balanceFormatted + ' ' + symbol);
    console.error('');

    const solvencyVaultAddress = deployedContracts.contracts.SolvencyVault;
    if (!solvencyVaultAddress) {
      console.error('ERROR: SolvencyVault not deployed!');
      process.exit(1);
    }

    console.error('SolvencyVault Address: ' + solvencyVaultAddress);

    // Check allowance
    const allowance = await tokenContract.allowance('$INVESTOR_WALLET', solvencyVaultAddress);
    const allowanceFormatted = ethers.formatUnits(allowance, decimals);
    console.error('Current Allowance: ' + allowanceFormatted + ' ' + symbol);
    console.error('');

    console.log(JSON.stringify({
      balance: balance.toString(),
      decimals: Number(decimals),
      symbol: symbol,
      allowance: allowance.toString(),
      solvencyVaultAddress: solvencyVaultAddress
    }));

  } catch (error) {
    console.error('CHECK_ERROR:' + error.message);
    process.exit(1);
  }
}

checkBalance();
" 2>&1)

# Check for errors
if echo "$CHECK_RESULT" | grep -q "CHECK_ERROR:"; then
  ERROR_MSG=$(echo "$CHECK_RESULT" | grep "CHECK_ERROR:" | cut -d':' -f2-)
  print_error "Failed to check balance: $ERROR_MSG"
  exit 1
fi

# Extract JSON result
CHECK_DATA=$(echo "$CHECK_RESULT" | tail -1)
INVESTOR_BALANCE=$(echo "$CHECK_DATA" | jq -r '.balance')
TOKEN_DECIMALS=$(echo "$CHECK_DATA" | jq -r '.decimals')
TOKEN_SYMBOL=$(echo "$CHECK_DATA" | jq -r '.symbol')
ALLOWANCE=$(echo "$CHECK_DATA" | jq -r '.allowance')
SOLVENCY_VAULT_ADDRESS=$(echo "$CHECK_DATA" | jq -r '.solvencyVaultAddress')

INVESTOR_BALANCE_FORMATTED=$(echo "scale=2; $INVESTOR_BALANCE / 10^$TOKEN_DECIMALS" | bc -l)

if [ "$INVESTOR_BALANCE" == "0" ]; then
    print_error "You don't own any tokens!"
    exit 1
fi

# Convert deposit amount to wei
DEPOSIT_AMOUNT_WEI=$(echo "$DEPOSIT_AMOUNT * 10^$TOKEN_DECIMALS" | bc)
DEPOSIT_AMOUNT_WEI=${DEPOSIT_AMOUNT_WEI%.*}  # Remove decimals

# Validate sufficient balance
if [ $(echo "$INVESTOR_BALANCE < $DEPOSIT_AMOUNT_WEI" | bc) -eq 1 ]; then
    print_error "Insufficient balance! You have $INVESTOR_BALANCE_FORMATTED $TOKEN_SYMBOL but trying to deposit $DEPOSIT_AMOUNT"
    exit 1
fi

print_success "Token balance verified: $INVESTOR_BALANCE_FORMATTED $TOKEN_SYMBOL"
echo ""

# =============================================================================
# STEP 4: Approve SolvencyVault (if needed)
# =============================================================================
if [ "$ALLOWANCE" == "0" ] || [ $(echo "$ALLOWANCE < $DEPOSIT_AMOUNT_WEI" | bc) -eq 1 ]; then
    print_header "Step 4: Approve SolvencyVault to Spend Tokens"
    print_info "SolvencyVault needs approval to transfer your tokens..."

    APPROVE_RESULT=$(node -e "
const { ethers } = require('ethers');

async function approveTokens() {
  try {
    const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];
    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);
    const tokenContract = new ethers.Contract('$TOKEN_ADDRESS', ERC20_ABI, wallet);

    console.error('Approving SolvencyVault to spend tokens...');
    const tx = await tokenContract.approve('$SOLVENCY_VAULT_ADDRESS', '$DEPOSIT_AMOUNT_WEI');
    console.error('TX Hash: ' + tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Approved in block ' + receipt.blockNumber);
    console.error('');

    console.log(JSON.stringify({ txHash: tx.hash, blockNumber: receipt.blockNumber.toString() }));
  } catch (error) {
    console.error('APPROVE_ERROR:' + error.message);
    process.exit(1);
  }
}

approveTokens();
" 2>&1)

    if echo "$APPROVE_RESULT" | grep -q "APPROVE_ERROR:"; then
      ERROR_MSG=$(echo "$APPROVE_RESULT" | grep "APPROVE_ERROR:" | cut -d':' -f2-)
      print_error "Failed to approve: $ERROR_MSG"
      exit 1
    fi

    print_success "Approval successful!"
    echo ""
else
    print_info "Tokens already approved - skipping approval step"
    echo ""
fi

# Calculate total USD value
TOKEN_VALUE_WEI=$(echo "$DEPOSIT_AMOUNT_WEI * $TOKEN_PRICE_USD / 10^$TOKEN_DECIMALS" | bc)
TOKEN_VALUE_WEI=${TOKEN_VALUE_WEI%.*}

# =============================================================================
# STEP 5: Deposit to SolvencyVault via Backend API
# =============================================================================
print_header "Step 5: Deposit Collateral to SolvencyVault"
print_info "Depositing $DEPOSIT_AMOUNT $TOKEN_SYMBOL to SolvencyVault..."

DEPOSIT_PAYLOAD=$(jq -n \
  --arg tokenAddr "$TOKEN_ADDRESS" \
  --arg amount "$DEPOSIT_AMOUNT_WEI" \
  --arg valueUSD "$TOKEN_VALUE_WEI" \
  '{
    collateralTokenAddress: $tokenAddr,
    collateralAmount: $amount,
    tokenValueUSD: $valueUSD,
    tokenType: "RWA"
  }')

DEPOSIT_RESPONSE=$(curl -s -X POST "$API_BASE_URL/solvency/deposit" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "$DEPOSIT_PAYLOAD")

DEPOSIT_SUCCESS=$(echo "$DEPOSIT_RESPONSE" | jq -r '.success')

if [ "$DEPOSIT_SUCCESS" != "true" ]; then
    print_error "Deposit failed"
    echo "$DEPOSIT_RESPONSE" | jq '.'
    exit 1
fi

POSITION_ID=$(echo "$DEPOSIT_RESPONSE" | jq -r '.positionId')
COLLATERAL_VALUE=$(echo "$DEPOSIT_RESPONSE" | jq -r '.collateralValue')
MAX_BORROW=$(echo "$DEPOSIT_RESPONSE" | jq -r '.maxBorrow')
LTV_RATIO=$(echo "$DEPOSIT_RESPONSE" | jq -r '.ltvRatio')
TX_HASH=$(echo "$DEPOSIT_RESPONSE" | jq -r '.txHash')

# Convert to human readable
COLLATERAL_VALUE_USD=$(echo "scale=2; $COLLATERAL_VALUE / 1000000" | bc)
MAX_BORROW_USD=$(echo "scale=2; $MAX_BORROW / 1000000" | bc)

print_success "Deposit successful!"
print_cyan "Position ID: $POSITION_ID"
print_cyan "Collateral Value: \$$COLLATERAL_VALUE_USD USD"
print_cyan "Max Borrow: \$$MAX_BORROW_USD USDC (${LTV_RATIO}% LTV)"
print_cyan "Transaction: https://explorer.sepolia.mantle.xyz/tx/$TX_HASH"
echo ""

# =============================================================================
# STEP 6: Borrow USDC (if borrow amount specified)
# =============================================================================
if [ -n "$BORROW_AMOUNT" ]; then
    print_header "Step 6: Borrow USDC Against Collateral"

    # Convert borrow amount to USDC wei (6 decimals)
    BORROW_AMOUNT_WEI=$(echo "$BORROW_AMOUNT * 1000000" | bc)
    BORROW_AMOUNT_WEI=${BORROW_AMOUNT_WEI%.*}

    # Validate borrow amount doesn't exceed max
    if [ $(echo "$BORROW_AMOUNT_WEI > $MAX_BORROW" | bc) -eq 1 ]; then
        print_error "Borrow amount ($BORROW_AMOUNT USDC) exceeds maximum allowed ($MAX_BORROW_USD USDC)"
        print_info "Adjusting to maximum borrowable amount..."
        BORROW_AMOUNT_WEI="$MAX_BORROW"
        BORROW_AMOUNT=$(echo "scale=2; $MAX_BORROW / 1000000" | bc)
    fi

    print_info "Borrowing $BORROW_AMOUNT USDC from SeniorPool..."

    BORROW_PAYLOAD=$(jq -n \
      --arg posId "$POSITION_ID" \
      --arg amount "$BORROW_AMOUNT_WEI" \
      '{
        positionId: ($posId | tonumber),
        borrowAmount: $amount
      }')

    BORROW_RESPONSE=$(curl -s -X POST "$API_BASE_URL/solvency/borrow" \
      -H "Authorization: Bearer $ACCESS_TOKEN" \
      -H 'Content-Type: application/json' \
      -d "$BORROW_PAYLOAD")

    BORROW_SUCCESS=$(echo "$BORROW_RESPONSE" | jq -r '.success')

    if [ "$BORROW_SUCCESS" != "true" ]; then
        print_error "Borrow failed"
        echo "$BORROW_RESPONSE" | jq '.'
        exit 1
    fi

    BORROWED_AMOUNT=$(echo "$BORROW_RESPONSE" | jq -r '.borrowed')
    NEW_DEBT=$(echo "$BORROW_RESPONSE" | jq -r '.totalDebt')
    HEALTH_FACTOR=$(echo "$BORROW_RESPONSE" | jq -r '.healthFactor')
    BORROW_TX_HASH=$(echo "$BORROW_RESPONSE" | jq -r '.txHash')

    # Convert to human readable
    BORROWED_USD=$(echo "scale=2; $BORROWED_AMOUNT / 1000000" | bc)
    NEW_DEBT_USD=$(echo "scale=2; $NEW_DEBT / 1000000" | bc)
    HEALTH_FACTOR_PCT=$(echo "scale=2; $HEALTH_FACTOR / 100" | bc)

    print_success "Borrow successful!"
    print_cyan "Borrowed: \$$BORROWED_USD USDC"
    print_cyan "Total Debt: \$$NEW_DEBT_USD USDC"
    print_cyan "Health Factor: $HEALTH_FACTOR_PCT%"
    print_cyan "Transaction: https://explorer.sepolia.mantle.xyz/tx/$BORROW_TX_HASH"
    echo ""
else
    print_info "No borrow amount specified - skipping borrow step"
    print_info "You can borrow up to $MAX_BORROW_USD USDC at any time"
    echo ""
fi

# =============================================================================
# STEP 7: Check Final Position Status
# =============================================================================
print_header "Step 7: Final Position Summary"

POSITION_RESPONSE=$(curl -s -X GET "$API_BASE_URL/solvency/position/$POSITION_ID" \
  -H "Authorization: Bearer $ACCESS_TOKEN")

POSITION_SUCCESS=$(echo "$POSITION_RESPONSE" | jq -r '.success')

if [ "$POSITION_SUCCESS" == "true" ]; then
    POS_COLLATERAL=$(echo "$POSITION_RESPONSE" | jq -r '.position.collateralAmount')
    POS_DEBT=$(echo "$POSITION_RESPONSE" | jq -r '.position.debtAmount')
    POS_HEALTH=$(echo "$POSITION_RESPONSE" | jq -r '.position.healthFactor')
    POS_STATUS=$(echo "$POSITION_RESPONSE" | jq -r '.position.status')

    POS_COLLATERAL_FORMATTED=$(echo "scale=2; $POS_COLLATERAL / 10^$TOKEN_DECIMALS" | bc -l)
    POS_DEBT_USD=$(echo "scale=2; $POS_DEBT / 1000000" | bc)
    POS_HEALTH_PCT=$(echo "scale=2; $POS_HEALTH / 100" | bc)

    print_cyan "═══════════════════════════════════════════"
    print_cyan "Position ID: $POSITION_ID"
    print_cyan "Status: $POS_STATUS"
    print_cyan "Collateral: $POS_COLLATERAL_FORMATTED $TOKEN_SYMBOL"
    print_cyan "Debt: \$$POS_DEBT_USD USDC"
    print_cyan "Health Factor: $POS_HEALTH_PCT%"
    print_cyan "═══════════════════════════════════════════"
    echo ""
fi

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "🎉 SolvencyVault Deposit Complete!"
print_success "Wallet: $INVESTOR_WALLET"
print_success "Deposited: $DEPOSIT_AMOUNT $TOKEN_SYMBOL"
print_success "Position ID: $POSITION_ID"

if [ -n "$BORROW_AMOUNT" ]; then
    print_success "Borrowed: \$$BORROWED_USD USDC"
fi

echo ""
print_info "Next Steps:"
echo "  • Monitor your position: GET $API_BASE_URL/solvency/position/$POSITION_ID"
echo "  • Borrow more USDC: POST $API_BASE_URL/solvency/borrow"
echo "  • Repay loan: POST $API_BASE_URL/solvency/repay"
echo "  • Withdraw collateral (after full repayment): POST $API_BASE_URL/solvency/withdraw"
echo ""
print_warning "Important: Maintain health factor above 110% to avoid liquidation!"
echo ""
