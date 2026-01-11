#!/usr/bin/env node

/**
 * Create Static Listing on PrimaryMarket
 * Reads asset from backend and creates marketplace listing
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const assetId = process.argv[2];
if (!assetId) {
  console.error('❌ Usage: node create-static-listing.js <assetId>');
  process.exit(1);
}

const ORIGINATOR_KEY = process.env.ORIGINATOR_PRIVATE_KEY || '0x435c9985dbc29c3abdd9529439b38990260e32949a9bdd22cd09733c0512ee4c';
const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const API_URL = process.env.API_URL || 'http://localhost:3000';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const PRIMARY_MARKET_ABI = [
  'function createListing(bytes32 assetId, address tokenAddress, uint8 listingType, uint256 priceOrReserve, uint256 duration, uint256 totalSupply, uint256 minInvestment) external',
];

async function main() {
  console.log('\n📊 Creating static listing for asset:', assetId);

  // Fetch asset from backend
  const response = await fetch(`${API_URL}/api/assets/${assetId}`);
  if (!response.ok) {
    console.error('❌ Asset not found in backend');
    process.exit(1);
  }

  const asset = await response.json();
  console.log('   Name:', asset.name);
  console.log('   Token:', asset.tokenAddress);
  console.log('   Price:', `$${asset.pricePerToken}`);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ORIGINATOR_KEY, provider);
  const primaryMarket = new ethers.Contract(
    deployedContracts.contracts.PrimaryMarket,
    PRIMARY_MARKET_ABI,
    wallet
  );

  const assetIdBytes = ethers.encodeBytes32String(assetId.substring(0, 31));
  const pricePerToken = ethers.parseUnits(asset.pricePerToken.toString(), 6); // USDC decimals
  const totalSupply = ethers.parseUnits(asset.totalSupply.toString(), 18);
  const minInvestment = ethers.parseUnits('100', 6); // $100 minimum

  console.log('\n📝 Creating listing on PrimaryMarket...');
  const tx = await primaryMarket.createListing(
    assetIdBytes,
    asset.tokenAddress,
    0, // STATIC listing type
    pricePerToken,
    0, // No duration for static
    totalSupply,
    minInvestment
  );

  console.log('   TX:', tx.hash);
  await tx.wait();
  console.log('✅ Listing created!\n');
}

main().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
