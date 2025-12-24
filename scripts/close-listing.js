#!/usr/bin/env node
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const MARKETPLACE_ABI = [
  'function closeListing(bytes32 assetId) external',
];

async function closeListing() {
  const assetId = process.argv[2] || '4d02feaa-7b32-4c35-980f-5710b73a982a';
  const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');
  
  const adminPrivateKey = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const wallet = new ethers.Wallet(adminPrivateKey, provider);
  
  const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;
  const marketplace = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);
  
  console.log('Closing listing for', assetId);
  const tx = await marketplace.closeListing(assetIdBytes32);
  console.log('TX:', tx.hash);
  await tx.wait();
  console.log('✅ Listing closed');
}

closeListing();
