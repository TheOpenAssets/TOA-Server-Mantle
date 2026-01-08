#!/usr/bin/env node

/**
 * Admin: Settle Liquidation
 * Burns RWA tokens and repays debt from yield (for RWA tokens)
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const SOLVENCY_VAULT_ABI = [
  'function settleLiquidation(uint256 positionId) external returns (uint256 yieldReceived, uint256 debtRepaid, uint256 liquidationFee, uint256 userRefund)',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 tokenValueUSD, uint256 usdcBorrowed, bool active, uint256 creditLineId, uint8 tokenType)',
  'function positionsInLiquidation(uint256) view returns (bool)',
  'function repaymentPlans(uint256) view returns (uint256 loanDuration, uint256 numberOfInstallments, uint256 installmentInterval, uint256 nextPaymentDue, uint256 installmentsPaid, uint256 missedPayments, bool isActive, bool defaulted)',
];

const YIELD_VAULT_ABI = [
  'function getSettlementInfo(address) view returns (uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, uint256 yieldPerToken)',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

async function settleLiquidation() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Admin: Settle Liquidation');
  console.log('='.repeat(60));
  console.log('');

  // Configuration
  const positionId = process.argv[2];
  const adminPrivateKey = process.env.ADMIN_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  const rpcUrl = 'https://rpc.sepolia.mantle.xyz';

  if (!positionId) {
    console.log('❌ Usage: node admin-settle-liquidation.js <position_id>');
    console.log('   or: ADMIN_KEY=0x... node admin-settle-liquidation.js <position_id>');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log('  RPC URL:', rpcUrl);
  console.log('  Position ID:', positionId);
  console.log('  Solvency Vault:', deployedContracts.contracts.SolvencyVault);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(adminPrivateKey, provider);
  
  console.log('ℹ️  Admin Address:', wallet.address);
  console.log('');

  const solvencyVault = new ethers.Contract(
    deployedContracts.contracts.SolvencyVault,
    SOLVENCY_VAULT_ABI,
    wallet
  );

  const yieldVault = new ethers.Contract(
    deployedContracts.contracts.YieldVault,
    YIELD_VAULT_ABI,
    provider
  );

  // Check position status
  console.log('='.repeat(60));
  console.log('Position Status Check');
  console.log('='.repeat(60));
  
  const position = await solvencyVault.positions(positionId);
  const inLiquidation = await solvencyVault.positionsInLiquidation(positionId);
  const plan = await solvencyVault.repaymentPlans(positionId);

  // Calculate outstanding debt based on original borrow amount
  // (getOutstandingDebt reverts for liquidated positions)
  const outstandingDebt = position.usdcBorrowed;

  const token = new ethers.Contract(position.collateralToken, ERC20_ABI, provider);
  const symbol = await token.symbol();
  const vaultBalance = await token.balanceOf(deployedContracts.contracts.SolvencyVault);

  // Check YieldVault settlement for this token (if possible)
  let settlementAmount = 0n;
  try {
    const settlement = await yieldVault.getSettlementInfo(position.collateralToken);
    settlementAmount = settlement.totalSettlement;
  } catch (e) {
    // Settlement doesn't exist for this token
    settlementAmount = 0n;
  }

  console.log('📊 Position:', positionId);
  console.log('  User:', position.user);
  console.log('  Collateral Token:', position.collateralToken, `(${symbol})`);
  console.log('  Collateral Amount:', ethers.formatEther(position.collateralAmount), symbol);
  console.log('  USDC Debt:', `$${ethers.formatUnits(outstandingDebt, 6)}`);
  console.log('  Active:', position.active);
  console.log('  In Liquidation:', inLiquidation);
  console.log('  Missed Payments:', plan.missedPayments.toString());
  console.log('  Vault Balance:', ethers.formatEther(vaultBalance), symbol);
  console.log('');
  console.log('💰 YieldVault Status for', symbol + ':');
  if (settlementAmount > 0n) {
    console.log('  ✅ Settlement Deposited:', `$${ethers.formatUnits(settlementAmount, 6)}`);
  } else {
    console.log('  ❌ NO SETTLEMENT FOUND!');
    console.log('  You must distribute yield via backend API first.');
  }
  console.log('');

  if (!inLiquidation) {
    console.log('❌ Position is not in liquidation!');
    console.log('   Run: node admin-liquidate-position.js', positionId);
    process.exit(1);
  }

  if (settlementAmount === 0n) {
    console.log('❌ No yield settlement found in YieldVault for this token!');
    console.log('   You need to distribute yield first via the backend API:');
    console.log('   1. Record settlement: POST /api/yield/settlement/record');
    console.log('   2. Confirm USDC: POST /api/yield/settlement/<ID>/confirm-conversion');
    console.log('   3. Distribute: POST /api/yield/settlement/<ID>/distribute');
    console.log('');
    console.log('   The distribution will automatically settle this liquidation.');
    process.exit(1);
  }

  // Settle
  console.log('='.repeat(60));
  console.log('Settling Liquidation');
  console.log('='.repeat(60));
  console.log('');
  console.log('ℹ️  This will:');
  console.log('  1. Burn', ethers.formatEther(position.collateralAmount), symbol, 'tokens via YieldVault');
  console.log('  2. Claim USDC yield from YieldVault');
  console.log('  3. Repay debt of $' + ethers.formatUnits(outstandingDebt, 6), 'to SeniorPool');
  console.log('  4. Return remaining USDC to user');
  console.log('');
  console.log('ℹ️  Calling settleLiquidation(' + positionId + ')...');
  
  try {
    const tx = await solvencyVault.settleLiquidation(positionId);
    console.log('ℹ️  Transaction submitted:', tx.hash);
    console.log('ℹ️  Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed in block', receipt.blockNumber);
    console.log('✅ Liquidation SETTLED!');
    console.log('');
    console.log('🔗 Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
    console.log('');

    console.log('='.repeat(60));
    console.log('✨ Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📊 Final Status:');
    console.log('  ✓ Collateral tokens burned');
    console.log('  ✓ Debt repaid to SeniorPool');
    console.log('  ✓ Remaining yield returned to user');
    console.log('  ✓ Position closed');
  } catch (error) {
    console.log('');
    console.log('❌ Settlement failed!');
    console.log('');
    console.log('Error:', error.message);
    console.log('');
    console.log('💡 Common issues:');
    console.log('  1. No yield in YieldVault - Check totalSettlement above');
    console.log('  2. Position already settled');
    console.log('  3. Insufficient yield to cover debt');
    console.log('');
    console.log('🔍 Debug info:');
    console.log('  Settlement in YieldVault:', `$${ethers.formatUnits(settlementAmount, 6)}`);
    console.log('  Outstanding Debt:', `$${ethers.formatUnits(outstandingDebt, 6)}`);
    console.log('  Collateral:', ethers.formatEther(position.collateralAmount), symbol);
    throw error;
  }
}

settleLiquidation().catch(console.error);
