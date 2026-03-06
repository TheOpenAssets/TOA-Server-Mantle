#!/usr/bin/env node
/* eslint-disable */
// @ts-nocheck
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/creditcoin-contracts/deployed_contracts_creditcoin.json', 'utf-8')
);

const IDENTITY_REGISTRY_ABI = [
  'function registerIdentity(address wallet) external',
  'function isVerified(address wallet) view returns (bool)',
];

async function registerInvestor() {
  const investorAddress = process.argv[2] || '0x815ACe8936173c3206be3aaaf0e4851EBa35Acaf';
  const adminPrivateKey = process.argv[3] || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';

  const provider = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network');
  const wallet = new ethers.Wallet(adminPrivateKey, provider);

  const contracts = deployedContracts.contracts;

  console.log('🆔 Registering Investor Identity on Creditcoin Testnet');
  console.log('━'.repeat(50));
  console.log('Investor:          ', investorAddress);
  console.log('Admin wallet:      ', wallet.address);
  console.log('Identity Registry: ', contracts.IdentityRegistry);
  console.log();

  const identityRegistry = new ethers.Contract(
    contracts.IdentityRegistry,
    IDENTITY_REGISTRY_ABI,
    wallet
  );

  console.log('📋 Identity Registry Registration');
  const isVerified = await identityRegistry.isVerified(investorAddress);

  if (isVerified) {
    console.log('✅ Already KYC verified in Identity Registry');
  } else {
    console.log('⏳ Registering identity...');
    const tx = await identityRegistry.registerIdentity(investorAddress);
    console.log('TX:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    await tx.wait();
    console.log('✅ Identity registered!');
    console.log('Explorer:', `https://creditcoin-testnet.blockscout.com/tx/${tx.hash}`);
  }

  console.log();
  console.log('✅ Investor registered on Creditcoin Testnet!');
  console.log('  ✓ KYC verified in Identity Registry');
  console.log();
  console.log('🎉 Investor can now purchase RWA tokens from the marketplace');
}

registerInvestor().catch((e) => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
