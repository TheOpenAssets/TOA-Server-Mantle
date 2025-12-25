import 'dotenv/config';
import { ethers } from 'ethers';

const MANTLE_SEPOLIA_RPC = process.env.MANTLE_SEPOLIA_RPC || 'https://rpc.sepolia.mantle.xyz';
const FAILING_TOKEN = '0xeF031f7f75B981Ad7c0A9b31a0eBD9F8eCb1d0Db';
const WORKING_TOKEN = '0x2e4A87A97E7Da5a5b0Adc3Bac2F05d50f16f8b53'; // First asset that worked

const provider = new ethers.JsonRpcProvider(MANTLE_SEPOLIA_RPC);

console.log('\n📊 Checking Token Contracts...\n');
console.log('━'.repeat(60));

// Check failing token
console.log(`\n1️⃣ Failing Token: ${FAILING_TOKEN}`);
const failingCode = await provider.getCode(FAILING_TOKEN);
console.log(`Contract exists: ${failingCode !== '0x' ? '✅ YES' : '❌ NO'}`);
console.log(`Bytecode length: ${failingCode.length} chars`);

if (failingCode === '0x') {
  console.log('\n⚠️  ISSUE: No contract deployed at this address!');
  console.log('This explains why the purchase is failing.');
  console.log('\n🔧 Solution: The asset needs to be properly tokenized first');
  console.log('Run the tokenization flow for this asset before listing it.');
} else {
  console.log('Contract exists, checking if it\'s a valid RWAToken...');
  // Try to call name()
  const abi = ['function name() view returns (string)'];
  const contract = new ethers.Contract(FAILING_TOKEN, abi, provider);
  try {
    const name = await contract.name();
    console.log(`Token Name: ${name} ✅`);
  } catch (e) {
    console.log(`❌ Failed to call name(): ${e.message}`);
    console.log('This is NOT a valid ERC-20/RWAToken contract!');
  }
}

// Check working token for comparison
console.log(`\n2️⃣ Working Token (for comparison): ${WORKING_TOKEN}`);
const workingCode = await provider.getCode(WORKING_TOKEN);
console.log(`Contract exists: ${workingCode !== '0x' ? '✅ YES' : '❌ NO'}`);
console.log(`Bytecode length: ${workingCode.length} chars`);

if (workingCode !== '0x') {
  const abi = ['function name() view returns (string)', 'function symbol() view returns (string)'];
  const contract = new ethers.Contract(WORKING_TOKEN, abi, provider);
  try {
    const name = await contract.name();
    const symbol = await contract.symbol();
    console.log(`Token: ${name} (${symbol}) ✅`);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

console.log('\n━'.repeat(60));
console.log('\n📝 Summary:');
if (failingCode === '0x') {
  console.log('❌ The failing token contract does NOT exist at the listed address');
  console.log('   This asset was not properly tokenized before being listed');
} else {
  console.log('❌ The failing token contract exists but is not responding correctly');
  console.log('   It may not be a properly deployed RWAToken contract');
}
