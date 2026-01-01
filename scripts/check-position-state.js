#!/usr/bin/env node

/**
 * Check Position and SeniorPool State
 *
 * Queries on-chain state to debug harvest issues
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const POSITION_ID = process.argv[2] || '1';

const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
const contracts = deployed.contracts;

const SENIOR_POOL_ABI = [
  'function getAccruedInterest(uint256 positionId) external view returns (uint256)',
  'function getOutstandingDebt(uint256 positionId) external view returns (uint256)',
  'function demoMode() external view returns (bool)',
  'function timeMultiplier() external view returns (uint256)',
  'function loans(uint256 positionId) external view returns (uint256 principal, uint256 interestAccrued, uint256 lastUpdateTime, bool active)',
];

const LEVERAGE_VAULT_ABI = [
  'function positions(uint256 positionId) external view returns (address user, uint256 mETHCollateral, uint256 usdcBorrowed, address rwaToken, uint256 rwaTokenAmount, string assetId, uint256 createdAt, uint256 lastHarvestTime, uint256 totalInterestPaid, bool active)',
];

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Checking Position ${POSITION_ID} State`);
  console.log('='.repeat(60));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const seniorPool = new ethers.Contract(contracts.SeniorPool, SENIOR_POOL_ABI, provider);
  const leverageVault = new ethers.Contract(contracts.LeverageVault, LEVERAGE_VAULT_ABI, provider);

  // SeniorPool state
  console.log('\n📊 SeniorPool State:');
  const demoMode = await seniorPool.demoMode();
  const timeMultiplier = await seniorPool.timeMultiplier();
  console.log(`  Demo Mode: ${demoMode}`);
  console.log(`  Time Multiplier: ${timeMultiplier}x`);

  const loan = await seniorPool.loans(POSITION_ID);
  console.log(`\n  Loan ${POSITION_ID}:`);
  console.log(`    Principal: ${ethers.formatUnits(loan.principal, 6)} USDC`);
  console.log(`    Interest Accrued: ${ethers.formatUnits(loan.interestAccrued, 6)} USDC`);
  console.log(`    Last Update: ${new Date(Number(loan.lastUpdateTime) * 1000).toISOString()}`);
  console.log(`    Active: ${loan.active}`);

  const accruedInterest = await seniorPool.getAccruedInterest(POSITION_ID);
  const outstandingDebt = await seniorPool.getOutstandingDebt(POSITION_ID);
  console.log(`\n  Accrued Interest: ${ethers.formatUnits(accruedInterest, 6)} USDC`);
  console.log(`  Outstanding Debt: ${ethers.formatUnits(outstandingDebt, 6)} USDC`);

  // LeverageVault position
  console.log('\n📊 LeverageVault Position:');
  const position = await leverageVault.positions(POSITION_ID);
  console.log(`  User: ${position.user}`);
  console.log(`  mETH Collateral: ${ethers.formatEther(position.mETHCollateral)} mETH`);
  console.log(`  USDC Borrowed: ${ethers.formatUnits(position.usdcBorrowed, 6)} USDC`);
  console.log(`  Created: ${new Date(Number(position.createdAt) * 1000).toISOString()}`);
  console.log(`  Last Harvest: ${new Date(Number(position.lastHarvestTime) * 1000).toISOString()}`);
  console.log(`  Total Interest Paid: ${ethers.formatUnits(position.totalInterestPaid, 6)} USDC`);
  console.log(`  Active: ${position.active}`);

  // Calculate time elapsed
  const now = Math.floor(Date.now() / 1000);
  const timeElapsed = now - Number(loan.lastUpdateTime);
  const effectiveTime = demoMode ? timeElapsed * Number(timeMultiplier) : timeElapsed;
  console.log(`\n⏱️  Time Analysis:`);
  console.log(`  Real time elapsed: ${timeElapsed} seconds (${(timeElapsed / 60).toFixed(2)} minutes)`);
  console.log(`  Effective time (with ${timeMultiplier}x): ${effectiveTime} seconds (${(effectiveTime / 60).toFixed(2)} minutes)`);

  // Calculate required mETH for interest
  const mETHPrice = 2858.78; // From backend logs
  const mETHPriceWei = ethers.parseUnits(mETHPrice.toString(), 18);
  if (accruedInterest > 0n) {
    // mETH = (targetUSDC * 1e30) / mETHPrice
    const requiredMETH = (accruedInterest * BigInt(1e30)) / mETHPriceWei;
    console.log(`\n💱 Harvest Calculation:`);
    console.log(`  Interest to pay: ${ethers.formatUnits(accruedInterest, 6)} USDC`);
    console.log(`  mETH price: $${mETHPrice}`);
    console.log(`  mETH required: ${ethers.formatEther(requiredMETH)} mETH`);
    console.log(`  mETH available: ${ethers.formatEther(position.mETHCollateral)} mETH`);
    console.log(`  Sufficient collateral: ${requiredMETH <= position.mETHCollateral ? '✅ YES' : '❌ NO'}`);
  } else {
    console.log(`\n⚠️  No interest accrued on-chain!`);
  }

  console.log('\n' + '='.repeat(60) + '\n');
}

main().catch(console.error);
