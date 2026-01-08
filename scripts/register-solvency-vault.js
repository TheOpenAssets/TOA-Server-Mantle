#!/usr/bin/env node

/**
 * Register SolvencyVault in IdentityRegistry
 *
 * This allows SolvencyVault to hold RWA tokens
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/register-solvency-vault.js
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
  console.log('  DEPLOYER_KEY=0x... node scripts/register-solvency-vault.js');
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
const IDENTITY_REGISTRY_ABI = [
  'function registerIdentity(address wallet) external',
  'function isVerified(address wallet) view returns (bool)',
  'function owner() view returns (address)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Register SolvencyVault in IdentityRegistry', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SolvencyVault: ${contracts.SolvencyVault}`);
  logInfo(`IdentityRegistry: ${contracts.IdentityRegistry}`);

  // Connect to IdentityRegistry
  const identityRegistry = new ethers.Contract(
    contracts.IdentityRegistry,
    IDENTITY_REGISTRY_ABI,
    wallet
  );

  // Check if already registered
  logInfo('Checking current registration status...');
  const isVerified = await identityRegistry.isVerified(contracts.SolvencyVault);

  if (isVerified) {
    logSuccess('SolvencyVault is already registered!');
    process.exit(0);
  }

  logInfo('SolvencyVault is NOT registered. Registering now...');

  // Register SolvencyVault
  try {
    const tx = await identityRegistry.registerIdentity(
      contracts.SolvencyVault
    );

    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation...');

    await tx.wait();

    logSuccess('SolvencyVault registered successfully!');
    logInfo(`Transaction: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

    // Verify registration
    const nowVerified = await identityRegistry.isVerified(contracts.SolvencyVault);
    if (nowVerified) {
      logSuccess('✅ Verification confirmed!');
    } else {
      logError('⚠️  Registration succeeded but verification check failed');
    }

  } catch (error) {
    logError(`Registration failed: ${error.message}`);

    // Check if it's a permission error
    if (error.message.includes('Ownable')) {
      const owner = await identityRegistry.owner();
      logError(`Only the owner can register identities`);
      logInfo(`IdentityRegistry owner: ${owner}`);
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
