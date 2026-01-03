#!/usr/bin/env node

/**
 * Enable Demo Mode on SeniorPool
 *
 * This enables time acceleration for interest accrual
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/enable-demo-mode.js [multiplier]
 *
 * Example:
 *   DEPLOYER_KEY=0x... node scripts/enable-demo-mode.js 360
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const TIME_MULTIPLIER = process.argv[2] || '360'; // Default 360x acceleration

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
  console.log('  DEPLOYER_KEY=0x... node scripts/enable-demo-mode.js [multiplier]');
  console.log('\nExample:');
  console.log('  DEPLOYER_KEY=0x... node scripts/enable-demo-mode.js 360');
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
  'function setDemoMode(bool _enabled, uint256 _multiplier) external',
  'function demoMode() external view returns (bool)',
  'function timeMultiplier() external view returns (uint256)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Enable Demo Mode on SeniorPool', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SeniorPool: ${contracts.SeniorPool}`);
  logInfo(`Time Multiplier: ${TIME_MULTIPLIER}x`);
  console.log();

  // Connect to contract
  const seniorPool = new ethers.Contract(
    contracts.SeniorPool,
    SENIOR_POOL_ABI,
    wallet
  );

  try {
    // Check current demo mode status
    logInfo('Checking current demo mode status...');
    const currentDemoMode = await seniorPool.demoMode();
    const currentMultiplier = await seniorPool.timeMultiplier();
    logInfo(`Current demo mode: ${currentDemoMode}`);
    logInfo(`Current multiplier: ${currentMultiplier}x`);
    console.log();

    // Enable demo mode
    logInfo(`Enabling demo mode with ${TIME_MULTIPLIER}x multiplier...`);
    const tx = await seniorPool.setDemoMode(true, TIME_MULTIPLIER);
    logInfo(`Transaction: ${tx.hash}`);
    await tx.wait();
    logSuccess('Demo mode enabled!');
    console.log();

    // Verify
    const newDemoMode = await seniorPool.demoMode();
    const newMultiplier = await seniorPool.timeMultiplier();
    logSuccess(`Demo mode: ${newDemoMode}`);
    logSuccess(`Time multiplier: ${newMultiplier}x`);
    logSuccess(`Interest will accrue ${newMultiplier}x faster!`);

  } catch (error) {
    logError(`Failed to enable demo mode: ${error.message}`);
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
