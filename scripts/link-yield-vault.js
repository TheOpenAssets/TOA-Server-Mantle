#!/usr/bin/env node

/**
 * Link YieldVault to LeverageVault
 *
 * This sets the YieldVault address in LeverageVault so it can burn tokens and claim yield
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/link-yield-vault.js
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
  console.log('  DEPLOYER_KEY=0x... node scripts/link-yield-vault.js');
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
const LEVERAGE_VAULT_ABI = [
  'function setYieldVault(address _yieldVault) external',
  'function yieldVault() external view returns (address)',
  'function owner() external view returns (address)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Link YieldVault to LeverageVault', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`LeverageVault: ${contracts.LeverageVault}`);
  logInfo(`YieldVault: ${contracts.YieldVault}`);
  console.log();

  // Connect to LeverageVault
  const leverageVault = new ethers.Contract(
    contracts.LeverageVault,
    LEVERAGE_VAULT_ABI,
    wallet
  );

  try {
    // Verify ownership
    logInfo('Verifying ownership...');
    const owner = await leverageVault.owner();
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      logError(`You are not the owner of LeverageVault!`);
      logError(`Owner: ${owner}`);
      logError(`Your address: ${wallet.address}`);
      process.exit(1);
    }
    logSuccess('Ownership verified!');
    console.log();

    // Check current YieldVault
    logInfo('Checking current YieldVault link...');
    const currentYieldVault = await leverageVault.yieldVault();

    if (currentYieldVault !== ethers.ZeroAddress) {
      logWarning(`LeverageVault already linked to: ${currentYieldVault}`);

      if (currentYieldVault.toLowerCase() === contracts.YieldVault.toLowerCase()) {
        logSuccess('YieldVault is already linked correctly!');
        process.exit(0);
      } else {
        logWarning('LeverageVault is linked to a different YieldVault!');
        logInfo('Updating to new YieldVault address...');
      }
    } else {
      logInfo('No YieldVault linked. Linking now...');
    }
    console.log();

    // Link YieldVault
    logInfo(`Calling setYieldVault(${contracts.YieldVault})...`);
    const tx = await leverageVault.setYieldVault(contracts.YieldVault);
    logInfo(`Transaction: ${tx.hash}`);
    logInfo('Waiting for confirmation...');
    await tx.wait();
    logSuccess('YieldVault linked successfully!');
    console.log();

    // Verify
    const newYieldVault = await leverageVault.yieldVault();
    if (newYieldVault.toLowerCase() === contracts.YieldVault.toLowerCase()) {
      logSuccess('✅ Link verified!');
      logSuccess(`LeverageVault → YieldVault: ${newYieldVault}`);
    } else {
      logError('⚠️  Link failed verification');
      logError(`Expected: ${contracts.YieldVault}`);
      logError(`Got: ${newYieldVault}`);
    }

  } catch (error) {
    logError(`Failed to link YieldVault: ${error.message}`);
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
