#!/usr/bin/env node

/**
 * Partner Loan Repayment with Transfer Verification
 *
 * This script demonstrates the recommended repayment flow:
 * 1. User sends USDC to platform wallet
 * 2. Partner verifies and processes repayment via API
 *
 * Usage:
 *   # Step 1: User sends USDC (run with user's wallet)
 *   USER_KEY=0x... node scripts/partner-repay-with-transfer.js send <partner_loan_id> <amount_usdc>
 *
 *   # Step 2: Partner processes repayment (run with partner API key)
 *   PARTNER_API_KEY=pk_... node scripts/partner-repay-with-transfer.js process <partner_loan_id> <amount_usdc> <tx_hash> <user_wallet>
 *
 * Examples:
 *   USER_KEY=0x123... node scripts/partner-repay-with-transfer.js send xyz_loan_001 100
 *   PARTNER_API_KEY=pk_xyz... node scripts/partner-repay-with-transfer.js process xyz_loan_001 100 0xabc... 0x580F5b...
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
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

// ERC20 ABI
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

/**
 * Step 1: User sends USDC to platform wallet
 */
async function sendUSDCToPlatform(partnerLoanId, amountUSDC) {
  const USER_KEY = process.env.USER_KEY;

  if (!USER_KEY) {
    logError('USER_KEY environment variable is required');
    console.log('\nUsage:');
    console.log('  USER_KEY=0x... node scripts/partner-repay-with-transfer.js send <partner_loan_id> <amount_usdc>');
    process.exit(1);
  }

  logSection('Step 1: User Sends USDC to Platform');

  console.log('\n📝 Configuration:');
  console.log(`  Partner Loan ID: ${partnerLoanId}`);
  console.log(`  Repayment Amount: $${amountUSDC} USDC`);
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  RPC URL: ${RPC_URL}`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const userWallet = new ethers.Wallet(USER_KEY, provider);

  logInfo(`User Address: ${userWallet.address}`);

  // Get platform wallet address from backend
  logSection('Get Platform Wallet Address');

  // For this demo, we'll use the deployer address as platform wallet
  // In production, fetch this from /partners/public/platform-info endpoint
  const platformWalletAddress = deployed.deployer;
  logInfo(`Platform Wallet: ${platformWalletAddress}`);

  // Connect to USDC contract
  const usdcAddress = contracts.USDC;
  const usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, userWallet);

  const symbol = await usdcContract.symbol();
  const decimals = await usdcContract.decimals();

  logInfo(`USDC Contract: ${usdcAddress}`);
  logInfo(`Symbol: ${symbol}, Decimals: ${decimals}`);

  // Check balance
  logSection('Check USDC Balance');
  const balance = await usdcContract.balanceOf(userWallet.address);
  const balanceFormatted = ethers.formatUnits(balance, decimals);

  logInfo(`Your Balance: ${balanceFormatted} ${symbol}`);

  const amountWei = ethers.parseUnits(amountUSDC, decimals);

  if (balance < amountWei) {
    logError(`Insufficient balance! You have ${balanceFormatted} ${symbol} but need ${amountUSDC}`);
    process.exit(1);
  }

  // Send USDC
  logSection('Send USDC to Platform Wallet');

  logInfo(`Sending ${amountUSDC} ${symbol} to ${platformWalletAddress}...`);

  const tx = await usdcContract.transfer(platformWalletAddress, amountWei);

  logInfo(`Transaction submitted: ${tx.hash}`);
  logInfo('Waiting for confirmation...');

  const receipt = await tx.wait();

  logSuccess(`Transfer confirmed in block ${receipt.blockNumber}`);
  logInfo(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

  // Display summary
  logSection('✨ Transfer Complete!');
  console.log('\n📋 Summary:');
  console.log(`  Partner Loan ID:    ${partnerLoanId}`);
  console.log(`  Amount Sent:        ${amountUSDC} ${symbol}`);
  console.log(`  From:               ${userWallet.address}`);
  console.log(`  To (Platform):      ${platformWalletAddress}`);
  console.log(`  Transaction Hash:   ${tx.hash}`);
  console.log(`  Block Number:       ${receipt.blockNumber}`);

  console.log('\n' + '─'.repeat(60));
  log('Next Step: Partner processes repayment', colors.bright + colors.magenta);
  console.log('─'.repeat(60));
  console.log('\nRun the following command:');
  console.log(colors.yellow + `PARTNER_API_KEY=pk_... node scripts/partner-repay-with-transfer.js process \\` + colors.reset);
  console.log(colors.yellow + `  ${partnerLoanId} \\` + colors.reset);
  console.log(colors.yellow + `  ${amountUSDC} \\` + colors.reset);
  console.log(colors.yellow + `  ${tx.hash} \\` + colors.reset);
  console.log(colors.yellow + `  ${userWallet.address}` + colors.reset);
  console.log('');
}

/**
 * Step 2: Partner processes repayment with transfer verification
 */
async function processRepayment(partnerLoanId, amountUSDC, transferTxHash, userWallet) {
  const PARTNER_API_KEY = process.env.PARTNER_API_KEY;

  if (!PARTNER_API_KEY) {
    logError('PARTNER_API_KEY environment variable is required');
    console.log('\nUsage:');
    console.log('  PARTNER_API_KEY=pk_... node scripts/partner-repay-with-transfer.js process <loan_id> <amount> <tx_hash> <user_wallet>');
    process.exit(1);
  }

  logSection('Step 2: Partner Processes Repayment');

  console.log('\n📝 Configuration:');
  console.log(`  Partner Loan ID:    ${partnerLoanId}`);
  console.log(`  Repayment Amount:   $${amountUSDC} USDC`);
  console.log(`  Transfer Tx Hash:   ${transferTxHash}`);
  console.log(`  User Wallet:        ${userWallet}`);
  console.log(`  Backend URL:        ${BACKEND_URL}`);

  // Convert amount to Wei (6 decimals for USDC)
  const amountWei = ethers.parseUnits(amountUSDC, 6).toString();

  // Call partner repay-with-transfer endpoint
  logSection('Call Partner API');

  const payload = {
    partnerLoanId,
    repaymentAmount: amountWei,
    transferTxHash,
    userWallet,
  };

  logInfo('Request payload:');
  console.log(JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(`${BACKEND_URL}/partners/repay-with-transfer`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PARTNER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      logError(`API call failed: ${response.status} ${response.statusText}`);
      console.log('\nError details:');
      console.log(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    logSuccess('Repayment processed successfully!');

    // Display results
    logSection('✨ Repayment Complete!');

    console.log('\n📋 Results:');
    console.log(`  Loan Status:              ${data.loanStatus}`);
    console.log(`  Remaining Debt:           $${(Number(data.remainingDebt) / 1e6).toFixed(2)} USDC`);
    console.log(`  User Transfer Tx:         ${data.userTransferTxHash}`);
    console.log(`  Contract Repayment Tx:    ${data.contractRepayTxHash}`);
    console.log(`  Message:                  ${data.message}`);

    console.log('\n🔗 Explorer Links:');
    console.log(`  User Transfer:    https://explorer.sepolia.mantle.xyz/tx/${data.userTransferTxHash}`);
    console.log(`  Contract Repay:   https://explorer.sepolia.mantle.xyz/tx/${data.contractRepayTxHash}`);

    if (data.loanStatus === 'REPAID') {
      console.log('\n' + '🎉'.repeat(20));
      logSuccess('  LOAN FULLY REPAID!  ');
      console.log('🎉'.repeat(20) + '\n');
    } else {
      console.log('');
      logInfo(`Remaining debt: $${(Number(data.remainingDebt) / 1e6).toFixed(2)} USDC`);
      logInfo('User can make additional payments to fully repay the loan.');
    }

  } catch (error) {
    logError(`Request failed: ${error.message}`);
    throw error;
  }
}

