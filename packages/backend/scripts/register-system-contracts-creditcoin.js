#!/usr/bin/env node
/* eslint-disable */
// @ts-nocheck
/**
 * Registers all platform system contracts in the Creditcoin IdentityRegistry.
 *
 * RWAToken.ComplianceModule.canTransfer checks BOTH from AND to against IdentityRegistry.
 * Any contract that participates in a token transfer (send or receive) must be whitelisted here.
 *
 * Run this once after deployment or whenever a new contract is added to the platform.
 *
 * Usage:
 *   node packages/backend/scripts/register-system-contracts-creditcoin.js [adminPrivateKey]
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/creditcoin-contracts/deployed_contracts_creditcoin.json', 'utf-8')
);

const IDENTITY_REGISTRY_ABI = [
  'function registerIdentity(address wallet) external',
  'function isVerified(address wallet) view returns (bool)',
];

// Every contract that appears as `from` or `to` in any RWA token transferFrom must be here.
const SYSTEM_CONTRACTS = [
  { name: 'Deployer / platformCustody', key: 'deployer' },
  { name: 'PrimaryMarket',              key: 'PrimaryMarket' },
  { name: 'SecondaryMarket',            key: 'SecondaryMarket' },
  { name: 'SolvencyVault',              key: 'SolvencyVault' },
  { name: 'YieldVault',                 key: 'YieldVault' },
  { name: 'SeniorPool',                 key: 'SeniorPool' },
  { name: 'CTCLeverageVault',           key: 'CTCLeverageVault' },
];

async function registerSystemContracts() {
  const adminPrivateKey = process.argv[2] || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';

  const provider = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network');
  const wallet = new ethers.Wallet(adminPrivateKey, provider);

  const contracts = deployedContracts.contracts;
  const deployer = deployedContracts.deployer;

  console.log('🏗️  Registering Platform System Contracts on Creditcoin Testnet');
  console.log('━'.repeat(60));
  console.log('Admin wallet:      ', wallet.address);
  console.log('Identity Registry: ', contracts.IdentityRegistry);
  console.log();

  const identityRegistry = new ethers.Contract(
    contracts.IdentityRegistry,
    IDENTITY_REGISTRY_ABI,
    wallet
  );

  for (const entry of SYSTEM_CONTRACTS) {
    const address = entry.key === 'deployer' ? deployer : contracts[entry.key];

    if (!address || address === '0x0000000000000000000000000000000000000000') {
      console.log(`⏭️  ${entry.name}: not deployed, skipping`);
      continue;
    }

    process.stdout.write(`📋 ${entry.name} (${address})... `);

    try {
      const isVerified = await identityRegistry.isVerified(address);
      if (isVerified) {
        console.log('✅ already registered');
      } else {
        const tx = await identityRegistry.registerIdentity(address);
        process.stdout.write(`TX ${tx.hash.slice(0, 10)}... `);
        await tx.wait();
        console.log('✅ registered!');
      }
    } catch (err) {
      console.log(`❌ FAILED: ${err.message}`);
    }
  }

  console.log();
  console.log('✅ All system contracts processed.');
  console.log('Platform contracts can now send/receive RWA tokens without compliance errors.');
}

registerSystemContracts().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
