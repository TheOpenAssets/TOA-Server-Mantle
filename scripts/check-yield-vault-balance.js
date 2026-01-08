import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const YIELD_VAULT = '0xa05bDf67483EB6ba5CcA0dc81543DeD5Ed845Da7';
const USDC = '0x9A54Bad93a00Bf1232D4e636f5e53055Dc0b8238';

const USDC_ABI = [
  'function balanceOf(address) external view returns (uint256)',
];

async function main() {
  console.log('\n============================================================');
  console.log('Check Yield Vault USDC Balance');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const usdc = new ethers.Contract(USDC, USDC_ABI, provider);

  console.log('Yield Vault:', YIELD_VAULT);
  console.log('USDC:', USDC);

  console.log('\n📊 Checking balance...\n');
  
  const balance = await usdc.balanceOf(YIELD_VAULT);
  console.log('Yield Vault USDC Balance:', ethers.formatUnits(balance, 6), 'USDC');

  console.log('\n💡 Settlement deposited: $98.5 USDC');
  console.log('💡 Actual balance:', ethers.formatUnits(balance, 6), 'USDC');

  if (balance >= ethers.parseUnits('98.5', 6)) {
    console.log('\n✅ Yield Vault has sufficient USDC for settlement');
  } else {
    console.log('\n❌ Yield Vault does NOT have sufficient USDC!');
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
