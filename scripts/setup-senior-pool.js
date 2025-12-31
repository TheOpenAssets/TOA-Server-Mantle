#!/usr/bin/env node

/**
 * Setup SeniorPool - Register LeverageVault
 *
 * This allows LeverageVault to borrow USDC from SeniorPool
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/setup-senior-pool.js
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

// Validation
if (!DEPLOYER_KEY) {
  logError('DEPLOYER_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  DEPLOYER_KEY=0x... node scripts/setup-senior-pool.js');
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
  'function leverageVault() view returns (address)',
  'function owner() view returns (address)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Setup SeniorPool - Register LeverageVault', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SeniorPool: ${contracts.SeniorPool}`);
  logInfo(`LeverageVault: ${contracts.LeverageVault}`);

  // Connect to SeniorPool
  const seniorPool = new ethers.Contract(
    contracts.SeniorPool,
    SENIOR_POOL_ABI,
    wallet
  );

  // Check if already registered
  logInfo('Checking current registration status...');
  const currentVault = await seniorPool.leverageVault();

  if (currentVault !== ethers.ZeroAddress && currentVault !== '0x0000000000000000000000000000000000000000') {
    logSuccess(`LeverageVault is already registered: ${currentVault}`);

    if (currentVault.toLowerCase() === contracts.LeverageVault.toLowerCase()) {
      logSuccess('Configuration is correct!');
      process.exit(0);
    } else {
      logError('⚠️  Different LeverageVault address is registered!');
      logError(`Expected: ${contracts.LeverageVault}`);
      logError(`Current: ${currentVault}`);
      process.exit(1);
    }
  }

  logInfo('LeverageVault is NOT registered. Registering now...');

  // Register LeverageVault
  try {
    const tx = await seniorPool.setLeverageVault(contracts.LeverageVault);

    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation...');

    await tx.wait();

    logSuccess('LeverageVault registered successfully!');
    logInfo(`Transaction: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

    // Verify registration
    const newVault = await seniorPool.leverageVault();
    if (newVault.toLowerCase() === contracts.LeverageVault.toLowerCase()) {
      logSuccess('✅ Registration verified!');
    } else {
      logError('⚠️  Registration succeeded but verification check failed');
    }

  } catch (error) {
    logError(`Registration failed: ${error.message}`);

    // Check if it's a permission error
    if (error.message.includes('Ownable') || error.message.includes('Only owner')) {
      const owner = await seniorPool.owner();
      logError(`Only the owner can register LeverageVault`);
      logInfo(`SeniorPool owner: ${owner}`);
      logInfo(`Your address: ${wallet.address}`);
      logInfo('Make sure you are using the deployer key');
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
