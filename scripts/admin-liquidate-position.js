#!/usr/bin/env node

/**
 * Admin: Liquidate Position
 * Marks a position for liquidation (after defaulted)
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const SOLVENCY_VAULT_ABI = [
  'function liquidatePosition(uint256 positionId) external',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 tokenValueUSD, uint256 usdcBorrowed, bool active, uint256 creditLineId, uint8 tokenType)',
  'function positionsInLiquidation(uint256) view returns (bool)',
  'function repaymentPlans(uint256) view returns (uint256 loanDuration, uint256 numberOfInstallments, uint256 installmentInterval, uint256 nextPaymentDue, uint256 installmentsPaid, uint256 missedPayments, bool isActive, bool defaulted)',
];

async function liquidatePosition() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Admin: Liquidate Position');
  console.log('='.repeat(60));
  console.log('');

  // Configuration
  const positionId = process.argv[2];
  const adminPrivateKey = process.env.ADMIN_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  const rpcUrl = 'https://rpc.sepolia.mantle.xyz';

  if (!positionId) {
    console.log('❌ Usage: node admin-liquidate-position.js <position_id>');
    console.log('   or: ADMIN_KEY=0x... node admin-liquidate-position.js <position_id>');
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

  // Check position status
  console.log('='.repeat(60));
  console.log('Position Status Check');
  console.log('='.repeat(60));
  
  const position = await solvencyVault.positions(positionId);
  const plan = await solvencyVault.repaymentPlans(positionId);
  const inLiquidation = await solvencyVault.positionsInLiquidation(positionId);

  console.log('📊 Position:', positionId);
  console.log('  User:', position.user);
  console.log('  Collateral Token:', position.collateralToken);
  console.log('  Collateral Amount:', ethers.formatEther(position.collateralAmount), 'tokens');
  console.log('  Value:', `$${ethers.formatUnits(position.tokenValueUSD, 6)}`);
  console.log('  USDC Borrowed:', `$${ethers.formatUnits(position.usdcBorrowed, 6)}`);
  console.log('  Active:', position.active);
  console.log('');
  console.log('📋 Repayment Plan:');
  console.log('  Defaulted:', plan.defaulted);
  console.log('  Missed Payments:', plan.missedPayments.toString());
  console.log('  Already in Liquidation:', inLiquidation);
  console.log('');

  if (!plan.defaulted) {
    console.log('❌ Position is not marked as defaulted!');
    console.log('   Run: node admin-mark-defaulted.js', positionId);
    process.exit(1);
  }

  if (inLiquidation) {
    console.log('✅ Position is already in liquidation');
    console.log('');
    console.log('💡 Next Steps:');
    console.log('  1. Wait for asset maturity');
    console.log('  2. Distribute yield');
    console.log('  3. Settle liquidation: node scripts/admin-settle-liquidation.js', positionId);
    process.exit(0);
  }

  // Liquidate
  console.log('='.repeat(60));
  console.log('Liquidating Position');
  console.log('='.repeat(60));
  console.log('');
  console.log('ℹ️  Calling liquidatePosition(' + positionId + ')...');
  
  const tx = await solvencyVault.liquidatePosition(positionId);
  console.log('ℹ️  Transaction submitted:', tx.hash);
  console.log('ℹ️  Waiting for confirmation...');
  
  const receipt = await tx.wait();
  console.log('✅ Transaction confirmed in block', receipt.blockNumber);
  console.log('✅ Position LIQUIDATED on-chain!');
  console.log('');
  console.log('🔗 Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  console.log('');

  // Update MongoDB via Backend API
  console.log('='.repeat(60));
  console.log('Updating Backend Database');
  console.log('='.repeat(60));
  console.log('');
  
  try {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
    const syncResponse = await fetch(`${backendUrl}/api/admin/solvency/position/${positionId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    if (syncResponse.ok) {
      const syncData = await syncResponse.json();
      console.log('✅ Backend database updated!');
      console.log('   Status:', syncData.status || 'LIQUIDATED');
    } else {
      console.log('⚠️  Failed to sync with backend:', syncResponse.status, syncResponse.statusText);
      console.log('   Position is liquidated on-chain, but database may be out of sync');
      console.log('   You can manually sync via: POST', `${backendUrl}/api/admin/solvency/position/${positionId}/sync`);
    }
  } catch (syncError) {
    console.log('⚠️  Could not connect to backend API:', syncError.message);
    console.log('   Position is liquidated on-chain, but database is not updated');
    console.log('   Make sure backend is running at:', process.env.BACKEND_URL || 'http://localhost:3000');
  }
  console.log('');

  console.log('='.repeat(60));
  console.log('✨ Complete!');
  console.log('='.repeat(60));
  console.log('');
  console.log('📊 Updated Status:');
  console.log('  In Liquidation: true');
  console.log('  OAID Credit Line: Revoked');
  console.log('  Database: Updated (if backend is running)');
  console.log('');
  console.log('💡 Next Steps:');
  console.log('  1. Wait for asset maturity (RWA tokens)');
  console.log('  2. Trigger yield distribution (auto-settles liquidation):');
  console.log('     curl -X POST http://localhost:3000/api/yield/settlement/<ID>/distribute');
  console.log('  Or manually settle:');
  console.log('     node scripts/admin-settle-liquidation.js', positionId);
}

liquidatePosition().catch(console.error);
