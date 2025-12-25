import 'dotenv/config';
import { ethers } from 'ethers';

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const TOKEN_ADDRESS = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';

const TOKEN_ABI = [
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);
  const token = new ethers.Contract(TOKEN_ADDRESS, TOKEN_ABI, provider);

  console.log('\n🔍 Checking Token Decimals...\n');
  console.log('━'.repeat(60));

  const name = await token.name();
  const symbol = await token.symbol();
  const decimals = await token.decimals();
  const totalSupply = await token.totalSupply();

  console.log(`Token: ${name} (${symbol})`);
  console.log(`Address: ${TOKEN_ADDRESS}`);
  console.log(`\nDecimals: ${decimals}`);
  console.log(`Total Supply (raw): ${totalSupply} wei`);
  console.log(`Total Supply (formatted): ${ethers.formatUnits(totalSupply, decimals)} tokens`);

  console.log('\n' + '━'.repeat(60));

  if (decimals === 6) {
    console.log('\n✅ Token uses 6 decimals (like USDC)');
    console.log(`   For 100,000 tokens, you need: ${100000 * 10**6} wei`);
    console.log(`   Current supply: ${totalSupply} wei`);
    console.log(`   Missing: ${(100000 * 10**6) - Number(totalSupply)} wei`);
  } else if (decimals === 18) {
    console.log('\n✅ Token uses 18 decimals (standard ERC20)');
    console.log(`   For 100,000 tokens, you need: ${BigInt(100000) * BigInt(10**18)} wei`);
    console.log(`   Current supply: ${totalSupply} wei`);
    console.log(`   Missing: ${(BigInt(100000) * BigInt(10**18)) - totalSupply} wei`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });
