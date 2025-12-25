import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

/**
 * Transfer tokens to Platform Custody so they can be sold on marketplace
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const TOKEN_ADDRESS = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';

// Read marketplace address from deployed contracts
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);
const MARKETPLACE = deployedContracts.contracts.PrimaryMarketplace;

const TOKEN_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const MARKETPLACE_ABI = [
  'function platformCustody() view returns (address)',
];

async function main() {
  console.log('\n💰 Funding Platform Custody...\n');
  console.log('━'.repeat(60));

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  // Get platform custody address
  const marketplace = new ethers.Contract(MARKETPLACE, MARKETPLACE_ABI, provider);
  const platformCustody = await marketplace.platformCustody();

  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, wallet);

  console.log(`Token: ${TOKEN_ADDRESS}`);
  console.log(`Platform Custody: ${platformCustody}`);
  console.log(`Admin Wallet: ${wallet.address}\n`);

  // Get token info
  const tokenName = await token.name();
  const tokenSymbol = await token.symbol();

  console.log(`Token: ${tokenName} (${tokenSymbol})\n`);

  // Check balances
  const adminBalance = await token.balanceOf(wallet.address);
  const custodyBalance = await token.balanceOf(platformCustody);

  console.log('Current Balances:');
  console.log(`  Admin: ${ethers.formatEther(adminBalance)} tokens`);
  console.log(`  Platform Custody: ${ethers.formatEther(custodyBalance)} tokens\n`);

  if (adminBalance === 0n) {
    console.log('❌ Admin wallet has no tokens to transfer!');
    console.log('   Make sure tokens were minted to the admin wallet.');
    process.exit(1);
  }

  // Transfer all tokens to platform custody
  console.log(`⏳ Transferring ${ethers.formatEther(adminBalance)} tokens to Platform Custody...`);
  const tx = await token.transfer(platformCustody, adminBalance);
  console.log(`TX Hash: ${tx.hash}`);
  console.log(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
  console.log('⏳ Waiting for confirmation...');

  await tx.wait();
  console.log('✅ Transfer confirmed!\n');

  // Verify new balance
  const newCustodyBalance = await token.balanceOf(platformCustody);
  console.log('New Platform Custody Balance:');
  console.log(`  ${ethers.formatEther(newCustodyBalance)} tokens`);

  console.log('\n━'.repeat(60));
  console.log('✅ Platform Custody is now funded!');
  console.log('   Tokens are ready to be sold on the marketplace.');
  console.log('\n🎯 Next: Try purchasing tokens again in the UI');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
