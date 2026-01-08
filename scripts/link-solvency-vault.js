#!/usr/bin/env node

/**
 * Link SolvencyVault to SeniorPool
 *
 * This authorizes SolvencyVault to borrow from SeniorPool
 *
 * NOTE: This can only be called ONCE due to security restrictions.
 * If SeniorPool already has a SolvencyVault set, you must redeploy SeniorPool.
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/link-solvency-vault.js
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;

// Colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
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
if (!DEPLOYER_KEY) {
  logError('DEPLOYER_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  DEPLOYER_KEY=0x... node scripts/link-solvency-vault.js');
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

// ABI
const SENIOR_POOL_ABI = [
  'function setSolvencyVault(address _solvencyVault) external',
  'function solvencyVault() external view returns (address)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Link SolvencyVault to SeniorPool', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SeniorPool: ${contracts.SeniorPool}`);
  logInfo(`SolvencyVault: ${contracts.SolvencyVault}`);
  console.log();

  // Connect to SeniorPool
  const seniorPool = new ethers.Contract(
    contracts.SeniorPool,
    SENIOR_POOL_ABI,
    wallet
  );

  try {
    // Check current SolvencyVault
    logInfo('Checking current SolvencyVault link...');
    const currentVault = await seniorPool.solvencyVault();

    if (currentVault !== ethers.ZeroAddress) {
      logWarning(`SeniorPool already linked to: ${currentVault}`);

      if (currentVault.toLowerCase() === contracts.SolvencyVault.toLowerCase()) {
        logSuccess('SolvencyVault is already linked correctly!');
        process.exit(0);
      } else {
        logError('SeniorPool is linked to a different SolvencyVault!');
        logError('Due to security restrictions, setSolvencyVault() can only be called once.');
        logError('\nTo fix this, you must:');
        logError('  1. Redeploy SeniorPool');
        logError('  2. Re-add liquidity');
        logError('  3. Re-enable demo mode');
        logError('  4. Run this script again');
        process.exit(1);
      }
    }

    logInfo('No SolvencyVault linked. Linking now...');
    console.log();

    // Link SolvencyVault
    logInfo(`Calling setSolvencyVault(${contracts.SolvencyVault})...`);
    const tx = await seniorPool.setSolvencyVault(contracts.SolvencyVault);
    logInfo(`Transaction: ${tx.hash}`);
    logInfo('Waiting for confirmation...');
    await tx.wait();
    logSuccess('SolvencyVault linked successfully!');
    console.log();

    // Verify
    const newVault = await seniorPool.solvencyVault();
    if (newVault.toLowerCase() === contracts.SolvencyVault.toLowerCase()) {
      logSuccess('✅ Link verified!');
      logSuccess(`SeniorPool → SolvencyVault: ${newVault}`);
    } else {
      logError('⚠️  Link failed verification');
    }

  } catch (error) {
    logError(`Failed to link SolvencyVault: ${error.message}`);

    if (error.message.includes('SolvencyVault already set')) {
      logError('\nSeniorPool already has a SolvencyVault set.');
      logError('This is a one-time operation for security reasons.');
      logError('You must redeploy SeniorPool to change it.');
    }

    throw error;
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
