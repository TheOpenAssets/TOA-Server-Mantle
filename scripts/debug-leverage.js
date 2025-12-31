#!/usr/bin/env node

/**
 * Debug Leverage System
 * Checks all potential issues preventing leverage position creation
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';

// Load deployed contracts
const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
const contracts = deployed.contracts;

// Minimal ABIs
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
];

const LEVERAGE_VAULT_ABI = [
  'function priceOracle() view returns (address)',
  'function seniorPool() view returns (address)',
  'function mETH() view returns (address)',
  'function usdc() view returns (address)',
];

const PRICE_ORACLE_ABI = [
  'function getPrice() view returns (uint256)',
];

const SENIOR_POOL_ABI = [
  'function totalLiquidity() view returns (uint256)',
  'function availableLiquidity() view returns (uint256)',
];

const IDENTITY_REGISTRY_ABI = [
  'function isVerified(address) view returns (bool)',
];

async function main() {
  console.log('🔍 Diagnosing Leverage System Issues\n');
  console.log('━'.repeat(60));

  const provider = new ethers.JsonRpcProvider(RPC_URL);

  // Connect to contracts
  const leverageVault = new ethers.Contract(contracts.LeverageVault, LEVERAGE_VAULT_ABI, provider);
  const usdc = new ethers.Contract(contracts.USDC, ERC20_ABI, provider);

  // Issue #1: Check Price Oracle
  console.log('\n📊 Issue #1: Price Oracle');
  console.log('━'.repeat(60));
  try {
    const priceOracleAddress = await leverageVault.priceOracle();
    console.log(`✅ Price Oracle Address: ${priceOracleAddress}`);

    const priceOracle = new ethers.Contract(priceOracleAddress, PRICE_ORACLE_ABI, provider);

    try {
      const price = await priceOracle.getPrice();
      console.log(`✅ Price Oracle Working: ${ethers.formatUnits(price, 18)} USD`);
    } catch (error) {
      console.log(`❌ Price Oracle BROKEN: ${error.message}`);
      console.log(`   Contract at ${priceOracleAddress} does not have getPrice() function`);
      console.log(`   FIX: Deploy a MockPriceOracle contract and update LeverageVault`);
    }
  } catch (error) {
    console.log(`❌ Failed to check price oracle: ${error.message}`);
  }

  // Issue #2: Check SeniorPool Liquidity
  console.log('\n💰 Issue #2: SeniorPool USDC Liquidity');
  console.log('━'.repeat(60));
  try {
    const seniorPoolAddress = await leverageVault.seniorPool();
    console.log(`✅ SeniorPool Address: ${seniorPoolAddress}`);

    const seniorPoolBalance = await usdc.balanceOf(seniorPoolAddress);
    console.log(`   USDC Balance: ${ethers.formatUnits(seniorPoolBalance, 6)} USDC`);

    if (seniorPoolBalance >= 72_000000n) {
      console.log(`✅ Sufficient liquidity for 72 USDC loan`);
    } else {
      console.log(`❌ INSUFFICIENT LIQUIDITY! Need 72 USDC, have ${ethers.formatUnits(seniorPoolBalance, 6)} USDC`);
      console.log(`   FIX: Transfer USDC to SeniorPool at ${seniorPoolAddress}`);
    }

    // Try to get available liquidity if contract has that method
    try {
      const seniorPool = new ethers.Contract(seniorPoolAddress, SENIOR_POOL_ABI, provider);
      const availableLiquidity = await seniorPool.availableLiquidity();
      console.log(`   Available Liquidity: ${ethers.formatUnits(availableLiquidity, 6)} USDC`);
    } catch (e) {
      // Method might not exist
    }
  } catch (error) {
    console.log(`❌ Failed to check SeniorPool: ${error.message}`);
  }

  // Issue #3: Check RWA Token Approval (Identity Registry)
  console.log('\n🔐 Issue #3: RWA Token Holder Approval');
  console.log('━'.repeat(60));
  try {
    const identityRegistry = new ethers.Contract(
      contracts.IdentityRegistry,
      IDENTITY_REGISTRY_ABI,
      provider
    );

    const isLeverageVaultVerified = await identityRegistry.isVerified(contracts.LeverageVault);

    if (isLeverageVaultVerified) {
      console.log(`✅ LeverageVault is verified to hold RWA tokens`);
    } else {
      console.log(`❌ LeverageVault NOT VERIFIED to hold RWA tokens!`);
      console.log(`   LeverageVault: ${contracts.LeverageVault}`);
      console.log(`   FIX: Register LeverageVault in IdentityRegistry`);
      console.log(`   Command: node scripts/register-leverage-vault.js`);
    }
  } catch (error) {
    console.log(`❌ Failed to check identity registry: ${error.message}`);
  }

  // Issue #4: Check mETH Approval
  console.log('\n🔑 Issue #4: User mETH Approval');
  console.log('━'.repeat(60));
  console.log('⚠️  This check requires user address - run from buy-leverage-meth.js script');
  console.log('   The script already handles mETH approval automatically');

  // Summary
  console.log('\n📋 Summary');
  console.log('━'.repeat(60));
  console.log('Common fixes needed:');
  console.log('1. Deploy MockPriceOracle contract');
  console.log('2. Fund SeniorPool with USDC');
  console.log('3. Register LeverageVault in IdentityRegistry');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Diagnostic failed:', error);
    process.exit(1);
  });
