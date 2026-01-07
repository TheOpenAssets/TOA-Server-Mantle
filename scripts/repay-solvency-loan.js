#!/usr/bin/env node

/**
 * Repay USDC Loan for Solvency Vault Position
 *
 * Usage:
 *   INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js <position_id> <amount_usdc>
 *
 * Example:
 *   INVESTOR_KEY=0x1234... node scripts/repay-solvency-loan.js 1 500
 *
 * This script will:
 * 1. Authenticate with backend
 * 2. Check current debt for the position
 * 3. Approve SolvencyVault to spend USDC
 * 4. Repay the loan
 * 5. Sync repayment with backend
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const INVESTOR_KEY = process.env.INVESTOR_KEY;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// Validation
if (!INVESTOR_KEY) {
  logError('INVESTOR_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js <position_id> <amount_usdc>');
  process.exit(1);
}

const positionId = process.argv[2];
const repayAmount = process.argv[3];

if (!positionId) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js <position_id> [amount_usdc]');
  process.exit(1);
}

// Load deployed contracts
const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
let deployed;
try {
  deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
} catch (error) {
  logError('deployed_contracts.json not found. Have you deployed the contracts?');
  process.exit(1);
}

const contracts = deployed.contracts;

// ABI fragments
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const SOLVENCY_VAULT_ABI = [
  'function repayLoan(uint256 positionId, uint256 amount) external',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, bool active, uint8 tokenType)',
  'event LoanRepaid(uint256 indexed positionId, uint256 amount, uint256 principal, uint256 interest, uint256 remainingDebt)',
];

const SENIOR_POOL_ABI = [
  'function getOutstandingDebt(uint256 positionId) view returns (uint256)',
];

async function getJWTToken(wallet) {
  try {
    logInfo('Requesting authentication challenge...');
    const challengeResponse = await fetch(
      `${BACKEND_URL}/auth/challenge?walletAddress=${wallet.address}&role=INVESTOR`
    );

    if (!challengeResponse.ok) {
      const errorData = await challengeResponse.json();
      throw new Error(`Failed to get challenge: ${JSON.stringify(errorData)}`);
    }

    const challengeData = await challengeResponse.json();
    logInfo(`Challenge received (nonce: ${challengeData.nonce})`);

    logInfo('Signing challenge message...');
    const signature = await wallet.signMessage(challengeData.message);

    logInfo('Submitting login request...');
    const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet.address,
        message: challengeData.message,
        signature: signature,
      }),
    });

    if (!loginResponse.ok) {
      const errorData = await loginResponse.json();
      throw new Error(`Login failed: ${JSON.stringify(errorData)}`);
    }

    const loginData = await loginResponse.json();

    if (!loginData.tokens || !loginData.tokens.access) {
      throw new Error('No access token in login response');
    }

    logSuccess(`Authenticated successfully (Role: ${loginData.user.role})`);
    return loginData.tokens.access;
  } catch (error) {
    logError(`Authentication failed: ${error.message}`);
    throw error;
  }
}

async function approveUSDC(wallet, usdcContract, spender, amount) {
  logSection('Approve SolvencyVault to Spend USDC');

  const decimals = await usdcContract.decimals();
  const symbol = await usdcContract.symbol();
  
  const currentAllowance = await usdcContract.allowance(wallet.address, spender);
  logInfo(`Current allowance: ${ethers.formatUnits(currentAllowance, decimals)} ${symbol}`);

  if (currentAllowance >= amount) {
    logSuccess('Sufficient allowance already granted');
    return;
  }

  logInfo(`Approving ${ethers.formatUnits(amount, decimals)} ${symbol} for SolvencyVault...`);
  const tx = await usdcContract.approve(spender, amount);
  logInfo(`Approval transaction: ${tx.hash}`);

  await tx.wait();
  logSuccess('USDC approved successfully');
}

async function repayLoan(wallet, solvencyVaultContract, positionId, amount) {
  logSection('Repay Loan');

  logInfo(`Repaying $${ethers.formatUnits(amount, 6)} USDC for Position #${positionId}...`);

  try {
    const tx = await solvencyVaultContract.repayLoan(positionId, amount);

    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation...');

    const receipt = await tx.wait();
    logSuccess(`Repayment confirmed in block ${receipt.blockNumber}`);

    // Parse LoanRepaid event
    let principal = null;
    let interest = null;
    let remainingDebt = null;

    for (const log of receipt.logs) {
      try {
        const parsed = solvencyVaultContract.interface.parseLog(log);
        if (parsed.name === 'LoanRepaid') {
          principal = parsed.args.principal;
          interest = parsed.args.interest;
          remainingDebt = parsed.args.remainingDebt;
          
          logSuccess(`Principal Repaid: $${ethers.formatUnits(principal, 6)} USDC`);
          logSuccess(`Interest Paid:    $${ethers.formatUnits(interest, 6)} USDC`);
          logInfo(`Remaining Debt:   $${ethers.formatUnits(remainingDebt, 6)} USDC`);
          break;
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    logInfo(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

    return {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      principal,
      interest,
      remainingDebt
    };
  } catch (error) {
    logError(`Repayment failed: ${error.message}`);
    throw error;
  }
}

async function syncRepaymentWithBackend(positionId, repayData, amount, jwt) {
  logSection('Sync Repayment with Backend');
  logInfo('Syncing repayment with backend database...');

  try {
    // We use the same repay endpoint which handles both DB update and on-chain check if needed,
    // but since we did it manually on-chain, usually we'd want a "sync" endpoint.
    // However, the backend controller's `repayLoan` calls blockchain service.
    // The `sync-position` endpoint is for creation.
    // Let's check if there is a sync repayment endpoint. 
    // Looking at SolvencyController, there isn't a dedicated "sync repayment" endpoint exposed publicly
    // that takes txHash. The `repayLoan` endpoint executes the tx itself via platform wallet usually.
    // But since this script simulates user wallet interaction, we might rely on the backend's
    // event listener (if any) or we might need to add a sync endpoint.
    
    // For now, we'll just log that backend might need manual update or event listening.
    // Wait! The SolvencyController has `repayLoan` which calls `blockchainService.repayLoan`.
    // That means the backend EXPECTS to do the repayment itself (custodial or platform-mediated).
    // But here we are doing it directly from investor wallet.
    
    // If the backend relies on on-chain events, it should pick it up eventually.
    // If not, we might be out of sync.
    // Let's check `SolvencyController` again...
    // It seems the current design in `SolvencyController.repayLoan` performs the on-chain tx. 
    
    logWarning('NOTE: You performed the repayment directly on-chain.');
    logWarning('The backend database might not reflect this immediately unless it has an event indexer.');
    logWarning('If you see discrepancies, check the blockchain state.');

    // We can try to force a sync if there was an endpoint, but there isn't one for repayment specifically.
    // Only `sync-position` for creation.
    
    return true;
  } catch (error) {
    logError(`Failed to sync: ${error.message}`);
    return false;
  }
}

async function main() {
  logSection('Repay Solvency Vault Loan');

  console.log('\n📝 Configuration:');
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Position ID: ${positionId}`);
  console.log(`  Repay Amount: $${repayAmount} USDC`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(INVESTOR_KEY, provider);

  logInfo(`Investor Address: ${wallet.address}`);

  // Authenticate
  logSection('Step 1: Authenticate with Backend');
  const jwt = await getJWTToken(wallet);

  const solvencyVaultAddress = contracts.SolvencyVault;
  const usdcAddress = contracts.USDC;
  const seniorPoolAddress = contracts.SeniorPool;

  // Connect to contracts
  logSection('Step 2: Connect to Contracts');
  const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, wallet);
  const solvencyVaultContract = new ethers.Contract(solvencyVaultAddress, SOLVENCY_VAULT_ABI, wallet);
  const seniorPoolContract = new ethers.Contract(seniorPoolAddress, SENIOR_POOL_ABI, wallet); // Read-only

  logInfo(`USDC Contract: ${usdcAddress}`);
  logInfo(`SolvencyVault Contract: ${solvencyVaultAddress}`);

  // Check current debt
  logSection('Step 3: Check Position & Repayment Schedule');
  
  let schedule;
  try {
    const scheduleResponse = await fetch(`${BACKEND_URL}/solvency/position/${positionId}/schedule`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (scheduleResponse.ok) {
      const data = await scheduleResponse.json();
      schedule = data.schedule;
      
      const nextDue = new Date(schedule.nextPaymentDue * 1000);
      const isOverdue = Date.now() > (schedule.nextPaymentDue * 1000);

      console.log('\n' + '═'.repeat(60));
      log('Repayment Schedule Details', colors.bright + colors.blue);
      console.log(`  Installments Paid:  ${schedule.installmentsPaid} / ${schedule.numberOfInstallments}`);
      console.log(`  Missed Payments:    ${schedule.missedPayments}`);
      console.log(`  Interval:           ${(schedule.installmentInterval / 86400).toFixed(2)} days`);
      console.log(`  Next Payment Due:   ${nextDue.toLocaleString()} ${isOverdue ? colors.red + '(OVERDUE)' + colors.reset : ''}`);
      
      // Calculate suggested installment amount (Debt / Remaining Installments)
      const debtWei = await seniorPoolContract.getOutstandingDebt(positionId);
      const remainingInstallments = schedule.numberOfInstallments - schedule.installmentsPaid;
      
      if (remainingInstallments > 0) {
        const suggestedAmount = debtWei / BigInt(remainingInstallments);
        logInfo(`Suggested Installment: ~$${ethers.formatUnits(suggestedAmount, 6)} USDC`);
      }
      console.log('═'.repeat(60) + '\n');
    }
  } catch (error) {
    logWarning(`Could not fetch schedule from backend: ${error.message}`);
  }

  let debtWei = 0n;
  try {
    debtWei = await seniorPoolContract.getOutstandingDebt(positionId);
    logInfo(`Current Total Outstanding Debt: $${ethers.formatUnits(debtWei, 6)} USDC`);
    
    if (debtWei == 0n) {
      logSuccess('No outstanding debt for this position!');
      process.exit(0);
    }
  } catch (error) {
    logWarning(`Could not fetch debt from chain: ${error.message}`);
  }

  if (!repayAmount) {
    logSection('Info Mode');
    logInfo('No repayment amount provided. See the suggested installment above.');
    console.log('\nTo make a payment, run:');
    console.log(`  INVESTOR_KEY=... node scripts/repay-solvency-loan.js ${positionId} <amount>`);
    process.exit(0);
  }

  // Check USDC balance
  logSection('Step 4: Check USDC Balance & Finalize Amount');
  const usdcBalance = await usdcContract.balanceOf(wallet.address);
  let repayAmountWei = ethers.parseUnits(repayAmount, 6); // USDC 6 decimals

  // CAP repayment to actual debt to avoid "Amount exceeds debt" revert
  if (repayAmountWei > debtWei) {
    logWarning(`Repayment amount ($${repayAmount}) exceeds actual debt ($${ethers.formatUnits(debtWei, 6)})`);
    logInfo('Capping repayment to exactly match outstanding debt...');
    repayAmountWei = debtWei;
  }

  logInfo(`Final Repayment Amount: $${ethers.formatUnits(repayAmountWei, 6)} USDC`);
  logInfo(`Your USDC Balance: $${ethers.formatUnits(usdcBalance, 6)}`);

  if (usdcBalance < repayAmountWei) {
    logError(`Insufficient USDC balance! You have $${ethers.formatUnits(usdcBalance, 6)} but trying to repay $${ethers.formatUnits(repayAmountWei, 6)}`);
    process.exit(1);
  }

  // Approve USDC
  await approveUSDC(wallet, usdcContract, solvencyVaultAddress, repayAmountWei);

  // Repay Loan
  const repayResult = await repayLoan(
    wallet,
    solvencyVaultContract,
    positionId,
    repayAmountWei
  );

  // Sync (informational only as we don't have a direct sync endpoint for repayment)
  await syncRepaymentWithBackend(positionId, repayResult, repayAmount, jwt);

  logSection('✨ Complete!');
  logSuccess(`Position ID: ${positionId}`);
  logSuccess(`Repaid: $${repayAmount} USDC`);
  
  if (repayResult.remainingDebt == 0) {
    logSuccess('🎉 Loan fully repaid!');
    console.log('\nYou can now withdraw your collateral:');
    console.log(`  POST /solvency/withdraw { positionId: "${positionId}", amount: "..." }`);
  } else {
    logInfo(`Remaining Debt: $${ethers.formatUnits(repayResult.remainingDebt, 6)} USDC`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n' + '='.repeat(60));
    logError('Script failed:');
    console.error(error);
    console.error('='.repeat(60));
    process.exit(1);
  });
