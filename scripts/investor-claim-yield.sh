#!/bin/bash

# Investor Claim Yield Script
# Allows token holders to claim their USDC yield from YieldVault

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
    echo "Usage: INVESTOR_PRIVATE_KEY=0x... ./investor-claim-yield.sh"
    echo ""
    echo "Example:"
    echo "  INVESTOR_PRIVATE_KEY=0x... ./investor-claim-yield.sh"
    exit 1
fi

print_header "Investor Claim Yield"

# Get investor wallet address
INVESTOR_WALLET=$(node -e "
const { ethers } = require('ethers');
const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY');
console.log(wallet.address);
")

print_info "Investor Wallet: $INVESTOR_WALLET"
echo ""

# =============================================================================
# STEP 1: Check Claimable Yield
# =============================================================================
print_header "Step 1: Check Claimable Yield"
print_info "Querying YieldVault contract..."

CHECK_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function checkClaimable() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const YIELD_VAULT_ABI = [
      'function getUserClaimable(address user) view returns (uint256)',
      'function claimAllYield() external',
      'function USDC() view returns (address)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const yieldVaultAddress = deployedContracts.contracts.YieldVault;
    const yieldVaultContract = new ethers.Contract(yieldVaultAddress, YIELD_VAULT_ABI, provider);

    console.error('YieldVault Address: ' + yieldVaultAddress);
    console.error('');

    // Get claimable amount
    const claimable = await yieldVaultContract.getUserClaimable('$INVESTOR_WALLET');
    const claimableUsdc = ethers.formatUnits(claimable, 6);

    console.error('Claimable Yield: ' + claimableUsdc + ' USDC');
    console.error('');

    // Return result
    console.log(JSON.stringify({
      claimable: claimable.toString(),
      claimableUsdc: claimableUsdc
    }));

  } catch (error) {
    console.error('CHECK_ERROR:' + error.message);
    process.exit(1);
  }
}

checkClaimable();
" 2>&1)

# Check for errors
if echo "$CHECK_RESULT" | grep -q "CHECK_ERROR:"; then
  ERROR_MSG=$(echo "$CHECK_RESULT" | grep "CHECK_ERROR:" | cut -d':' -f2-)
  print_error "Failed to check claimable yield: $ERROR_MSG"
  exit 1
fi

# Extract JSON result
CHECK_DATA=$(echo "$CHECK_RESULT" | tail -1)
CLAIMABLE_WEI=$(echo "$CHECK_DATA" | jq -r '.claimable')
CLAIMABLE_USDC=$(echo "$CHECK_DATA" | jq -r '.claimableUsdc')

print_cyan "Claimable Yield: $CLAIMABLE_USDC USDC"
echo ""

if [ "$CLAIMABLE_WEI" == "0" ]; then
    print_warning "No yield available to claim"
    print_info "Possible reasons:"
    echo "  • Yield hasn't been distributed yet"
    echo "  • You already claimed your yield"
    echo "  • You don't hold any tokens for this asset"
    exit 0
fi

# =============================================================================
# STEP 2: Claim Yield
# =============================================================================
print_header "Step 2: Claim Yield"
print_info "You are about to claim $CLAIMABLE_USDC USDC"
echo ""

read -p "Continue with claim? (y/n): " CONTINUE

if [ "$CONTINUE" != "y" ]; then
    print_warning "Claim cancelled"
    exit 0
fi

print_info "Submitting claimAllYield() transaction..."
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
      'function claimAllYield() external',
      'event YieldClaimed(address indexed user, uint256 amount, uint256 timestamp)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet('$INVESTOR_PRIVATE_KEY', provider);

    const yieldVaultAddress = deployedContracts.contracts.YieldVault;
    const yieldVaultContract = new ethers.Contract(yieldVaultAddress, YIELD_VAULT_ABI, wallet);

    console.error('Claiming yield...');
    const tx = await yieldVaultContract.claimAllYield();
    console.error('TX Hash: ' + tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Confirmed in block ' + receipt.blockNumber);
    console.error('');

    // Parse YieldClaimed event
    let claimedAmount = '0';
    for (const log of receipt.logs) {
      try {
        const parsed = yieldVaultContract.interface.parseLog(log);
        if (parsed.name === 'YieldClaimed') {
          claimedAmount = parsed.args.amount.toString();
          console.error('Claimed: ' + ethers.formatUnits(claimedAmount, 6) + ' USDC');
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    // Return result
    console.log(JSON.stringify({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      claimedAmount: claimedAmount
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
CLAIMED_AMOUNT=$(echo "$CLAIM_DATA" | jq -r '.claimedAmount')

CLAIMED_USDC=$(echo "scale=6; $CLAIMED_AMOUNT / 1000000" | bc)

print_success "Yield claimed successfully!"
print_info "TX Hash: $TX_HASH"
print_info "Block: $BLOCK_NUMBER"
print_info "Explorer: https://sepolia.mantlescan.xyz/tx/$TX_HASH"
echo ""

# =============================================================================
# STEP 3: Verify USDC Balance
# =============================================================================
print_header "Step 3: Verify USDC Balance"
print_info "Checking your USDC balance..."

BALANCE_RESULT=$(node -e "
const { ethers } = require('ethers');
const { readFileSync } = require('fs');

async function checkBalance() {
  try {
    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const USDC_ABI = [
      'function balanceOf(address account) view returns (uint256)',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const usdcAddress = deployedContracts.contracts.USDC;
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, provider);

    const balance = await usdcContract.balanceOf('$INVESTOR_WALLET');
    const balanceUsdc = ethers.formatUnits(balance, 6);

    console.log(JSON.stringify({
      balance: balance.toString(),
      balanceUsdc: balanceUsdc
    }));

  } catch (error) {
    console.error('BALANCE_ERROR:' + error.message);
    process.exit(1);
  }
}

checkBalance();
" 2>&1)

if ! echo "$BALANCE_RESULT" | grep -q "BALANCE_ERROR:"; then
  BALANCE_DATA=$(echo "$BALANCE_RESULT" | tail -1)
  USDC_BALANCE=$(echo "$BALANCE_DATA" | jq -r '.balanceUsdc')

  print_success "Current USDC Balance: $USDC_BALANCE USDC"
else
  print_warning "Could not verify USDC balance"
fi

echo ""

# =============================================================================
# FINAL SUMMARY
# =============================================================================
print_header "Yield Claimed Successfully! 🎉"
print_success "Investor: $INVESTOR_WALLET"
print_success "Claimed: $CLAIMED_USDC USDC"
print_success "TX Hash: $TX_HASH"
echo ""
print_cyan "Your USDC has been transferred to your wallet!"
echo ""
print_info "You can verify the transaction on the explorer:"
echo "  https://sepolia.mantlescan.xyz/tx/$TX_HASH"
echo ""