/**
 * Query loan details
 */
async function queryLoanDetails(partnerLoanId) {
  const PARTNER_API_KEY = process.env.PARTNER_API_KEY;

  if (!PARTNER_API_KEY) {
    logError('PARTNER_API_KEY environment variable is required');
    process.exit(1);
  }

  logSection('Query Loan Details');

  try {
    const response = await fetch(`${BACKEND_URL}/partners/loan/${partnerLoanId}`, {
      headers: {
        'Authorization': `Bearer ${PARTNER_API_KEY}`,
      },
    });

    const loan = await response.json();

    if (!response.ok) {
      logError(`API call failed: ${response.status}`);
      console.log(JSON.stringify(loan, null, 2));
      process.exit(1);
    }

    console.log('\n📋 Loan Details:');
    console.log(`  Partner Loan ID:      ${loan.partnerLoanId}`);
    console.log(`  Internal Loan ID:     ${loan.internalLoanId}`);
    console.log(`  Partner:              ${loan.partnerName}`);
    console.log(`  User Wallet:          ${loan.userWallet}`);
    console.log(`  OAID Token ID:        ${loan.oaidTokenId}`);
    console.log(`  Principal:            $${(Number(loan.principalAmount) / 1e6).toFixed(2)} USDC`);
    console.log(`  Remaining Debt:       $${(Number(loan.remainingDebt) / 1e6).toFixed(2)} USDC`);
    console.log(`  Total Repaid:         $${(Number(loan.totalRepaid) / 1e6).toFixed(2)} USDC`);
    console.log(`  Status:               ${loan.status}`);
    console.log(`  Borrowed At:          ${new Date(loan.borrowedAt).toLocaleString()}`);

    if (loan.repaymentHistory && loan.repaymentHistory.length > 0) {
      console.log('\n📜 Repayment History:');
      loan.repaymentHistory.forEach((payment, i) => {
        console.log(`  ${i + 1}. $${(Number(payment.amount) / 1e6).toFixed(2)} USDC on ${new Date(payment.timestamp).toLocaleDateString()}`);
        console.log(`     Tx: ${payment.txHash}`);
        console.log(`     By: ${payment.repaidBy}`);
      });
    }

  } catch (error) {
    logError(`Request failed: ${error.message}`);
    throw error;
  }
}

