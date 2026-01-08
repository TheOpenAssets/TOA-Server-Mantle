#!/usr/bin/env node

/**
 * Whitelist SolvencyVault in Token Compliance Contract
 *
 * Usage:
 *   ADMIN_KEY=0x... node scripts/whitelist-solvency-vault.js <token-address>
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const ADMIN_KEY = process.env.ADMIN_KEY || process.env.DEPLOYER_KEY;
const tokenAddress = process.argv[2];

if (!ADMIN_KEY) {
  console.error('❌ ADMIN_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/whitelist-solvency-vault.js <token-address>');
  process.exit(1);
}

if (!tokenAddress) {
  console.error('❌ Token address is required');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/whitelist-solvency-vault.js <token-address>');
  process.exit(1);
}

// Load deployed contracts
const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));

const RWA_TOKEN_ABI = [
  'function compliance() view returns (address)',
];

const COMPLIANCE_ABI = [
  'function addWhitelistedAddress(address account) external',
  'function isWhitelisted(address account) view returns (bool)',
];

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('Whitelist SolvencyVault in Token Compliance');
  console.log('='.repeat(60));

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);

  console.log(`Admin: ${wallet.address}`);
  console.log(`Token: ${tokenAddress}`);
  console.log(`SolvencyVault: ${deployed.contracts.SolvencyVault}`);
  console.log();

  // Get compliance contract address
  const tokenContract = new ethers.Contract(tokenAddress, RWA_TOKEN_ABI, provider);
  const complianceAddress = await tokenContract.compliance();

  console.log(`Compliance Contract: ${complianceAddress}`);
  console.log();

  // Check if already whitelisted
  const compliance = new ethers.Contract(complianceAddress, COMPLIANCE_ABI, wallet);
  const isWhitelisted = await compliance.isWhitelisted(deployed.contracts.SolvencyVault);

  if (isWhitelisted) {
    console.log('✅ SolvencyVault is already whitelisted!');
    process.exit(0);
  }

  console.log('⏳ Whitelisting SolvencyVault...');
  const tx = await compliance.addWhitelistedAddress(deployed.contracts.SolvencyVault);
  console.log(`TX: ${tx.hash}`);
  console.log('⏳ Waiting for confirmation...');

  await tx.wait();

  console.log('✅ SolvencyVault whitelisted!');
  console.log(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  console.log();

  // Verify
  const nowWhitelisted = await compliance.isWhitelisted(deployed.contracts.SolvencyVault);
  if (nowWhitelisted) {
    console.log('✅ Verification confirmed!');
  } else {
    console.log('⚠️  Whitelisting succeeded but verification failed');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n' + '='.repeat(60));
    console.error('❌ Script failed:');
    console.error(error);
    console.error('='.repeat(60));
    process.exit(1);
  });
