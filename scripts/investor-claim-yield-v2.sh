#!/bin/bash

# Investor Claim Yield Script (v2 - Burn-to-Claim Model)
# Investors burn their RWA tokens to claim their pro-rata share of settlement USDC

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
TOKEN_ADDRESS="${1}"  # RWA Token address
BURN_AMOUNT="${2}"    # Amount of tokens to burn (in human readable format, e.g., 100)

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
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-claim-yield-v2.sh <token-address> [burn-amount]"
    echo ""
    echo "Parameters:"
    echo "  token-address  : RWA token contract address"
    echo "  burn-amount    : (Optional) Amount of tokens to burn. If not specified, burns ALL tokens"
    echo ""
    echo "Example:"
    echo "  INVESTOR_PRIVATE_KEY=0x... ./investor-claim-yield-v2.sh 0xTOKENADDRESS 100"
    exit 1
fi

if [ -z "$TOKEN_ADDRESS" ]; then
    print_error "Token address not provided!"
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-claim-yield-v2.sh <token-address> [burn-amount]"
    exit 1
fi

print_header "🔥 Burn-to-Claim Yield (v2)"

# Get investor wallet address
INVESTOR_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Investor Wallet: $INVESTOR_WALLET"
print_info "Token Address: $TOKEN_ADDRESS"
echo ""

# =============================================================================
# STEP 1: Check Settlement Info & Token Balance
# =============================================================================
print_header "Step 1: Check Settlement Info & Token Balance"
print_info "Querying YieldVault and RWA Token contracts..."

CHECK_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function checkSettlement() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const YIELD_VAULT_ABI = [
      'function getSettlementInfo(address tokenAddress) view returns (uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, uint256 yieldPerToken)',
      'function getClaimableForTokens(address tokenAddress, uint256 tokenAmount) view returns (uint256)',
      'function claimYield(address tokenAddress, uint256 tokenAmount) external',
    ];

    const ERC20_ABI = [
      'function balanceOf(address account) view returns (uint256)',
      'function decimals() view returns (uint8)',
      'function symbol() view returns (string)',
      'function totalSupply() view returns (uint256)',
      'function allowance(address owner, address spender) view returns (uint256)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const yieldVaultAddress = deployedContracts.contracts.YieldVault;
    const yieldVaultContract = new ethers.Contract(yieldVaultAddress, YIELD_VAULT_ABI, provider);
    const tokenContract = new ethers.Contract('$TOKEN_ADDRESS', ERC20_ABI, provider);

    console.error('YieldVault Address: ' + yieldVaultAddress);
    console.error('');

    // Get settlement info
    const settlementInfo = await yieldVaultContract.getSettlementInfo('$TOKEN_ADDRESS');
    const totalSettlement = settlementInfo[0];
    const totalTokenSupply = settlementInfo[1];
    const totalClaimed = settlementInfo[2];
    const totalTokensBurned = settlementInfo[3];
    const yieldPerToken = settlementInfo[4];

    const settlementUsdc = ethers.formatUnits(totalSettlement, 6);
    const claimedUsdc = ethers.formatUnits(totalClaimed, 6);
    const remainingUsdc = ethers.formatUnits(totalSettlement - totalClaimed, 6);
    const tokensSupply = ethers.formatUnits(totalTokenSupply, 18);
    const tokensBurned = ethers.formatUnits(totalTokensBurned, 18);
    const yieldPerTokenFormatted = ethers.formatUnits(yieldPerToken, 6); // Yield per token in USDC (6 decimals)

    console.error('Settlement Info:');
    console.error('  Total Settlement: ' + settlementUsdc + ' USDC');
    console.error('  Token Supply: ' + tokensSupply + ' tokens');
    console.error('  Yield Per Token: ' + yieldPerTokenFormatted + ' USDC/token');
    console.error('  Total Claimed: ' + claimedUsdc + ' USDC');
    console.error('  Tokens Burned: ' + tokensBurned + ' tokens');
    console.error('  Remaining: ' + remainingUsdc + ' USDC');
    console.error('');

    // Get investor's token balance
    const balance = await tokenContract.balanceOf('$INVESTOR_WALLET');
    const decimals = await tokenContract.decimals();
    const symbol = await tokenContract.symbol();
    const balanceFormatted = ethers.formatUnits(balance, decimals);

    console.error('Your Token Balance: ' + balanceFormatted + ' ' + symbol);
    console.error('');

    // Check allowance for YieldVault
    const allowance = await tokenContract.allowance('$INVESTOR_WALLET', yieldVaultAddress);
    const allowanceFormatted = ethers.formatUnits(allowance, decimals);

    console.error('YieldVault Allowance: ' + allowanceFormatted + ' ' + symbol);
    console.error('');

    // Return result
    console.log(JSON.stringify({
      totalSettlement: totalSettlement.toString(),
      totalTokenSupply: totalTokenSupply.toString(),
      totalClaimed: totalClaimed.toString(),
      yieldPerToken: yieldPerToken.toString(),
      balance: balance.toString(),
      decimals: Number(decimals),
      symbol: symbol,
      allowance: allowance.toString(),
      yieldVaultAddress: yieldVaultAddress
    }));

  } catch (error) {
    console.error('CHECK_ERROR:' + error.message);
    process.exit(1);
  }
}

