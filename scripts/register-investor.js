#!/usr/bin/env node
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const IDENTITY_REGISTRY_ABI = [
  'function registerIdentity(address wallet) external',
  'function isVerified(address wallet) view returns (bool)',
];

async function registerInvestor() {
  const investorAddress = process.argv[2] || '0x23e67597f0898f747Fa3291C8920168adF9455D0';
  const adminPrivateKey = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const wallet = new ethers.Wallet(adminPrivateKey, provider);
  
  const identityRegistry = new ethers.Contract(
    deployedContracts.contracts.IdentityRegistry,
    IDENTITY_REGISTRY_ABI,
    wallet
  );
  
  console.log('🆔 Registering Investor Identity');
  console.log('━'.repeat(50));
  console.log('Investor:', investorAddress);
  console.log('Identity Registry:', deployedContracts.contracts.IdentityRegistry);
  console.log();
  
  // Check if already registered
  const isVerified = await identityRegistry.isVerified(investorAddress);
  
  if (isVerified) {
    console.log('✅ Investor is already KYC verified!');
    process.exit(0);
  }
  
  console.log('⏳ Registering identity...');
  const tx = await identityRegistry.registerIdentity(investorAddress);
  console.log('TX:', tx.hash);
  console.log('⏳ Waiting for confirmation...');
  
  await tx.wait();
  console.log('✅ Identity registered!');
  console.log('Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  console.log();
  console.log('✅ Investor can now purchase tokens!');
}

registerInvestor();
