#!/usr/bin/env node

/**
 * Approve Marketplace Script
 *
 * Approves the PrimaryMarketplace contract to spend RWA tokens on behalf of Platform Custody
 * This is needed for the marketplace to transfer tokens to buyers
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const TOKEN_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

async function approveMarketplace() {
  const tokenAddress = process.argv[2];

  if (!tokenAddress) {
    console.log('❌ Usage: node scripts/approve-marketplace.js <TOKEN_ADDRESS>');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/approve-marketplace.js 0xF837236ea7e3c8fFd1250C62F7c00E1C04ec2E4D');
    process.exit(1);
  }

  // Platform custody private key from .env
  const custodyPrivateKey = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';

  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const custodyWallet = new ethers.Wallet(custodyPrivateKey, provider);

  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, custodyWallet);
  const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;

  console.log('💰 Approving Marketplace to Spend RWA Tokens');
  console.log('━'.repeat(50));
  console.log('Token:', tokenAddress);
  console.log('Marketplace:', marketplaceAddress);
  console.log('Platform Custody:', custodyWallet.address);
  console.log();

  // Get token info
  const tokenName = await token.name();
  const tokenSymbol = await token.symbol();
  const balance = await token.balanceOf(custodyWallet.address);

  console.log(`Token: ${tokenName} (${tokenSymbol})`);
  console.log(`Custody Balance: ${ethers.formatEther(balance)} tokens`);
  console.log();

  // Check current allowance
  const currentAllowance = await token.allowance(custodyWallet.address, marketplaceAddress);
  console.log(`Current Allowance: ${ethers.formatEther(currentAllowance)} tokens`);

  if (currentAllowance > 0n) {
    console.log('✅ Marketplace already has approval!');
    process.exit(0);
  }

  // Approve max amount (unlimited approval for convenience)
  const maxApproval = ethers.MaxUint256;

  console.log('⏳ Approving marketplace (unlimited)...');
  const tx = await token.approve(marketplaceAddress, maxApproval);
  console.log('TX:', tx.hash);
  console.log('⏳ Waiting for confirmation...');

  await tx.wait();
  console.log('✅ Marketplace approved!');
  console.log('Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  console.log();
  console.log('✅ Marketplace can now transfer tokens to buyers!');
}

approveMarketplace().catch(console.error);
