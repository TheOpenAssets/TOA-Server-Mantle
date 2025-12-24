#!/usr/bin/env node
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const MARKETPLACE_ABI = [
  'function listings(bytes32) view returns (address tokenAddress, bytes32 assetId, uint8 listingType, uint256 staticPrice, uint256 startPrice, uint256 endPrice, uint256 duration, uint256 startTime, uint256 totalSupply, uint256 sold, bool active, uint256 minInvestment)',
  'function getCurrentPrice(bytes32 assetId) view returns (uint256)',
];

async function checkListing() {
  const assetId = '4d02feaa-7b32-4c35-980f-5710b73a982a';
  const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');
  
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const marketplace = new ethers.Contract(
    deployedContracts.contracts.PrimaryMarketplace,
    MARKETPLACE_ABI,
    provider
  );
  
  console.log('Checking listing for:', assetId);
  console.log('AssetId (bytes32):', assetIdBytes32);
  console.log();
  
  const listing = await marketplace.listings(assetIdBytes32);
  const currentPrice = await marketplace.getCurrentPrice(assetIdBytes32);
  
  console.log('Listing Details:');
  console.log('  Active:', listing[10]);
  console.log('  Token Address:', listing[0]);
  console.log('  Static Price (raw):', listing[3].toString());
  console.log('  Static Price (USDC):', ethers.formatUnits(listing[3], 6), 'USDC');
  console.log('  Current Price (raw):', currentPrice.toString());
  console.log('  Min Investment (raw):', listing[11].toString());
  console.log('  Min Investment (tokens):', ethers.formatUnits(listing[11], 18), 'tokens');
  console.log('  Total Supply (raw):', listing[8].toString());
  console.log('  Total Supply (tokens):', ethers.formatUnits(listing[8], 18), 'tokens');
  console.log('  Sold:', ethers.formatUnits(listing[9], 18), 'tokens');
}

checkListing();
