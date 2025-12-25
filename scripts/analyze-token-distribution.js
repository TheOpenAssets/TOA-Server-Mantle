import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

/**
 * Comprehensive Token Analysis
 * Shows total supply, all holders, and their balances
 */

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';

// Read marketplace address
const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);
const MARKETPLACE = deployedContracts.contracts.PrimaryMarketplace;

const TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];

const MARKETPLACE_ABI = [
  'function platformCustody() view returns (address)',
];

async function analyzeToken(tokenAddress) {
  console.log('\n🔍 Analyzing RWA Token Distribution...\n');
  console.log('━'.repeat(70));

  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const token = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  const marketplace = new ethers.Contract(MARKETPLACE, MARKETPLACE_ABI, provider);

  // 1. Basic Token Info
  console.log('\n📊 TOKEN INFORMATION');
  console.log('━'.repeat(70));

  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalSupply = await token.totalSupply();

  console.log(`Name: ${name}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Decimals: ${decimals}`);
  console.log(`Address: ${tokenAddress}`);
  console.log(`\nTotal Supply (raw): ${totalSupply} wei`);
  console.log(`Total Supply (formatted): ${ethers.formatUnits(totalSupply, decimals)} tokens`);

  // 2. Platform Addresses
  console.log('\n\n📍 PLATFORM ADDRESSES');
  console.log('━'.repeat(70));

  const platformCustody = await marketplace.platformCustody();
  console.log(`Platform Custody: ${platformCustody}`);
  console.log(`Marketplace: ${MARKETPLACE}`);

  // 3. Find all holders by scanning Transfer events
  console.log('\n\n👥 SCANNING FOR TOKEN HOLDERS...');
  console.log('━'.repeat(70));
  console.log('(This may take a moment...)\n');

  const currentBlock = await provider.getBlockNumber();
  const holders = new Set();

  // Always add known platform addresses
  holders.add(platformCustody);
  holders.add(MARKETPLACE);

  try {
    // Scan only recent blocks (last 100k blocks or ~7 days on Mantle)
    // This avoids hanging on old/empty blocks
    const blocksToScan = 100000;
    const startBlock = Math.max(currentBlock - blocksToScan, 0);
    
    console.log(`Scanning blocks ${startBlock} to ${currentBlock}...`);

    // Get all Transfer events in one query for recent blocks
    const filter = token.filters.Transfer();
    const events = await Promise.race([
      token.queryFilter(filter, startBlock, currentBlock),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 10000) // 10 second timeout
      )
    ]);

    for (const event of events) {
      const to = event.args.to;
      const from = event.args.from;
      
      // Add all addresses that have received tokens
      if (to !== ethers.ZeroAddress) {
        holders.add(to);
      }
      // Add senders too (in case they still hold)
      if (from !== ethers.ZeroAddress) {
        holders.add(from);
      }
    }

    console.log(`Found ${holders.size} potential holders from recent activity\n`);

  } catch (error) {
    console.log('⚠️  Could not scan all events (RPC limitation or timeout)');
    console.log('   Checking key addresses only...\n');
  }

  // 4. Check balances of all holders
  console.log('\n💰 TOKEN BALANCES');
  console.log('━'.repeat(70));
  console.log(`${'Address'.padEnd(44)} ${'Balance (tokens)'.padStart(25)}`);
  console.log('━'.repeat(70));

  const holderBalances = [];

  for (const holder of holders) {
    const balance = await token.balanceOf(holder);
    if (balance > 0n) {
      holderBalances.push({
        address: holder,
        balance: balance,
        formatted: ethers.formatUnits(balance, decimals),
      });
    }
  }

  // Sort by balance (highest first)
  holderBalances.sort((a, b) => {
    if (a.balance > b.balance) return -1;
    if (a.balance < b.balance) return 1;
    return 0;
  });

  if (holderBalances.length === 0) {
    console.log('⚠️  No holders found with non-zero balance!');
    console.log('   This token may not be properly distributed.');
  } else {
    for (const holder of holderBalances) {
      const label = holder.address === platformCustody
        ? ' (Platform Custody)'
        : holder.address === MARKETPLACE
        ? ' (Marketplace)'
        : '';

      console.log(
        `${holder.address.padEnd(44)} ${holder.formatted.padStart(20)} ${label}`
      );
    }
  }

  // 5. Verification Summary
  console.log('\n\n✅ VERIFICATION SUMMARY');
  console.log('━'.repeat(70));

  const custodyBalance = await token.balanceOf(platformCustody);
  const marketplaceBalance = await token.balanceOf(MARKETPLACE);

  const totalHeld = holderBalances.reduce((sum, h) => sum + h.balance, 0n);

  console.log(`Total Supply: ${ethers.formatUnits(totalSupply, decimals)} tokens`);
  console.log(`Total Held by All Holders: ${ethers.formatUnits(totalHeld, decimals)} tokens`);
  console.log(`Platform Custody Holds: ${ethers.formatUnits(custodyBalance, decimals)} tokens`);
  console.log(`Marketplace Holds: ${ethers.formatUnits(marketplaceBalance, decimals)} tokens`);

  // Diagnosis
  console.log('\n📋 DIAGNOSIS');
  console.log('━'.repeat(70));

  if (totalSupply < BigInt(1000) * BigInt(10 ** Number(decimals))) {
    console.log('❌ ISSUE: Total supply is extremely low!');
    console.log(`   Expected: ~100,000 tokens`);
    console.log(`   Actual: ${ethers.formatUnits(totalSupply, decimals)} tokens`);
    console.log('\n   🔧 FIX: Re-tokenize asset with correct totalSupply parameter');
  } else if (custodyBalance < totalSupply / 2n) {
    console.log('⚠️  WARNING: Platform custody has less than 50% of tokens');
    console.log('   Most tokens may be held elsewhere');
  } else {
    console.log('✅ Token distribution looks normal');
  }

  console.log('\n' + '━'.repeat(70));
}

// Get token address from command line or use default
const tokenAddress = process.argv[2] || '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';

analyzeToken(tokenAddress)
  .then(() => {
    console.log('\n✅ Analysis complete!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