checkSettlement();
" 2>&1)

# Check for errors
if echo "$CHECK_RESULT" | grep -q "CHECK_ERROR:"; then
  ERROR_MSG=$(echo "$CHECK_RESULT" | grep "CHECK_ERROR:" | cut -d':' -f2-)
  print_error "Failed to check settlement: $ERROR_MSG"
  exit 1
fi

# Extract JSON result
CHECK_DATA=$(echo "$CHECK_RESULT" | tail -1)
TOTAL_SETTLEMENT=$(echo "$CHECK_DATA" | jq -r '.totalSettlement')
TOTAL_TOKEN_SUPPLY=$(echo "$CHECK_DATA" | jq -r '.totalTokenSupply')
YIELD_PER_TOKEN=$(echo "$CHECK_DATA" | jq -r '.yieldPerToken')
INVESTOR_BALANCE=$(echo "$CHECK_DATA" | jq -r '.balance')
TOKEN_DECIMALS=$(echo "$CHECK_DATA" | jq -r '.decimals')
TOKEN_SYMBOL=$(echo "$CHECK_DATA" | jq -r '.symbol')
ALLOWANCE=$(echo "$CHECK_DATA" | jq -r '.allowance')
YIELD_VAULT_ADDRESS=$(echo "$CHECK_DATA" | jq -r '.yieldVaultAddress')

INVESTOR_BALANCE_FORMATTED=$(echo "scale=2; $INVESTOR_BALANCE / 10^$TOKEN_DECIMALS" | bc -l)

if [ "$TOTAL_SETTLEMENT" == "0" ]; then
    print_error "No settlement deposited for this token yet!"
    print_info "Wait for admin to deposit settlement to YieldVault"
    exit 1
fi

if [ "$INVESTOR_BALANCE" == "0" ]; then
    print_error "You don't own any tokens!"
    exit 1
fi

# Determine burn amount
if [ -z "$BURN_AMOUNT" ]; then
    print_info "No burn amount specified - will burn ALL tokens ($INVESTOR_BALANCE_FORMATTED $TOKEN_SYMBOL)"
    BURN_AMOUNT_WEI="$INVESTOR_BALANCE"
    BURN_AMOUNT_FORMATTED="$INVESTOR_BALANCE_FORMATTED"
else
    # Convert human-readable amount to wei
    BURN_AMOUNT_WEI=$(echo "$BURN_AMOUNT * 10^$TOKEN_DECIMALS" | bc)
    BURN_AMOUNT_WEI=${BURN_AMOUNT_WEI%.*}  # Remove decimals
    BURN_AMOUNT_FORMATTED="$BURN_AMOUNT"
fi

# Calculate expected USDC
EXPECTED_USDC_WEI=$(echo "scale=0; $BURN_AMOUNT_WEI * $TOTAL_SETTLEMENT / $TOTAL_TOKEN_SUPPLY" | bc)
EXPECTED_USDC=$(echo "scale=6; $EXPECTED_USDC_WEI / 1000000" | bc)

print_success "Settlement is ready for claiming!"
print_cyan "You will burn: $BURN_AMOUNT_FORMATTED $TOKEN_SYMBOL"
print_cyan "You will receive: ~$EXPECTED_USDC USDC"
echo ""

