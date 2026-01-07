#!/usr/bin/env node

/**
 * Admin Script: Mark Missed Payment for Solvency Position
 *
 * Usage:
 *   ADMIN_KEY=0x... node scripts/admin-mark-missed-payment.js <position_id>
 *
 * Example:
 *   ADMIN_KEY=0x... node scripts/admin-mark-missed-payment.js 1
 *
 * This script will:
 * 1. Connect to SolvencyVault using Admin wallet
 * 2. Call markMissedPayment(positionId)
 * 3. Log the result
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const ADMIN_KEY = process.env.ADMIN_KEY;

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

// Validation
if (!ADMIN_KEY) {
  logError('ADMIN_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/admin-mark-missed-payment.js <position_id>');
  process.exit(1);
}

const positionId = process.argv[2];

if (!positionId) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/admin-mark-missed-payment.js <position_id>');
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
const solvencyVaultAddress = contracts.SolvencyVault;

const SOLVENCY_VAULT_ABI = [
  'function markMissedPayment(uint256 positionId) external',
  'event MissedPaymentMarked(uint256 indexed positionId, uint256 missedPayments)'
];

async function main() {
  logSection('Admin: Mark Missed Payment');

  console.log('\n📝 Configuration:');
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Position ID: ${positionId}`);
  console.log(`  Solvency Vault: ${solvencyVaultAddress}`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);

  logInfo(`Admin Address: ${wallet.address}`);

  // Connect to contract
  const solvencyVaultContract = new ethers.Contract(solvencyVaultAddress, SOLVENCY_VAULT_ABI, wallet);

  logSection('Executing Transaction');
  logInfo(`Calling markMissedPayment(${positionId})...`);

  try {
    const tx = await solvencyVaultContract.markMissedPayment(positionId);
    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation...');

    const receipt = await tx.wait();
    logSuccess(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Check logs
    for (const log of receipt.logs) {
      try {
        const parsed = solvencyVaultContract.interface.parseLog(log);
        if (parsed.name === 'MissedPaymentMarked') {
          const missedCount = parsed.args.missedPayments;
          logSuccess(`Missed Payment Marked! Total Missed: ${missedCount}`);
          break;
        }
      } catch (e) {
        // ignore
      }
    }

  } catch (error) {
    logError(`Transaction failed: ${error.message}`);
    if (error.message.includes('Position not active')) {
      logInfo('Reason: Position is not active.');
    } else if (error.message.includes('Plan not active')) {
      logInfo('Reason: Repayment plan is not active (maybe fully repaid?).');
    }
    process.exit(1);
  }

  logSection('✨ Complete!');
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
