#!/usr/bin/env node

/**
 * Admin: Mark Position as Defaulted
 * 
 * Marks a position as defaulted after multiple missed payments.
 * This makes the position eligible for liquidation.
 * 
 * Usage:
 *   ADMIN_KEY=0x... node scripts/admin-mark-defaulted.js <position_id>
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const ADMIN_KEY = process.env.ADMIN_KEY;

// Load deployed contracts
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const SOLVENCY_VAULT_ABI = [
  'function markDefaulted(uint256 positionId) external',
  'function repaymentPlans(uint256) view returns (uint256 loanDuration, uint256 numberOfInstallments, uint256 installmentInterval, uint256 nextPaymentDue, uint256 installmentsPaid, uint256 missedPayments, bool isActive, bool defaulted)',
  'event PositionDefaulted(uint256 indexed positionId)',
];

function printHeader(title) {
  console.log('\n' + '='.repeat(60));
  console.log(title);
  console.log('='.repeat(60) + '\n');
}

function printInfo(message) {
  console.log(`ℹ️  ${message}`);
}

function printSuccess(message) {
  console.log(`✅ ${message}`);
}

function printError(message) {
  console.log(`❌ ${message}`);
}

async function markDefaulted() {
  // Validation
  if (!ADMIN_KEY) {
    printError('ADMIN_KEY environment variable is required');
    console.log('\nUsage:');
    console.log('  ADMIN_KEY=0x... node scripts/admin-mark-defaulted.js <position_id>');
    process.exit(1);
  }

  const positionId = process.argv[2];
  if (!positionId) {
    printError('Position ID is required');
    console.log('\nUsage:');
    console.log('  ADMIN_KEY=0x... node scripts/admin-mark-defaulted.js <position_id>');
    process.exit(1);
  }

  printHeader('Admin: Mark Position as Defaulted');

  // Configuration
  console.log('📝 Configuration:');
  console.log('  RPC URL:', RPC_URL);
  console.log('  Position ID:', positionId);
  console.log('  Solvency Vault:', deployedContracts.contracts.SolvencyVault);

  // Connect to provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  printInfo(`Admin Address: ${wallet.address}`);
  console.log();

  // Connect to SolvencyVault
  const solvencyVault = new ethers.Contract(
    deployedContracts.contracts.SolvencyVault,
    SOLVENCY_VAULT_ABI,
    wallet
  );

  // Check current status
  printHeader('Current Status');
  try {
    const plan = await solvencyVault.repaymentPlans(positionId);
    console.log('📊 Repayment Plan:');
    console.log('  Active:', plan.isActive);
    console.log('  Installments Paid:', plan.installmentsPaid.toString(), '/', plan.numberOfInstallments.toString());
    console.log('  Missed Payments:', plan.missedPayments.toString());
    console.log('  Already Defaulted:', plan.defaulted);
    console.log();

    if (plan.defaulted) {
      printError('Position is already marked as defaulted!');
      process.exit(0);
    }

    if (!plan.isActive) {
      printError('Position does not have an active repayment plan!');
      process.exit(1);
    }

    if (plan.missedPayments < 3) {
      console.log(`⚠️  Warning: Position has only ${plan.missedPayments} missed payments.`);
      console.log('   Typically 3+ missed payments trigger default.');
    }
  } catch (error) {
    printError(`Failed to fetch repayment plan: ${error.message}`);
    process.exit(1);
  }

  // Mark as defaulted
  printHeader('Marking Position as Defaulted');
  
  try {
    printInfo(`Calling markDefaulted(${positionId})...`);
    const tx = await solvencyVault.markDefaulted(positionId);
    
    printInfo(`Transaction submitted: ${tx.hash}`);
    printInfo('Waiting for confirmation...');
    
    const receipt = await tx.wait();
    printSuccess(`Transaction confirmed in block ${receipt.blockNumber}`);
    printSuccess('Position marked as DEFAULTED!');
    
    console.log();
    console.log('🔗 Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
    
  } catch (error) {
    printError(`Failed to mark as defaulted: ${error.message}`);
    if (error.reason) {
      printError(`Reason: ${error.reason}`);
    }
    process.exit(1);
  }

  // Verify new status
  printHeader('✨ Complete!');
  
  const plan = await solvencyVault.repaymentPlans(positionId);
  console.log('📊 Updated Status:');
  console.log('  Defaulted:', plan.defaulted);
  console.log('  Missed Payments:', plan.missedPayments.toString());
  console.log();
  console.log('💡 Next Steps:');
  console.log('  1. Position is now eligible for liquidation');
  console.log('  2. Admin or anyone can call liquidatePosition()');
  console.log('  3. Use: node scripts/admin-liquidate-position.js', positionId);
  console.log();
}

markDefaulted().catch((error) => {
  console.error('\n❌ Script failed:', error);
  process.exit(1);
});
