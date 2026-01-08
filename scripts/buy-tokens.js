#!/usr/bin/env node

/**
 * Buy Tokens Script
 *
 * Purchases RWA tokens from the Primary Marketplace
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

// Load deployed contracts
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

// ABIs
const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

const MARKETPLACE_ABI = [
  'function buyTokens(bytes32 assetId, uint256 amount) external',
  'function getCurrentPrice(bytes32 assetId) view returns (uint256)',
  'function listings(bytes32) view returns (address tokenAddress, bytes32 assetId, uint8 listingType, uint256 staticPrice, uint256 startPrice, uint256 endPrice, uint256 duration, uint256 startTime, uint256 totalSupply, uint256 sold, bool active, uint256 minInvestment)',
];

const TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

async function buyTokens() {
  // Get parameters from command line
  const assetId = process.argv[2] || '4d02feaa-7b32-4c35-980f-5710b73a982a';
  const tokenAmount = process.argv[3] || '1000'; // Default min investment

  console.log('🛒 Buying RWA Tokens from Marketplace');
  console.log('━'.repeat(50));

  // Investor wallet (from sign-admin-login.js - this is actually the admin/investor address)
  const investorPrivateKey = process.env.INVESTOR_PRIVATE_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';

  // Connect to Mantle Sepolia
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const wallet = new ethers.Wallet(investorPrivateKey, provider);

  // Contract addresses
  const usdcAddress = deployedContracts.contracts.USDC;
  const marketplaceAddress = deployedContracts.contracts.PrimaryMarketplace;

  // Contract instances
  const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);
  const marketplaceContract = new ethers.Contract(marketplaceAddress, MARKETPLACE_ABI, wallet);

  // Convert UUID to bytes32 (same as backend logic)
  const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

  console.log(`Asset ID: ${assetId}`);
  console.log(`Asset ID (bytes32): ${assetIdBytes32}`);
  console.log(`Buyer: ${wallet.address}`);
  console.log(`Marketplace: ${marketplaceAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`Token Amount: ${tokenAmount} tokens`);
  console.log();

  try {
    // Get listing info
    console.log('📋 Fetching listing info...');
    const listing = await marketplaceContract.listings(assetIdBytes32);
    const tokenAddress = listing[0];
    const currentPrice = await marketplaceContract.getCurrentPrice(assetIdBytes32);

    console.log(`Token Address: ${tokenAddress}`);
    console.log(`Current Price: ${ethers.formatUnits(currentPrice, 18)} USDC per token`);
    console.log(`Min Investment: ${ethers.formatUnits(listing[11], 18)} tokens`);
    console.log(`Sold: ${ethers.formatUnits(listing[9], 18)} / ${ethers.formatUnits(listing[8], 18)} tokens`);
    console.log();

    // Calculate payment needed
    // Contract formula: payment = price * amount / 1e18
    // where price should be in USDC wei (6 decimals) and amount is in token wei (18 decimals)
    const tokenAmountWei = ethers.parseUnits(tokenAmount, 18);
    const payment = (currentPrice * tokenAmountWei) / ethers.parseUnits('1', 18);

    console.log(`💰 Payment Required (raw): ${payment.toString()}`);
    console.log(`💰 Payment Required: ${ethers.formatUnits(payment, 6)} USDC (if price is in USDC wei)`);
    console.log(`   Note: Price was set incorrectly - should be in USDC wei (6 decimals), not 18`);
    console.log();

    // Check USDC balance
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

    if (usdcBalance < payment) {
      console.error('❌ Insufficient USDC balance!');
      process.exit(1);
    }

    // Check token balance before
    const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, wallet);
    const tokenBalanceBefore = await tokenContract.balanceOf(wallet.address);
    console.log(`Token Balance Before: ${ethers.formatUnits(tokenBalanceBefore, 18)} tokens`);
    console.log();

    // Step 1: Approve USDC
    console.log('✅ Step 1: Approving USDC...');
    const allowance = await usdcContract.allowance(wallet.address, marketplaceAddress);

    if (allowance < payment) {
      const approveTx = await usdcContract.approve(marketplaceAddress, payment);
      console.log(`Approve TX: ${approveTx.hash}`);
      await approveTx.wait();
      console.log('✅ USDC approved');
    } else {
      console.log('✅ USDC already approved');
    }
    console.log();

    // Step 2: Buy tokens
    console.log('✅ Step 2: Buying tokens...');
    const buyTx = await marketplaceContract.buyTokens(assetIdBytes32, tokenAmountWei);
    console.log(`Buy TX: ${buyTx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await buyTx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
    console.log();

    // Check balances after
    const usdcBalanceAfter = await usdcContract.balanceOf(wallet.address);
    const tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);

    console.log('✅ Purchase Complete!');
    console.log('━'.repeat(50));
    console.log(`USDC Spent: ${ethers.formatUnits(usdcBalance - usdcBalanceAfter, 6)} USDC`);
    console.log(`Tokens Received: ${ethers.formatUnits(tokenBalanceAfter - tokenBalanceBefore, 18)} tokens`);
    console.log(`New Token Balance: ${ethers.formatUnits(tokenBalanceAfter, 18)} tokens`);
    console.log(`New USDC Balance: ${ethers.formatUnits(usdcBalanceAfter, 6)} USDC`);
    console.log();
    console.log(`Explorer: https://sepolia.mantlescan.xyz/tx/${buyTx.hash}`);
    console.log();
    console.log('📝 Transaction details for backend notification:');
    console.log(JSON.stringify({
      txHash: buyTx.hash,
      assetId: assetId,
      buyer: wallet.address,
      amount: tokenAmount,
      blockNumber: receipt.blockNumber
    }, null, 2));

  } catch (error) {
    console.error('\n❌ Error buying tokens:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    process.exit(1);
  }
}

buyTokens();
