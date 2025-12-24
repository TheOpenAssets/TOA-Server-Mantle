#!/usr/bin/env node
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

const MARKETPLACE_ABI = [
  'function platformCustody() view returns (address)',
];

async function prepareMarketplace() {
  const tokenAddress = '0x6591b5A3b79850ab530244BF9A262036A3667575';
  const adminPrivateKey = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const wallet = new ethers.Wallet(adminPrivateKey, provider);
  
  const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, wallet);
  const marketplaceContract = new ethers.Contract(
    deployedContracts.contracts.PrimaryMarketplace,
    MARKETPLACE_ABI,
    provider
  );
  
  console.log('🔧 Preparing Marketplace for Trading');
  console.log('━'.repeat(50));
  
  // Get platform custody address
  const platformCustody = await marketplaceContract.platformCustody();
  console.log('Platform Custody:', platformCustody);
  console.log('Admin Wallet:', wallet.address);
  console.log('Token:', tokenAddress);
  console.log();
  
  // Check balances
  const adminBalance = await tokenContract.balanceOf(wallet.address);
  const custodyBalance = await tokenContract.balanceOf(platformCustody);
  
  console.log('Token Balances:');
  console.log('  Admin:', ethers.formatUnits(adminBalance, 18), 'tokens');
  console.log('  Custody:', ethers.formatUnits(custodyBalance, 18), 'tokens');
  console.log();
  
  // Transfer tokens to custody if needed
  if (custodyBalance < adminBalance) {
    console.log('📦 Transferring tokens to platform custody...');
    const tx = await tokenContract.transfer(platformCustody, adminBalance);
    console.log('TX:', tx.hash);
    await tx.wait();
    console.log('✅ Tokens transferred');
    console.log();
  }
  
  // Check custody balance again
  const newCustodyBalance = await tokenContract.balanceOf(platformCustody);
  console.log('New custody balance:', ethers.formatUnits(newCustodyBalance, 18), 'tokens');
  
  // Check and approve marketplace
  const custodyWallet = new ethers.Wallet(process.env.CUSTODY_PRIVATE_KEY || adminPrivateKey, provider);
  const tokenAsCustody = new ethers.Contract(tokenAddress, TOKEN_ABI, custodyWallet);
  
  const allowance = await tokenAsCustody.allowance(platformCustody, deployedContracts.contracts.PrimaryMarketplace);
  console.log('Current allowance:', ethers.formatUnits(allowance, 18), 'tokens');
  
  if (allowance < newCustodyBalance) {
    console.log('✅ Approving marketplace to spend tokens...');
    const approveTx = await tokenAsCustody.approve(
      deployedContracts.contracts.PrimaryMarketplace,
      ethers.MaxUint256
    );
    console.log('TX:', approveTx.hash);
    await approveTx.wait();
    console.log('✅ Marketplace approved');
  }
  
  console.log();
  console.log('✅ Marketplace is ready for trading!');
}

prepareMarketplace();
