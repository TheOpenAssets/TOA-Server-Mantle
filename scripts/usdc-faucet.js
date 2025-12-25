#!/usr/bin/env node

/**
 * MockUSDC Faucet Script
 *
 * Interactive faucet to mint MockUSDC tokens to any address
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import * as readline from 'readline';

// Load deployed contracts
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

// MockUSDC ABI (only the functions we need)
const USDC_ABI = [
  'function mint(address to, uint256 amount) external',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

function createReadlineInterface() {
  return readline.createInterface({
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
  console.log('🚰 MockUSDC Faucet');
  console.log('━'.repeat(50));

  const rl = createReadlineInterface();

  try {
    // Get recipient address
    const recipient = await question(rl, 'Enter recipient address: ');
    if (!ethers.isAddress(recipient)) {
      console.error('❌ Invalid Ethereum address');
      process.exit(1);
    }

    // Get amount
    const amountInput = await question(rl, 'Enter amount in USDC (default 10000): ');
    const amountInUSDC = amountInput.trim() === '' ? '10000' : amountInput.trim();

    // Validate amount
    if (isNaN(amountInUSDC) || parseFloat(amountInUSDC) <= 0) {
      console.error('❌ Invalid amount');
      process.exit(1);
    }

    console.log('\n🪙 Minting Mock USDC Tokens');
    console.log('━'.repeat(50));

    // Use admin wallet to mint (any wallet can mint from MockUSDC)
    const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';

    // Connect to Mantle Sepolia
    const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
    const wallet = new ethers.Wallet(adminPrivateKey, provider);

    const usdcAddress = deployedContracts.contracts.USDC;
    const usdcContract = new ethers.Contract(usdcAddress, USDC_ABI, wallet);

    console.log(`USDC Contract: ${usdcAddress}`);
    console.log(`Minter: ${wallet.address}`);
    console.log(`Recipient: ${recipient}`);
    console.log(`Amount: ${amountInUSDC} USDC`);
    console.log();

    // USDC has 6 decimals
    const amount = ethers.parseUnits(amountInUSDC, 6);

    // Check balance before
    const balanceBefore = await usdcContract.balanceOf(recipient);
    console.log(`Balance before: ${ethers.formatUnits(balanceBefore, 6)} USDC`);

    // Mint tokens
    console.log('\n⏳ Minting tokens...');
    const tx = await usdcContract.mint(recipient, amount);
    console.log(`Transaction hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    // Wait for transaction
    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // Check balance after
    const balanceAfter = await usdcContract.balanceOf(recipient);

    console.log('\n✅ Success!');
    console.log(`Balance after: ${ethers.formatUnits(balanceAfter, 6)} USDC`);
    console.log(`Minted: ${ethers.formatUnits(balanceAfter - balanceBefore, 6)} USDC`);
    console.log(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

faucet();