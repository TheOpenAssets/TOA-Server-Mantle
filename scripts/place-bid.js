#!/usr/bin/env node

/**
 * Place Bid Script
 *
 * Places a bid on an auction in the Primary Marketplace
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
  'function submitBid(bytes32 assetId, uint256 tokenAmount, uint256 price) external',
  'function listings(bytes32) view returns (address tokenAddress, bytes32 assetId, uint8 listingType, uint256 staticPrice, uint256 startPrice, uint256 endPrice, uint256 duration, uint256 startTime, uint256 totalSupply, uint256 sold, bool active, uint256 minInvestment)',
  'function getBidCount(bytes32 assetId) view returns (uint256)',
];

async function placeBid() {
  // Get parameters from command line
  const assetId = process.argv[2];
  const tokenAmount = process.argv[3];
  const pricePerToken = process.argv[4];

  if (!assetId || !tokenAmount || !pricePerToken) {
    console.error('Usage: node place-bid.js <asset-id> <token-amount> <price-per-token>');
    console.error('');
    console.error('Example: node place-bid.js 4d02feaa-7b32-4c35-980f-5710b73a982a 1000 0.95');
    console.error('  - asset-id: UUID of the auction');
    console.error('  - token-amount: Number of tokens to bid for (in whole tokens, e.g., 1000)');
    console.error('  - price-per-token: Price per token in USDC (e.g., 0.95 means $0.95 per token)');
    process.exit(1);
  }

  console.log('🎯 Placing Bid on Auction');
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

  // Convert inputs to wei values
  const tokenAmountWei = ethers.parseUnits(tokenAmount, 18); // Tokens have 18 decimals
  const priceWei = ethers.parseUnits(pricePerToken, 6); // USDC has 6 decimals

  console.log(`Asset ID: ${assetId}`);
  console.log(`Asset ID (bytes32): ${assetIdBytes32}`);
  console.log(`Bidder: ${wallet.address}`);
  console.log(`Marketplace: ${marketplaceAddress}`);
  console.log(`USDC: ${usdcAddress}`);
  console.log(`Token Amount: ${tokenAmount} tokens (${tokenAmountWei.toString()} wei)`);
  console.log(`Price Per Token: ${pricePerToken} USDC (${priceWei.toString()} USDC wei)`);
  console.log();

  try {
    // Get listing info
    console.log('📋 Fetching auction info...');
    const listing = await marketplaceContract.listings(assetIdBytes32);
    const tokenAddress = listing[0];
    const listingType = listing[2];
    const startPrice = listing[4];
    const endPrice = listing[5];
    const minInvestment = listing[11];

    console.log(`Token Address: ${tokenAddress}`);
    console.log(`Listing Type: ${listingType === 1 ? 'AUCTION' : 'FIXED_PRICE'}`);
    console.log(`Price Range: ${ethers.formatUnits(endPrice, 6)} - ${ethers.formatUnits(startPrice, 6)} USDC per token`);
    console.log(`Min Investment: ${ethers.formatUnits(minInvestment, 18)} tokens`);
    console.log();

    // Verify it's an auction
    if (listingType !== 1) {
      console.error('❌ Error: This asset is not an auction!');
      process.exit(1);
    }

    // Verify price is within range
    if (priceWei < endPrice || priceWei > startPrice) {
      console.error(`❌ Error: Price ${pricePerToken} USDC is outside the allowed range`);
      console.error(`   Allowed range: ${ethers.formatUnits(endPrice, 6)} - ${ethers.formatUnits(startPrice, 6)} USDC`);
      process.exit(1);
    }

    // Verify minimum investment
    if (tokenAmountWei < minInvestment) {
      console.error(`❌ Error: Token amount ${tokenAmount} is below minimum investment`);
      console.error(`   Minimum: ${ethers.formatUnits(minInvestment, 18)} tokens`);
      process.exit(1);
    }

    // Calculate USDC deposit needed
    // Contract formula: deposit = price * tokenAmount / 1e18
    const depositNeeded = (priceWei * tokenAmountWei) / ethers.parseUnits('1', 18);

    console.log(`💰 USDC Deposit Required: ${ethers.formatUnits(depositNeeded, 6)} USDC`);
    console.log(`   Calculation: ${pricePerToken} USDC/token × ${tokenAmount} tokens = ${ethers.formatUnits(depositNeeded, 6)} USDC`);
    console.log();

    // Check USDC balance
    const usdcBalance = await usdcContract.balanceOf(wallet.address);
    console.log(`USDC Balance: ${ethers.formatUnits(usdcBalance, 6)} USDC`);

    if (usdcBalance < depositNeeded) {
      console.error('❌ Insufficient USDC balance!');
      console.error(`   Required: ${ethers.formatUnits(depositNeeded, 6)} USDC`);
      console.error(`   Available: ${ethers.formatUnits(usdcBalance, 6)} USDC`);
      process.exit(1);
    }
    console.log();

    // Get current bid count
    try {
      const bidCount = await marketplaceContract.getBidCount(assetIdBytes32);
      console.log(`Current Bids: ${bidCount.toString()}`);
      console.log();
    } catch (e) {
      // getBidCount might not exist, skip
    }

    // Step 1: Approve USDC
    console.log('✅ Step 1: Approving USDC...');
    const allowance = await usdcContract.allowance(wallet.address, marketplaceAddress);

    if (allowance < depositNeeded) {
      const approveTx = await usdcContract.approve(marketplaceAddress, depositNeeded);
      console.log(`Approve TX: ${approveTx.hash}`);
      await approveTx.wait();
      console.log('✅ USDC approved');
    } else {
      console.log('✅ USDC already approved');
    }
    console.log();

    // Step 2: Submit bid
    console.log('✅ Step 2: Submitting bid...');
    console.log(`Parameters:`);
    console.log(`  - assetId: ${assetIdBytes32}`);
    console.log(`  - tokenAmount: ${tokenAmountWei.toString()} (${tokenAmount} tokens)`);
    console.log(`  - price: ${priceWei.toString()} (${pricePerToken} USDC)`);
    console.log();

    const bidTx = await marketplaceContract.submitBid(assetIdBytes32, tokenAmountWei, priceWei);
    console.log(`Bid TX: ${bidTx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await bidTx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
    console.log();

    // Check balances after
    const usdcBalanceAfter = await usdcContract.balanceOf(wallet.address);

    console.log('✅ Bid Placed Successfully!');
    console.log('━'.repeat(50));
    console.log(`USDC Deposited: ${ethers.formatUnits(usdcBalance - usdcBalanceAfter, 6)} USDC`);
    console.log(`Tokens Bid For: ${tokenAmount} tokens`);
    console.log(`Bid Price: ${pricePerToken} USDC per token`);
    console.log(`New USDC Balance: ${ethers.formatUnits(usdcBalanceAfter, 6)} USDC`);
    console.log();
    console.log(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${bidTx.hash}`);
    console.log();

    // Generate backend notification curl command
    console.log('📝 Backend Notification:');
    console.log('━'.repeat(50));
    console.log('To notify the backend about this bid, run:');
    console.log();
    console.log('First, get your auth token by logging in:');
    console.log(`INVESTOR_PRIVATE_KEY=${investorPrivateKey} node scripts/sign-investor-login.js`);
    console.log();
    console.log('Then notify the backend (replace <JWT_TOKEN> with your token):');
    console.log();
    console.log(`curl -X POST http://localhost:3000/marketplace/bids/notify \\`);
    console.log(`  -H "Content-Type: application/json" \\`);
    console.log(`  -H "Authorization: Bearer <JWT_TOKEN>" \\`);
    console.log(`  -d '{`);
    console.log(`    "txHash": "${bidTx.hash}",`);
    console.log(`    "assetId": "${assetId}",`);
    console.log(`    "tokenAmount": "${tokenAmountWei.toString()}",`);
    console.log(`    "price": "${priceWei.toString()}",`);
    console.log(`    "blockNumber": "${receipt.blockNumber}"`);
    console.log(`  }'`);
    console.log();

  } catch (error) {
    console.error('\n❌ Error placing bid:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    if (error.reason) {
      console.error('Reason:', error.reason);
    }
    process.exit(1);
  }
}

placeBid();
