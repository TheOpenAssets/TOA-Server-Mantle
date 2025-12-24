#!/usr/bin/env node

/**
 * Mint Mock USDC Script
 *
 * Mints mock USDC tokens to a specified address for testing
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

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

async function mintUSDC() {
  // Get recipient from command line or use default investor address
  const recipient = process.argv[2] || '0x23e67597f0898f747Fa3291C8920168adF9455D0';
  const amountInUSDC = process.argv[3] || '10000'; // Default 10k USDC

  console.log('🪙 Minting Mock USDC Tokens');
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

  try {
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
    console.error('\n❌ Error minting USDC:', error.message);
    process.exit(1);
  }
}

mintUSDC();
