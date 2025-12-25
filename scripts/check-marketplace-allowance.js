import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

/**
 * Check if marketplace has approval to spend tokens from platformCustody
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const FAILING_TOKEN = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';

// Read marketplace address from deployed contracts
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);
const MARKETPLACE = deployedContracts.contracts.PrimaryMarketplace;

const TOKEN_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

const MARKETPLACE_ABI = [
  'function platformCustody() view returns (address)',
];

async function main() {
  console.log('\n🔍 Checking Marketplace Allowance...\n');
  console.log('━'.repeat(60));

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);

  // Get platform custody address from marketplace
  const marketplace = new ethers.Contract(MARKETPLACE, MARKETPLACE_ABI, provider);
  const PLATFORM_CUSTODY = await marketplace.platformCustody();

  const token = new ethers.Contract(FAILING_TOKEN, TOKEN_ABI, provider);

  console.log(`Token: ${FAILING_TOKEN}`);
  console.log(`Platform Custody: ${PLATFORM_CUSTODY}`);
  console.log(`Marketplace: ${MARKETPLACE}\n`);

  const tokenName = await token.name();
  const tokenSymbol = await token.symbol();
  const balance = await token.balanceOf(PLATFORM_CUSTODY);
  const allowance = await token.allowance(PLATFORM_CUSTODY, MARKETPLACE);

  console.log(`Token: ${tokenName} (${tokenSymbol})`);
  console.log(`Custody Balance: ${ethers.formatEther(balance)} tokens`);
  console.log(`Marketplace Allowance: ${ethers.formatEther(allowance)} tokens\n`);

  if (allowance === 0n) {
    console.log('❌ ISSUE FOUND: Marketplace has NO allowance!');
    console.log('\n🔧 Solution: Run the approval script:');
    console.log(`   node scripts/approve-marketplace.js ${FAILING_TOKEN}`);
    console.log('\nThis will allow the marketplace to transfer tokens to buyers.');
  } else {
    console.log('✅ Marketplace has approval to spend tokens');
  }

  console.log('\n' + '━'.repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
