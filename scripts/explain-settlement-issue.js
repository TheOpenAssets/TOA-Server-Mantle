#!/usr/bin/env node

/**
 * Manual Settlement Workaround
 * Since the deployed YieldVault.claimYield() doesn't return a value,
 * but SolvencyVault expects it to, we'll manually perform the settlement steps.
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const ADMIN_KEY = process.env.ADMIN_KEY;

if (!ADMIN_KEY) {
  console.error('❌ Please set ADMIN_KEY environment variable');
  process.exit(1);
}

const SOLVENCY_VAULT_ADDRESS = deployedContracts.contracts.SolvencyVault;
const YIELD_VAULT_ADDRESS = deployedContracts.contracts.YieldVault;
const SENIOR_POOL_ADDRESS = deployedContracts.contracts.SeniorPool;

const SOLVENCY_VAULT_ABI = [
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, uint256 liquidatedAt, uint256 creditLineId, bool active, uint8 tokenType)',
  'function positionsInLiquidation(uint256) view returns (bool)',
  'function usdc() view returns (address)',
  // We'll call these functions directly as owner
  'function manualSettleStep1_ApproveYieldVault(uint256 positionId) external',
  'function manualSettleStep2_ClosePosition(uint256 positionId, uint256 yieldReceived) external',
];

const YIELD_VAULT_ABI = [
  'function claimYield(address tokenAddress, uint256 tokenAmount) external',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
];

const SENIOR_POOL_ABI = [
  'function getOutstandingDebt(uint256) view returns (uint256)',
  'function repay(uint256 positionId, uint256 amount) external returns (uint256, uint256)',
];

async function main() {
  const positionId = parseInt(process.argv[2] || '1');

  console.log('\n============================================================');
  console.log('Manual Liquidation Settlement Workaround');
  console.log('============================================================\n');
  console.log('This script works around the interface mismatch between');
  console.log('YieldVault (no return value) and SolvencyVault (expects return).\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);

  console.log('Admin:', wallet.address);
  console.log('Position ID:', positionId);
  console.log('Solvency Vault:', SOLVENCY_VAULT_ADDRESS);
  console.log('Yield Vault:', YIELD_VAULT_ADDRESS);

  const solvencyVault = new ethers.Contract(SOLVENCY_VAULT_ADDRESS, SOLVENCY_VAULT_ABI, provider);
  const yieldVault = new ethers.Contract(YIELD_VAULT_ADDRESS, YIELD_VAULT_ABI, wallet);
  const seniorPool = new ethers.Contract(SENIOR_POOL_ADDRESS, SENIOR_POOL_ABI, wallet);

  console.log('\n📊 Checking position...\n');

  const position = await solvencyVault.positions(positionId);
  const inLiquidation = await solvencyVault.positionsInLiquidation(positionId);

  if (!position.active) {
    console.log('❌ Position is not active');
    process.exit(1);
  }

  if (!inLiquidation) {
    console.log('❌ Position is not in liquidation');
    process.exit(1);
  }

  if (position.tokenType !== 0n) {
    console.log('❌ Position is not RWA type (use purchaseAndSettleLiquidation for Private Assets)');
    process.exit(1);
  }

  console.log('✅ Position is RWA type and in liquidation');
  console.log('   User:', position.user);
  console.log('   Token:', position.collateralToken);
  console.log('   Amount:', ethers.formatUnits(position.collateralAmount, 18));

  const usdcAddress = await solvency

Vault.usdc();
  const usdc = new ethers.Contract(usdcAddress, ERC20_ABI, provider);

  console.log('\n⚠️  MANUAL SETTLEMENT REQUIRED\n');
  console.log('The deployed contracts have an interface mismatch.');
  console.log('You need to either:');
  console.log('');
  console.log('Option 1: Redeploy SolvencyVault with the balance-checking fix');
  console.log('Option 2: Redeploy YieldVault with return value added');
  console.log('Option 3: Deploy a new set of contracts for testing');
  console.log('');
  console.log('For now, the settlement cannot be completed with the current deployment.');
  console.log('');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
