#!/usr/bin/env node

const { ethers } = require('ethers');
const { readFileSync } = require('fs');

const INVESTOR_PRIVATE_KEY = process.env.INVESTOR_PRIVATE_KEY;
const ASSET_ID = process.argv[2];
const BID_INDEX = process.argv[3];

async function settleBid() {
  try {
    console.error('Starting settlement...');
    console.error('Asset ID:', ASSET_ID);
    console.error('Bid Index:', BID_INDEX);

    const deployedContracts = JSON.parse(
      readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
    );

    const MARKETPLACE_ABI = [
      'function settleBid(bytes32 assetId, uint256 bidIndex) external',
    ];

    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet(INVESTOR_PRIVATE_KEY, provider);

    const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;
    const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);

    // Convert UUID to bytes32
    const assetIdBytes32 = '0x' + ASSET_ID.replace(/-/g, '').padEnd(64, '0');

    console.error('Asset ID (bytes32):', assetIdBytes32);
    console.error('Bid Index:', BID_INDEX);
    console.error('Investor:', wallet.address);
    console.error('Marketplace:', marketplaceAddress);
    console.error('');

    // Settle the bid
    console.error('Submitting settleBid transaction...');
    const tx = await marketplaceContract.settleBid(assetIdBytes32, BID_INDEX);
    console.error('TX Hash:', tx.hash);
    console.error('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.error('Confirmed in block', receipt.blockNumber);
    console.error('');

    // Return result
    console.log(JSON.stringify({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber.toString()
    }));

  } catch (error) {
    console.error('ERROR:', error.message);
    if (error.reason) console.error('Reason:', error.reason);
    if (error.code) console.error('Code:', error.code);
    if (error.data) console.error('Data:', JSON.stringify(error.data));
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    process.exit(1);
  }
}

settleBid().catch(err => {
  console.error('Unhandled error:', err.message);
  console.error(err);
  process.exit(1);
});
