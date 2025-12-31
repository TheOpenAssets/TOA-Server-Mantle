#!/usr/bin/env node

/**
 * Fund MockFluxionDEX with Liquidity
 *
 * This adds USDC and mETH to the DEX for swaps
 *
 * Usage:
 *   DEPLOYER_KEY=0x... node scripts/fund-dex.js [usdc_amount] [meth_amount]
 *
 * Example:
 *   DEPLOYER_KEY=0x... node scripts/fund-dex.js 1000000 500
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;
const USDC_AMOUNT = process.argv[2] || '1000000'; // Default 1M USDC
const METH_AMOUNT = process.argv[3] || '500'; // Default 500 mETH

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
  console.log('  DEPLOYER_KEY=0x... node scripts/fund-dex.js [usdc_amount] [meth_amount]');
  console.log('\nExample:');
  console.log('  DEPLOYER_KEY=0x... node scripts/fund-dex.js 1000000 500');
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
  'function balanceOf(address account) external view returns (uint256)',
];

const METH_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  log('Fund MockFluxionDEX with Liquidity', colors.cyan);
  console.log('='.repeat(60));

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);

  logInfo(`Deployer Address: ${wallet.address}`);
  logInfo(`MockFluxionDEX: ${contracts.MockFluxionDEX}`);
  logInfo(`USDC: ${contracts.USDC}`);
  logInfo(`MockMETH: ${contracts.MockMETH}`);
  logInfo(`USDC amount: ${USDC_AMOUNT} USDC`);
  logInfo(`mETH amount: ${METH_AMOUNT} mETH`);
  console.log();

  // Connect to contracts
  const usdc = new ethers.Contract(contracts.USDC, USDC_ABI, wallet);
  const mockMETH = new ethers.Contract(contracts.MockMETH, METH_ABI, wallet);

  const usdcWei = ethers.parseUnits(USDC_AMOUNT, 6); // USDC has 6 decimals
  const methWei = ethers.parseEther(METH_AMOUNT); // mETH has 18 decimals

  try {
    // Step 1: Mint USDC to DEX
    logInfo(`Step 1: Minting ${USDC_AMOUNT} USDC to DEX...`);
    const mintUsdcTx = await usdc.mint(contracts.MockFluxionDEX, usdcWei);
    logInfo(`Transaction: ${mintUsdcTx.hash}`);
    await mintUsdcTx.wait();
    logSuccess('USDC minted!');

    const usdcBalance = await usdc.balanceOf(contracts.MockFluxionDEX);
    logInfo(`DEX USDC balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
    console.log();

    // Step 2: Mint mETH to DEX
    logInfo(`Step 2: Minting ${METH_AMOUNT} mETH to DEX...`);
    const mintMethTx = await mockMETH.mint(contracts.MockFluxionDEX, methWei);
    logInfo(`Transaction: ${mintMethTx.hash}`);
    await mintMethTx.wait();
    logSuccess('mETH minted!');

    const methBalance = await mockMETH.balanceOf(contracts.MockFluxionDEX);
    logInfo(`DEX mETH balance: ${ethers.formatEther(methBalance)} mETH`);
    console.log();

    logSuccess('DEX funded successfully!');
    logSuccess(`USDC: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
    logSuccess(`mETH: ${ethers.formatEther(methBalance)} mETH`);

  } catch (error) {
    logError(`Failed to fund DEX: ${error.message}`);
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
