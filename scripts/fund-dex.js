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
  'function approve(address spender, uint256 amount) external returns (bool)',
];

const METH_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
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

  const DEX_ABI = [
    'function addLiquidity(uint256 mETHAmount, uint256 usdcAmount) external',
    'function getReserves() external view returns (uint256, uint256)',
  ];

  const dex = new ethers.Contract(contracts.MockFluxionDEX, DEX_ABI, wallet);

  try {
    // Step 1: Mint USDC to deployer
    logInfo(`Step 1: Minting ${USDC_AMOUNT} USDC to deployer...`);
    const mintUsdcTx = await usdc.mint(wallet.address, usdcWei);
    logInfo(`Transaction: ${mintUsdcTx.hash}`);
    await mintUsdcTx.wait();
    logSuccess('USDC minted!');
    console.log();

    // Step 2: Mint mETH to deployer
    logInfo(`Step 2: Minting ${METH_AMOUNT} mETH to deployer...`);
    const mintMethTx = await mockMETH.mint(wallet.address, methWei);
    logInfo(`Transaction: ${mintMethTx.hash}`);
    await mintMethTx.wait();
    logSuccess('mETH minted!');
    console.log();

    // Step 3: Approve DEX to spend USDC
    logInfo(`Step 3: Approving DEX to spend ${USDC_AMOUNT} USDC...`);
    const approveUsdcTx = await usdc.approve(contracts.MockFluxionDEX, usdcWei);
    logInfo(`Transaction: ${approveUsdcTx.hash}`);
    await approveUsdcTx.wait();
    logSuccess('USDC approved!');
    console.log();

    // Step 4: Approve DEX to spend mETH
    logInfo(`Step 4: Approving DEX to spend ${METH_AMOUNT} mETH...`);
    const approveMethTx = await mockMETH.approve(contracts.MockFluxionDEX, methWei);
    logInfo(`Transaction: ${approveMethTx.hash}`);
    await approveMethTx.wait();
    logSuccess('mETH approved!');
    console.log();

    // Step 5: Add liquidity to DEX
    logInfo(`Step 5: Adding liquidity to DEX (${METH_AMOUNT} mETH + ${USDC_AMOUNT} USDC)...`);
    const addLiquidityTx = await dex.addLiquidity(methWei, usdcWei);
    logInfo(`Transaction: ${addLiquidityTx.hash}`);
    await addLiquidityTx.wait();
    logSuccess('Liquidity added!');
    console.log();

    // Verify reserves
    const [methReserve, usdcReserve] = await dex.getReserves();
    logSuccess(`DEX Reserves:`);
    logSuccess(`  mETH: ${ethers.formatEther(methReserve)} mETH`);
    logSuccess(`  USDC: ${ethers.formatUnits(usdcReserve, 6)} USDC`);

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
