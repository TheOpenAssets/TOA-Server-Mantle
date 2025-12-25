import 'dotenv/config';
import { ethers } from 'ethers';

/**
 * Debug script to diagnose why a token purchase is failing
 * Checks:
 * 1. Buyer KYC verification status
 * 2. Listing configuration
 * 3. Token compliance settings
 * 4. Payment calculation
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;

const MARKETPLACE_ADDRESS = '0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615';
const FAILING_TOKEN_ADDRESS = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';
const BUYER_ADDRESS = '0x6F662Dc7814aD324a361D0D1B0D1a457222eb42f';
const ASSET_ID = '0x87a17e86d3814f1b855544acd5a8466400000000000000000000000000000000'; // bytes32

// ABIs (minimal)
const TOKEN_ABI = [
  'function identityRegistry() view returns (address)',
  'function complianceModule() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const IDENTITY_REGISTRY_ABI = [
  'function isVerified(address) view returns (bool)',
  'function investorCountry(address) view returns (uint16)',
];

const COMPLIANCE_ABI = [
  'function canTransfer(address, address, uint256) view returns (bool)',
];

const MARKETPLACE_ABI = [
  'function listings(bytes32) view returns (address tokenAddress, uint8 listingType, uint256 price, uint256 startPrice, uint256 endPrice, uint256 startTime, uint256 endTime, uint256 minInvestment, uint256 totalTokens, uint256 soldTokens, bool active)',
];

async function main() {
  console.log('\n🔍 Debugging Purchase Failure...\n');
  console.log('━'.repeat(60));

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  console.log(`\n📋 Configuration:`);
  console.log(`Marketplace: ${MARKETPLACE_ADDRESS}`);
  console.log(`Token: ${FAILING_TOKEN_ADDRESS}`);
  console.log(`Buyer: ${BUYER_ADDRESS}`);
  console.log(`Asset ID: ${ASSET_ID}`);

  try {
    // 1. Check token info
    console.log('\n\n1️⃣ Checking Token Info...');
    console.log('━'.repeat(60));
    const token = new ethers.Contract(FAILING_TOKEN_ADDRESS, TOKEN_ABI, provider);

    const tokenName = await token.name();
    const tokenSymbol = await token.symbol();
    const identityRegistryAddress = await token.identityRegistry();
    const complianceModuleAddress = await token.complianceModule();

    console.log(`Token Name: ${tokenName}`);
    console.log(`Token Symbol: ${tokenSymbol}`);
    console.log(`Identity Registry: ${identityRegistryAddress}`);
    console.log(`Compliance Module: ${complianceModuleAddress}`);

    // 2. Check if buyer is KYC verified
    console.log('\n\n2️⃣ Checking Buyer KYC Status...');
    console.log('━'.repeat(60));
    const identityRegistry = new ethers.Contract(
      identityRegistryAddress,
      IDENTITY_REGISTRY_ABI,
      provider
    );

    const isVerified = await identityRegistry.isVerified(BUYER_ADDRESS);
    console.log(`Buyer Verified: ${isVerified ? '✅ YES' : '❌ NO'}`);

    if (!isVerified) {
      console.log('\n⚠️  ISSUE FOUND: Buyer is NOT verified in IdentityRegistry!');
      console.log('\n🔧 Solution: Add buyer to IdentityRegistry for this token');
      console.log(`Run: node scripts/add-verified-investor.js ${FAILING_TOKEN_ADDRESS} ${BUYER_ADDRESS}`);
      return;
    }

    const country = await identityRegistry.investorCountry(BUYER_ADDRESS);
    console.log(`Buyer Country Code: ${country}`);

    // 3. Check compliance
    console.log('\n\n3️⃣ Checking Compliance for Transfer...');
    console.log('━'.repeat(60));
    const compliance = new ethers.Contract(
      complianceModuleAddress,
      COMPLIANCE_ABI,
      provider
    );

    const canTransfer = await compliance.canTransfer(
      MARKETPLACE_ADDRESS, // from
      BUYER_ADDRESS,       // to
      ethers.parseEther('1000') // amount (1000 tokens)
    );

    console.log(`Can Transfer: ${canTransfer ? '✅ YES' : '❌ NO'}`);

    if (!canTransfer) {
      console.log('\n⚠️  ISSUE FOUND: Compliance module blocking transfer!');
      console.log('Possible reasons:');
      console.log('  - Country restrictions');
      console.log('  - Token limits exceeded');
      console.log('  - Transfer restrictions active');
      return;
    }

    // 4. Check listing configuration
    console.log('\n\n4️⃣ Checking Listing Configuration...');
    console.log('━'.repeat(60));
    const marketplace = new ethers.Contract(
      MARKETPLACE_ADDRESS,
      MARKETPLACE_ABI,
      provider
    );

    const listing = await marketplace.listings(ASSET_ID);

    console.log(`Token Address: ${listing.tokenAddress}`);
    console.log(`Listing Type: ${listing.listingType === 0 ? 'STATIC' : 'AUCTION'}`);
    console.log(`Price: ${ethers.formatUnits(listing.price, 6)} USDC per token`);
    console.log(`Min Investment: ${ethers.formatEther(listing.minInvestment)} tokens`);
    console.log(`Total Tokens: ${ethers.formatEther(listing.totalTokens)} tokens`);
    console.log(`Sold Tokens: ${ethers.formatEther(listing.soldTokens)} tokens`);
    console.log(`Active: ${listing.active ? '✅ YES' : '❌ NO'}`);

    if (!listing.active) {
      console.log('\n⚠️  ISSUE FOUND: Listing is NOT active!');
      return;
    }

    if (listing.tokenAddress.toLowerCase() !== FAILING_TOKEN_ADDRESS.toLowerCase()) {
      console.log('\n⚠️  ISSUE FOUND: Token address mismatch!');
      console.log(`Expected: ${FAILING_TOKEN_ADDRESS}`);
      console.log(`Got: ${listing.tokenAddress}`);
      return;
    }

    // 5. Check if price is valid
    if (listing.price === 0n) {
      console.log('\n⚠️  ISSUE FOUND: Price is set to 0!');
      console.log('This might cause calculation issues.');
      return;
    }

    console.log('\n\n✅ All checks passed! No obvious issues found.');
    console.log('\nPossible issues:');
    console.log('1. Gas estimation failing due to slippage or timing');
    console.log('2. Custom error from PrimaryMarketplace contract');
    console.log('3. USDC approval issues (though allowance shown as sufficient)');

    // Decode the error selector
    console.log('\n\n5️⃣ Error Analysis...');
    console.log('━'.repeat(60));
    console.log('Error Selector: 0xfb8f41b2');
    console.log('\nTo decode this error:');
    console.log('1. Check PrimaryMarketplace contract for custom errors');
    console.log('2. Look for error signature matching 0xfb8f41b2');
    console.log('3. Common errors:');
    console.log('   - InsufficientPayment');
    console.log('   - InvalidListing');
    console.log('   - TransferFailed');
    console.log('   - ComplianceCheckFailed');

  } catch (error) {
    console.error('\n❌ Error during debugging:', error.message);
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
