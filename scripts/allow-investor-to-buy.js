import 'dotenv/config';
import { ethers } from 'ethers';

/**
 * Manual script to allow an investor to buy a specific token
 * This adds the investor to the IdentityRegistry for that token
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Configuration - CHANGE THESE VALUES
const TOKEN_ADDRESS = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db'; // The failing token
const INVESTOR_ADDRESS = '0x6F662Dc7814aD324a361D0D1B0D1a457222eb42f'; // The buyer

// ABIs
const TOKEN_ABI = [
  'function identityRegistry() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const IDENTITY_REGISTRY_ABI = [
  'function isVerified(address) view returns (bool)',
  'function registerIdentity(address _userAddress, tuple(uint16 investorCountry, bytes32 investorID, uint256 investorType) _identity) external',
  'function investorCountry(address) view returns (uint16)',
];

async function main() {
  console.log('\n🔓 Allowing Investor to Buy Token...\n');
  console.log('━'.repeat(60));

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`\n📋 Configuration:`);
  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`Investor: ${INVESTOR_ADDRESS}`);
  console.log(`Admin: ${wallet.address}`);

  try {
    // 1. Get token info
    console.log('\n\n1️⃣ Getting Token Info...');
    console.log('━'.repeat(60));
    const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);

    const tokenName = await token.name();
    const tokenSymbol = await token.symbol();
    const identityRegistryAddress = await token.identityRegistry();

    console.log(`Token: ${tokenName} (${tokenSymbol})`);
    console.log(`Identity Registry: ${identityRegistryAddress}`);

    // 2. Check current verification status
    console.log('\n\n2️⃣ Checking Current Status...');
    console.log('━'.repeat(60));
    const identityRegistry = new ethers.Contract(
      identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      wallet
    );

    const isVerified = await identityRegistry.isVerified(INVESTOR_ADDRESS);
    console.log(`Current Status: ${isVerified ? '✅ Already Verified' : '❌ Not Verified'}`);

    if (isVerified) {
      const country = await identityRegistry.investorCountry(INVESTOR_ADDRESS);
      console.log(`Country Code: ${country}`);
      console.log('\n✅ Investor is already verified! They should be able to buy.');
      console.log('\nIf purchase is still failing, the issue might be:');
      console.log('  - Compliance module restrictions');
      console.log('  - Insufficient USDC balance');
      console.log('  - Insufficient USDC allowance');
      console.log('  - Listing configuration issue');
      return;
    }

    // 3. Register the investor
    console.log('\n\n3️⃣ Registering Investor...');
    console.log('━'.repeat(60));

    const identity = {
      investorCountry: 840, // USA (840 is ISO 3166-1 numeric code)
      investorID: ethers.id(`investor-${INVESTOR_ADDRESS}-${Date.now()}`),
      investorType: 1, // Individual investor
    };

    console.log('Identity Details:');
    console.log(`  Country: ${identity.investorCountry} (USA)`);
    console.log(`  Type: ${identity.investorType} (Individual)`);
    console.log(`  ID: ${identity.investorID.slice(0, 20)}...`);

    console.log('\n📝 Sending transaction...');
    const tx = await identityRegistry.registerIdentity(INVESTOR_ADDRESS, identity);
    console.log(`TX Hash: ${tx.hash}`);
    console.log(`Explorer: https://sepolia.mantlescan.xyz/tx/${tx.hash}`);
    console.log('⏳ Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

    // 4. Verify it worked
    console.log('\n\n4️⃣ Verifying Registration...');
    console.log('━'.repeat(60));
    const nowVerified = await identityRegistry.isVerified(INVESTOR_ADDRESS);
    const country = await identityRegistry.investorCountry(INVESTOR_ADDRESS);

    console.log(`Verification Status: ${nowVerified ? '✅ VERIFIED' : '❌ NOT VERIFIED'}`);
    console.log(`Country Code: ${country}`);

    if (nowVerified) {
      console.log('\n━'.repeat(60));
      console.log('✅ SUCCESS!');
      console.log('━'.repeat(60));
      console.log(`\nInvestor ${INVESTOR_ADDRESS} can now buy tokens from:`);
      console.log(`${tokenName} (${tokenSymbol})`);
      console.log(`Token Address: ${TOKEN_ADDRESS}`);
      console.log('\n🎯 Next Step: Try purchasing tokens again in the UI');
    } else {
      console.log('\n❌ Verification failed!');
      console.log('Possible issues:');
      console.log('  - Admin wallet does not have permission');
      console.log('  - IdentityRegistry contract has restrictions');
      console.log('  - Wrong admin address');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);

    if (error.message.includes('AccessControl')) {
      console.error('\n⚠️  Admin wallet does not have permission to register identities!');
      console.error('Solution: Use the correct admin wallet that deployed the contracts');
    } else if (error.data) {
      console.error('Error data:', error.data);
    }

    throw error;
  }
}

main()
  .then(() => {
    console.log('\n━'.repeat(60));
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error.message);
    process.exit(1);
  });
