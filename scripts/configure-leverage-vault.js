#!/usr/bin/env node

/**
 * Configure LeverageVault with PrimaryMarket address
 * Sets the marketplace so leverage positions can purchase RWA tokens
 */

const { ethers } = require('ethers');
require('dotenv').config({ path: '../backend/.env' });

const LEVERAGE_VAULT_ADDRESS = process.env.LeverageVault || '0xB3DeAa93f33f202EAa9D8fe405FDA87287b84dD7';
const PRIMARY_MARKETPLACE_ADDRESS = process.env.PRIMARY_MARKETPLACE_ADDRESS || '0x034Ca27695555CEeB44CB62d59c4E3f95F4Ef504';
const ADMIN_KEY = process.env.ADMIN_KEY;
const RPC_URL = process.env.MANTLE_RPC_URL || 'https://rpc.sepolia.mantle.xyz';

if (!ADMIN_KEY) {
  console.error('❌ Error: ADMIN_KEY environment variable not set');
  process.exit(1);
}

const LeverageVaultABI = [
  "function primaryMarket() view returns (address)",
  "function setPrimaryMarket(address _primaryMarket) external",
  "function owner() view returns (address)"
];

async function main() {
  console.log('');
  console.log('========================================');
  console.log('Configure LeverageVault');
  console.log('========================================');
  console.log('');

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);

  console.log('Admin Address:', wallet.address);
  console.log('LeverageVault:', LEVERAGE_VAULT_ADDRESS);
  console.log('PrimaryMarket:', PRIMARY_MARKETPLACE_ADDRESS);
  console.log('');

  // Connect to contract
  const leverageVault = new ethers.Contract(
    LEVERAGE_VAULT_ADDRESS,
    LeverageVaultABI,
    wallet
  );

  // Check owner
  console.log('🔍 Checking ownership...');
  const owner = await leverageVault.owner();
  console.log('Contract Owner:', owner);

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error('❌ Error: Admin wallet is not the owner of LeverageVault');
    console.error(`   Owner: ${owner}`);
    console.error(`   Admin: ${wallet.address}`);
    process.exit(1);
  }

  console.log('✅ Admin is owner');
  console.log('');

  // Check current primaryMarket
  console.log('📋 Checking current configuration...');
  const currentPrimaryMarket = await leverageVault.primaryMarket();
  console.log('Current PrimaryMarket:', currentPrimaryMarket);

  if (currentPrimaryMarket === PRIMARY_MARKETPLACE_ADDRESS) {
    console.log('✅ PrimaryMarket already configured correctly');
    console.log('');
    process.exit(0);
  }

  if (currentPrimaryMarket !== ethers.ZeroAddress) {
    console.log('⚠️  PrimaryMarket is already set to a different address');
    console.log('   Current:', currentPrimaryMarket);
    console.log('   New:', PRIMARY_MARKETPLACE_ADDRESS);
    console.log('');
  }

  // Set PrimaryMarket
  console.log('🔨 Setting PrimaryMarket address...');
  try {
    const tx = await leverageVault.setPrimaryMarket(PRIMARY_MARKETPLACE_ADDRESS);
    console.log('Transaction sent:', tx.hash);
    console.log('Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());
    console.log('');

    // Verify
    const newPrimaryMarket = await leverageVault.primaryMarket();
    console.log('Verification:');
    console.log('   PrimaryMarket:', newPrimaryMarket);

    if (newPrimaryMarket === PRIMARY_MARKETPLACE_ADDRESS) {
      console.log('✅ Configuration successful!');
    } else {
      console.log('❌ Configuration failed - address mismatch');
    }

  } catch (error) {
    console.error('❌ Transaction failed:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
    process.exit(1);
  }

  console.log('');
  console.log('========================================');
  console.log('✅ LeverageVault Configuration Complete');
  console.log('========================================');
  console.log('');
  console.log('LeverageVault is now ready to create positions!');
  console.log('');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
