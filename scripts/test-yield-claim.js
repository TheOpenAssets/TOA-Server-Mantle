#!/usr/bin/env node

/**
 * Test if YieldVault can claim yield for a token
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const YIELD_VAULT_ABI = [
  'function assets(address) view returns (address tokenAddress, bytes32 assetId, address issuer, uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, uint256 settlementTimestamp, bool isSettled)',
  'function getSettlementInfo(address) view returns (uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, uint256 yieldPerToken)',
];

const TOKEN_ADDRESS = '0xB7292c58e9Af0b32A87dbf19056B54c74fD0b8A8'; // TINV

async function test() {
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  
  const yieldVault = new ethers.Contract(
    deployedContracts.contracts.YieldVault,
    YIELD_VAULT_ABI,
    provider
  );

  console.log('Checking YieldVault asset info for:', TOKEN_ADDRESS);
  console.log('');

  try {
    const asset = await yieldVault.assets(TOKEN_ADDRESS);
    console.log('Asset Info:');
    console.log('  Token Address:', asset.tokenAddress);
    console.log('  Asset ID:', asset.assetId);
    console.log('  Total Settlement:', ethers.formatUnits(asset.totalSettlement, 6), 'USDC');
    console.log('  Total Token Supply:', ethers.formatEther(asset.totalTokenSupply));
    console.log('  Total Claimed:', ethers.formatUnits(asset.totalClaimed, 6), 'USDC');
    console.log('  Total Tokens Burned:', ethers.formatEther(asset.totalTokensBurned));
    console.log('  Is Settled:', asset.isSettled);
    console.log('');

    if (!asset.isSettled) {
      console.log('❌ Asset is NOT settled!');
      console.log('The depositYield transaction did not set isSettled = true');
    } else {
      console.log('✅ Asset is settled and ready for claiming!');
    }
  } catch (error) {
    console.log('❌ Error reading asset info:',error.message);
  }
}

test().catch(console.error);
