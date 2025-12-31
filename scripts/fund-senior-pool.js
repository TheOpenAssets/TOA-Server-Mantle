#!/usr/bin/env node

/**
 * Fund SeniorPool with USDC Liquidity
 *
 * This adds liquidity to the SeniorPool so it can lend to LeverageVault
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/fund-senior-pool.js [amount]
 *
 * Example:
 *   DEPLOYER_KEY=0x... node scripts/fund-senior-pool.js 500000
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const AMOUNT = process.argv[2] || '500000'; // Default 500k USDC

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
  console.log('  DEPLOYER_KEY=0x... node scripts/fund-senior-pool.js [amount]');
  console.log('\nExample:');
  console.log('  DEPLOYER_KEY=0x... node scripts/fund-senior-pool.js 500000');
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

// ABIs
const USDC_ABI = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

const SENIOR_POOL_ABI = [
  'function depositLiquidity(uint256 amount) external',
  'function getPoolStats() external view returns (uint256, uint256, uint256, uint256)',
  'function totalLiquidity() external view returns (uint256)',
  'function totalBorrowed() external view returns (uint256)',
  'function getAvailableLiquidity() external view returns (uint256)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Fund SeniorPool with USDC Liquidity', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`SeniorPool: ${contracts.SeniorPool}`);
  logInfo(`USDC: ${contracts.USDC}`);
  logInfo(`Amount to deposit: ${AMOUNT} USDC`);

  // Connect to contracts
  const usdc = new ethers.Contract(contracts.USDC, USDC_ABI, wallet);
  const seniorPool = new ethers.Contract(
    contracts.SeniorPool,
    SENIOR_POOL_ABI,
    wallet
  );

  const amountWei = ethers.parseUnits(AMOUNT, 6); // USDC has 6 decimals

  try {
    // Check current liquidity
    logInfo('Checking current SeniorPool liquidity...');
    const [currentLiquidity, borrowed, available, interestEarned] = await seniorPool.getPoolStats();
    logInfo(`Current total liquidity: ${ethers.formatUnits(currentLiquidity, 6)} USDC`);
    logInfo(`Current borrowed: ${ethers.formatUnits(borrowed, 6)} USDC`);
    logInfo(`Current available liquidity: ${ethers.formatUnits(available, 6)} USDC`);
    console.log();

    // Step 1: Mint USDC
    logInfo(`Step 1: Minting ${AMOUNT} USDC to deployer...`);
    const mintTx = await usdc.mint(wallet.address, amountWei);
    logInfo(`Transaction: ${mintTx.hash}`);
    await mintTx.wait();
    logSuccess('USDC minted!');

    const balance = await usdc.balanceOf(wallet.address);
    logInfo(`Your USDC balance: ${ethers.formatUnits(balance, 6)} USDC`);
    console.log();

    // Step 2: Approve SeniorPool
    logInfo(`Step 2: Approving SeniorPool to spend ${AMOUNT} USDC...`);
    const approveTx = await usdc.approve(contracts.SeniorPool, amountWei);
    logInfo(`Transaction: ${approveTx.hash}`);
    await approveTx.wait();
    logSuccess('USDC approved!');
    console.log();

    // Step 3: Deposit to SeniorPool
    logInfo(`Step 3: Depositing ${AMOUNT} USDC to SeniorPool...`);
    const depositTx = await seniorPool.depositLiquidity(amountWei);
    logInfo(`Transaction: ${depositTx.hash}`);
    logInfo('Waiting for confirmation...');
    await depositTx.wait();
    logSuccess('Liquidity deposited successfully!');
    logInfo(`Transaction: https://explorer.sepolia.mantle.xyz/tx/${depositTx.hash}`);
    console.log();

    // Verify new liquidity
    const [newLiquidity, newBorrowed, newAvailable, newInterest] = await seniorPool.getPoolStats();
    logSuccess(`New total liquidity: ${ethers.formatUnits(newLiquidity, 6)} USDC`);
    logSuccess(`New available liquidity: ${ethers.formatUnits(newAvailable, 6)} USDC`);

  } catch (error) {
    logError(`Failed to fund SeniorPool: ${error.message}`);
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
