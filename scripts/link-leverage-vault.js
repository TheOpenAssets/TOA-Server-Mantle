#!/usr/bin/env node

/**
 * Link LeverageVault to SeniorPool
 *
 * This authorizes LeverageVault to borrow from SeniorPool
 *
 * NOTE: This can only be called ONCE due to security restrictions.
 * If SeniorPool already has a LeverageVault set, you must redeploy SeniorPool.
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/link-leverage-vault.js
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
  console.log('  DEPLOYER_KEY=0x... node scripts/link-leverage-vault.js');
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
  'function setLeverageVault(address _leverageVault) external',
  'function leverageVault() external view returns (address)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Link LeverageVault to SeniorPool', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SeniorPool: ${contracts.SeniorPool}`);
  logInfo(`LeverageVault: ${contracts.LeverageVault}`);
  console.log();

  // Connect to SeniorPool
  const seniorPool = new ethers.Contract(
    contracts.SeniorPool,
    SENIOR_POOL_ABI,
    wallet
  );

  try {
    // Check current LeverageVault
    logInfo('Checking current LeverageVault link...');
    const currentVault = await seniorPool.leverageVault();

    if (currentVault !== ethers.ZeroAddress) {
      logWarning(`SeniorPool already linked to: ${currentVault}`);

      if (currentVault === contracts.LeverageVault) {
        logSuccess('LeverageVault is already linked correctly!');
        process.exit(0);
      } else {
        logError('SeniorPool is linked to a different LeverageVault!');
        logError('Due to security restrictions, setLeverageVault() can only be called once.');
        logError('\nTo fix this, you must:');
        logError('  1. Redeploy SeniorPool');
        logError('  2. Re-add liquidity');
        logError('  3. Re-enable demo mode');
        logError('  4. Run this script again');
        process.exit(1);
      }
    }

    logInfo('No LeverageVault linked. Linking now...');
    console.log();

    // Link LeverageVault
    logInfo(`Calling setLeverageVault(${contracts.LeverageVault})...`);
    const tx = await seniorPool.setLeverageVault(contracts.LeverageVault);
    logInfo(`Transaction: ${tx.hash}`);
    logInfo('Waiting for confirmation...');
    await tx.wait();
    logSuccess('LeverageVault linked successfully!');
    console.log();

    // Verify
    const newVault = await seniorPool.leverageVault();
    if (newVault === contracts.LeverageVault) {
      logSuccess('✅ Link verified!');
      logSuccess(`SeniorPool → LeverageVault: ${newVault}`);
    } else {
      logError('⚠️  Link failed verification');
    }

  } catch (error) {
    logError(`Failed to link LeverageVault: ${error.message}`);

    if (error.message.includes('LeverageVault already set')) {
      logError('\nSeniorPool already has a LeverageVault set.');
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