// Main
async function main() {
  const command = process.argv[2];

  if (!command) {
    console.log('Partner Loan Repayment Script\n');
    console.log('Usage:');
    console.log('  # Step 1: User sends USDC');
    console.log('  USER_KEY=0x... node scripts/partner-repay-with-transfer.js send <loan_id> <amount>\n');
    console.log('  # Step 2: Partner processes repayment');
    console.log('  PARTNER_API_KEY=pk_... node scripts/partner-repay-with-transfer.js process <loan_id> <amount> <tx_hash> <user_wallet>\n');
    console.log('  # Query loan details');
    console.log('  PARTNER_API_KEY=pk_... node scripts/partner-repay-with-transfer.js query <loan_id>\n');
    process.exit(1);
  }

  try {
    if (command === 'send') {
      const partnerLoanId = process.argv[3];
      const amountUSDC = process.argv[4];

      if (!partnerLoanId || !amountUSDC) {
        logError('Missing arguments: loan_id and amount required');
        process.exit(1);
      }

      await sendUSDCToPlatform(partnerLoanId, amountUSDC);

    } else if (command === 'process') {
      const partnerLoanId = process.argv[3];
      const amountUSDC = process.argv[4];
      const transferTxHash = process.argv[5];
      const userWallet = process.argv[6];

      if (!partnerLoanId || !amountUSDC || !transferTxHash || !userWallet) {
        logError('Missing arguments: loan_id, amount, tx_hash, and user_wallet required');
        process.exit(1);
      }

      await processRepayment(partnerLoanId, amountUSDC, transferTxHash, userWallet);

    } else if (command === 'query') {
      const partnerLoanId = process.argv[3];

      if (!partnerLoanId) {
        logError('Missing argument: loan_id required');
        process.exit(1);
      }

      await queryLoanDetails(partnerLoanId);

    } else {
      logError(`Unknown command: ${command}`);
      console.log('Valid commands: send, process, query');
      process.exit(1);
    }

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    logError('Script failed:');
    console.error(error);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
