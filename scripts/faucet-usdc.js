#!/usr/bin/env node

/**
 * Faucet Script
 *
 * Interactive faucet to request MockUSDC tokens from the Faucet contract
 */

import { config } from 'dotenv';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createInterface } from 'readline';

// Load environment variables from .env file
config();

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load deployed contracts
const deployedContractsPath = path.join(__dirname, '../packages/contracts/deployed_contracts.json');
const deployedContracts = JSON.parse(
  readFileSync(deployedContractsPath, 'utf-8')
);

// Faucet ABI
const FAUCET_ABI = [
  'function requestUSDC(uint256 amountInUSDC) external',
  'function requestTokens(uint256 amount) external',
  'function mockUSDC() view returns (address)',
];

// USDC ABI for balance check
const USDC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function createReadlineInterface() {
  return createInterface({
    input: process.stdin,
    output: process.stdout
  });
}

function question(rl, query) {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
}

async function faucet() {
  console.log('🚰 Faucet for MockUSDC');
  console.log('━'.repeat(50));

  const args = process.argv.slice(2);
  let recipient, amountInUSDC;

  if (args.length >= 2) {
    // Command line mode
    recipient = args[0];
    amountInUSDC = args[1];
  } else {
    // Interactive mode
    const rl = createReadlineInterface();

    try {
      // Get recipient address (defaults to wallet address)
      const recipientInput = await question(rl, 'Enter recipient address (or press enter for your wallet): ');
      recipient = recipientInput.trim() === '' ? null : recipientInput.trim();

      // Get amount
      const amountInput = await question(rl, 'Enter amount in USDC (default 1000): ');
      amountInUSDC = amountInput.trim() === '' ? '1000' : amountInput.trim();
    } finally {
      rl.close();
    }
  }

  // Validate inputs
  if (args.length >= 2) {
    // Command line mode: recipient is required
    if (!recipient || !ethers.isAddress(recipient)) {
      console.error('❌ Invalid recipient address');
      process.exit(1);
    }
  } else {
    // Interactive mode: recipient can be null (will use wallet)
    if (recipient && !ethers.isAddress(recipient)) {
      console.error('❌ Invalid Ethereum address');
      process.exit(1);
    }
  }
  if (isNaN(amountInUSDC) || parseFloat(amountInUSDC) <= 0) {
    console.error('❌ Invalid amount');
    process.exit(1);
  }

  try {
    console.log('\n🪙 Requesting Mock USDC Tokens from Faucet');
    console.log('━'.repeat(50));

    // Use wallet
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      console.error('❌ PRIVATE_KEY environment variable not set');
      process.exit(1);
    }

    // Connect to Mantle Sepolia
    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet(privateKey, provider);

    const faucetAddress = deployedContracts.contracts.Faucet;
    const faucetContract = new ethers.Contract(faucetAddress, FAUCET_ABI, wallet);

    const usdcAddress = await faucetContract.mockUSDC();
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, provider);

    const finalRecipient = recipient || wallet.address;

    console.log(`Faucet Contract: ${faucetAddress}`);
    console.log(`USDC Contract: ${usdcAddress}`);
    console.log(`Requester: ${wallet.address}`);
    console.log(`Recipient: ${finalRecipient}`);
    console.log(`Amount: ${amountInUSDC} USDC`);
    console.log();

    // Check balance before
    const balanceBefore = await usdcContract.balanceOf(finalRecipient);
    console.log(`Balance before: ${ethers.formatUnits(balanceBefore, 6)} USDC`);

    // Request tokens
    console.log('\n⏳ Requesting tokens from faucet...');
    const tx = await faucetContract.requestUSDC(amountInUSDC);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    // Wait for transaction
    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // Check balance after
    const balanceAfter = await usdcContract.balanceOf(finalRecipient);

    console.log('\n✅ Success!');
    console.log(`Balance after: ${ethers.formatUnits(balanceAfter, 6)} USDC`);
    console.log(`Received: ${ethers.formatUnits(balanceAfter - balanceBefore, 6)} USDC`);
    console.log(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    // Close readline if it was opened
    if (typeof rl !== 'undefined' && rl) {
      rl.close();
    }
  }
}

faucet();