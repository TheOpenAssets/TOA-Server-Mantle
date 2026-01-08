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

const OAID_ABI = [
  'function registerUser(address user) external',
  'function isUserRegistered(address user) view returns (bool)',
  'function getUserProfile(address user) view returns (bool isRegistered, uint256 creditScore, uint256 totalCreditLines, uint256 activeCreditLines, uint256 totalBorrowed, uint256 totalRepaid)',
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

  const oaid = new ethers.Contract(
    deployedContracts.contracts.OAID,
    OAID_ABI,
    wallet
  );
  
  console.log('🆔 Registering Investor Identity & OAID');
  console.log('━'.repeat(50));
  console.log('Investor:', investorAddress);
  console.log('Identity Registry:', deployedContracts.contracts.IdentityRegistry);
  console.log('OAID:', deployedContracts.contracts.OAID);
  console.log();
  
  // Step 1: Register with Identity Registry
  console.log('📋 Step 1: Identity Registry Registration');
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
    console.log('Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  }
  console.log();

  // Step 2: Register with OAID
  console.log('📋 Step 2: OAID Registration');
  const isOAIDRegistered = await oaid.isUserRegistered(investorAddress);
  
  if (isOAIDRegistered) {
    console.log('✅ Already registered in OAID');
    const profile = await oaid.getUserProfile(investorAddress);
    console.log('📊 OAID Profile:');
    console.log('  Credit Score:', profile.creditScore.toString());
    console.log('  Total Credit Lines:', profile.totalCreditLines.toString());
    console.log('  Active Credit Lines:', profile.activeCreditLines.toString());
  } else {
    console.log('⏳ Registering with OAID...');
    const tx = await oaid.registerUser(investorAddress);
    console.log('TX:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    await tx.wait();
    console.log('✅ OAID registration complete!');
    console.log('Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  }
  console.log();
  
  console.log('✅ Investor fully registered!');
  console.log('  ✓ KYC verified in Identity Registry');
  console.log('  ✓ Registered in OAID for credit tracking');
  console.log();
  console.log('🎉 Investor can now:');
  console.log('  • Purchase RWA tokens from marketplace');
  console.log('  • Deposit collateral to SolvencyVault');
  console.log('  • Borrow USDC against collateral');
  console.log('  • Build credit history via OAID');
}

registerInvestor();
