#!/usr/bin/env node

/**
 * Debug Settlement - Check all requirements
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const SOLVENCY_VAULT_ABI = [
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, uint256 liquidatedAt, uint256 creditLineId, bool active, uint8 tokenType)',
  'function positionsInLiquidation(uint256) view returns (bool)',
  'function yieldVault() view returns (address)',
  'function seniorPool() view returns (address)',
  'function usdc() view returns (address)',
];

const SENIOR_POOL_ABI = [
  'function getOutstandingDebt(uint256) view returns (uint256)',
];

const positionId = 1;

async function debug() {
  console.log('🔍 Debugging Settlement Requirements\n');
  
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const vault = new ethers.Contract(
    deployedContracts.contracts.SolvencyVault,
    SOLVENCY_VAULT_ABI,
    provider
  );

  // Check all requirements from settleLiquidation function
  console.log('Checking requirements for settleLiquidation(1):\n');

  const position = await vault.positions(positionId);
  console.log('✓ Position data retrieved');
  console.log('  - user:', position.user);
  console.log('  - active:', position.active);
  console.log('  - tokenType:', position.tokenType, '(0=RWA, 1=PRIVATE_ASSET)');
  
  const inLiquidation = await vault.positionsInLiquidation(positionId);
  console.log('  - inLiquidation:', inLiquidation);
  console.log('');

  // Requirement 1: position.active
  if (!position.active) {
    console.log('❌ FAIL: Position not active');
  } else {
    console.log('✅ PASS: Position is active');
  }

  // Requirement 2: positionsInLiquidation[positionId]
  if (!inLiquidation) {
    console.log('❌ FAIL: Position not in liquidation');
  } else {
    console.log('✅ PASS: Position is in liquidation');
  }

  // Requirement 3: position.tokenType == TokenType.RWA (0)
  if (position.tokenType !== 0) {
    console.log('❌ FAIL: Token type is not RWA (type:', position.tokenType + ')');
  } else {
    console.log('✅ PASS: Token type is RWA');
  }

  // Requirement 4: yieldVault != address(0)
  const yieldVaultAddress = await vault.yieldVault();
  console.log('');
  console.log('YieldVault address:', yieldVaultAddress);
  if (yieldVaultAddress === ethers.ZeroAddress) {
    console.log('❌ FAIL: YieldVault not set in SolvencyVault!');
    console.log('   You need to call: solvencyVault.setYieldVault(yieldVault)');
  } else {
    console.log('✅ PASS: YieldVault is set');
  }

  // Check seniorPool
  const seniorPoolAddress = await vault.seniorPool();
  console.log('');
  console.log('SeniorPool address:', seniorPoolAddress);
  if (seniorPoolAddress === ethers.ZeroAddress) {
    console.log('❌ FAIL: SeniorPool not set');
  } else {
    console.log('✅ PASS: SeniorPool is set');
    
    // Try to get outstanding debt
    try {
      const seniorPool = new ethers.Contract(seniorPoolAddress, SENIOR_POOL_ABI, provider);
      const debt = await seniorPool.getOutstandingDebt(positionId);
      console.log('✅ PASS: Can read outstanding debt:', ethers.formatUnits(debt, 6), 'USDC');
    } catch (error) {
      console.log('❌ FAIL: Cannot read outstanding debt from SeniorPool');
      console.log('   Error:', error.message);
    }
  }

  // Check USDC
  const usdcAddress = await vault.usdc();
  console.log('');
  console.log('USDC address:', usdcAddress);
  if (usdcAddress === ethers.ZeroAddress) {
    console.log('❌ FAIL: USDC not set');
  } else {
    console.log('✅ PASS: USDC is set');
  }

  console.log('');
  console.log('Expected YieldVault:', deployedContracts.contracts.YieldVault);
  console.log('Expected SeniorPool:', deployedContracts.contracts.SeniorPool);
  console.log('Expected USDC:', deployedContracts.contracts.USDC);
}

debug().catch(console.error);
