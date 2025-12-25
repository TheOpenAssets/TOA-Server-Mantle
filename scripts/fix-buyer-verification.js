import 'dotenv/config';
import { ethers } from 'ethers';

/**
 * Quick fix script to verify a buyer in the IdentityRegistry
 * Run this if the buyer is not verified for a specific token
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const TOKEN_ADDRESS = process.argv[2] || '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';
const BUYER_ADDRESS = process.argv[3] || '0x6F662Dc7814aD324a361D0D1B0D1a457222eb42f';

const TOKEN_ABI = [
  'function identityRegistry() view returns (address)',
];

const IDENTITY_REGISTRY_ABI = [
  'function isVerified(address) view returns (bool)',
  'function registerIdentity(address, (uint16, bytes32, uint256)) external',
];

async function main() {
  console.log('\n🔧 Fixing Buyer Verification...\n');
  console.log('━'.repeat(60));

  if (!TOKEN_ADDRESS || !BUYER_ADDRESS) {
    console.error('❌ Usage: node fix-buyer-verification.js <TOKEN_ADDRESS> <BUYER_ADDRESS>');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`Buyer: ${BUYER_ADDRESS}`);
  console.log(`Admin: ${wallet.address}\n`);

  try {
    // 1. Get IdentityRegistry address
    const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);
    const identityRegistryAddress = await token.identityRegistry();

    console.log(`Identity Registry: ${identityRegistryAddress}`);

    // 2. Check current status
    const identityRegistry = new ethers.Contract(
      identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      wallet
    );

    const isVerified = await identityRegistry.isVerified(BUYER_ADDRESS);
    console.log(`Current Status: ${isVerified ? '✅ Already Verified' : '❌ Not Verified'}`);

    if (isVerified) {
      console.log('\n✅ Buyer is already verified! No action needed.');
      return;
    }

    // 3. Register the buyer
    console.log('\n📝 Registering buyer in IdentityRegistry...');

    const identity = {
      country: 840, // USA
      investorId: ethers.id(`investor-${BUYER_ADDRESS}`),
      attributes: 0,
    };

    const tx = await identityRegistry.registerIdentity(BUYER_ADDRESS, identity);
    console.log(`TX Hash: ${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // 4. Verify it worked
    const nowVerified = await identityRegistry.isVerified(BUYER_ADDRESS);
    console.log(`\nNew Status: ${nowVerified ? '✅ VERIFIED' : '❌ Still Not Verified'}`);

    if (nowVerified) {
      console.log('\n✅ SUCCESS! Buyer is now verified.');
      console.log(`\nYou can now purchase tokens from ${TOKEN_ADDRESS}`);
    } else {
      console.log('\n❌ Verification failed. Check contract permissions.');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.data) {
      console.error('Error data:', error.data);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