# =============================================================================
# STEP 2: Approve YieldVault (if needed)
# =============================================================================
if [ "$ALLOWANCE" == "0" ] || [ $(echo "$ALLOWANCE < $BURN_AMOUNT_WEI" | bc) -eq 1 ]; then
    print_header "Step 2: Approve YieldVault to Burn Tokens"
    print_info "YieldVault needs approval to burn your tokens..."

    APPROVE_RESULT=$(node -e "
const { ethers } = require('ethers');

async function approveTokens() {
  try {
    const ERC20_ABI = ['function approve(address spender, uint256 amount) external returns (bool)'];
    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);
    const tokenContract = new ethers.Contract('$TOKEN_ADDRESS', ERC20_ABI, wallet);

    console.error('Approving YieldVault to spend tokens...');
    const tx = await tokenContract.approve('$YIELD_VAULT_ADDRESS', '$BURN_AMOUNT_WEI');
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

# =============================================================================
# STEP 3: Burn Tokens and Claim USDC
# =============================================================================
print_header "Step 3: Burn Tokens & Claim USDC"
print_warning "⚠️  THIS WILL BURN YOUR TOKENS PERMANENTLY!"
print_info "Burning: $BURN_AMOUNT_FORMATTED $TOKEN_SYMBOL"
print_info "Receiving: ~$EXPECTED_USDC USDC"
echo ""

read -p "Continue with claim? (y/n): " CONTINUE

if [ "$CONTINUE" != "y" ]; then
    print_warning "Claim cancelled"
    exit 0
fi

print_info "Submitting claimYield() transaction..."
echo ""

CLAIM_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function claimYield() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const YIELD_VAULT_ABI = [
      'function claimYield(address tokenAddress, uint256 tokenAmount) external',
      'event YieldClaimed(address indexed user, address indexed tokenAddress, uint256 tokensBurned, uint256 usdcReceived, uint256 timestamp)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);

    const yieldVaultAddress = deployedContracts.contracts.YieldVault;
    const yieldVaultContract = new ethers.Contract(yieldVaultAddress, YIELD_VAULT_ABI, wallet);

    console.error('🔥 Burning tokens and claiming yield...');
    const tx = await yieldVaultContract.claimYield('$TOKEN_ADDRESS', '$BURN_AMOUNT_WEI');
    console.error('TX Hash: ' + tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Confirmed in block ' + receipt.blockNumber);
    console.error('');

    // Parse YieldClaimed event
    let tokensBurned = '0';
    let usdcReceived = '0';
    for (const log of receipt.logs) {
      try {
        const parsed = yieldVaultContract.interface.parseLog(log);
        if (parsed.name === 'YieldClaimed') {
          tokensBurned = parsed.args.tokensBurned.toString();
          usdcReceived = parsed.args.usdcReceived.toString();
          console.error('Tokens Burned: ' + ethers.formatUnits(tokensBurned, 18) + ' $TOKEN_SYMBOL');
          console.error('USDC Received: ' + ethers.formatUnits(usdcReceived, 6) + ' USDC');
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    console.log(JSON.stringify({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      tokensBurned: tokensBurned,
      usdcReceived: usdcReceived
    }));

  } catch (error) {
    console.error('CLAIM_ERROR:' + error.message);
    process.exit(1);
  }
}

claimYield();
" 2>&1)

# Check for errors
if echo "$CLAIM_RESULT" | grep -q "CLAIM_ERROR:"; then
  ERROR_MSG=$(echo "$CLAIM_RESULT" | grep "CLAIM_ERROR:" | cut -d':' -f2-)
  print_error "Failed to claim yield: $ERROR_MSG"
  exit 1
fi

# Extract JSON result
CLAIM_DATA=$(echo "$CLAIM_RESULT" | tail -1)
TX_HASH=$(echo "$CLAIM_DATA" | jq -r '.txHash')
BLOCK_NUMBER=$(echo "$CLAIM_DATA" | jq -r '.blockNumber')
TOKENS_BURNED=$(echo "$CLAIM_DATA" | jq -r '.tokensBurned')
USDC_RECEIVED=$(echo "$CLAIM_DATA" | jq -r '.usdcReceived')

TOKENS_BURNED_FORMATTED=$(echo "scale=2; $TOKENS_BURNED / 10^$TOKEN_DECIMALS" | bc -l)
USDC_RECEIVED_FORMATTED=$(echo "scale=6; $USDC_RECEIVED / 1000000" | bc)

print_success "Yield claimed successfully!"
echo ""

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "🎉 Claim Successful!"
print_success "Investor: $INVESTOR_WALLET"
print_success "Tokens Burned: $TOKENS_BURNED_FORMATTED $TOKEN_SYMBOL 🔥"
print_success "USDC Received: $USDC_RECEIVED_FORMATTED USDC"
print_success "TX Hash: $TX_HASH"
echo ""
print_cyan "Your USDC has been transferred to your wallet!"
echo ""
print_info "Explorer: https://explorer.sepolia.mantle.xyz/tx/$TX_HASH"
echo ""
