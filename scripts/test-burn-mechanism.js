import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const TINV_TOKEN = '0xB7292c58e9Af0b32A87dbf19056B54c74fD0b8A8';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';
const YIELD_VAULT = '0xa05bDf67483EB6ba5CcA0dc81543DeD5Ed845Da7';

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('Please set ADMIN_KEY environment variable');
  process.exit(1);
}

const SOLVENCY_VAULT_ABI = [
  'function approveBurnForSettlement(uint256 positionId, address yieldVault, uint256 amount) external',
];

const TINV_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function burnFrom(address account, uint256 amount) external',
];

async function main() {
  console.log('\n============================================================');
  console.log('Test Token Burn Mechanism');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  
  console.log('Admin Address:', wallet.address);
  console.log('TINV Token:', TINV_TOKEN);
  console.log('Solvency Vault:', SOLVENCY_VAULT);
  console.log('Yield Vault:', YIELD_VAULT);

  const tinvToken = new ethers.Contract(TINV_TOKEN, TINV_ABI, wallet);

  console.log('\n📊 Current State...\n');
  
  const solvencyBalance = await tinvToken.balanceOf(SOLVENCY_VAULT);
  const allowance = await tinvToken.allowance(SOLVENCY_VAULT, YIELD_VAULT);
  
  console.log('Solvency Vault TINV Balance:', ethers.formatUnits(solvencyBalance, 18));
  console.log('Solvency Vault → Yield Vault Allowance:', ethers.formatUnits(allowance, 18));

  console.log('\n🧪 Testing if Solvency Vault can approve Yield Vault...\n');
  
  console.log('Note: We cannot directly call approve from Solvency Vault as we are not the vault.');
  console.log('The SolvencyVault.settleLiquidation() function should do this internally.');

  console.log('\n🧪 Testing if admin can create approval as owner of Solvency Vault...\n');
  
  // Check if there's a method on SolvencyVault to approve on behalf of itself
  // In the actual contract, the approve happens inside settleLiquidation()
  
  console.log('The approval must happen inside the settlement transaction itself.');
  console.log('Let me check if maybe the token transfer restrictions are preventing this...');

  console.log('\n📊 Checking token contract details...\n');
  
  // Check if token has compliance module that might be blocking burns
  const tokenContract = new ethers.Contract(TINV_TOKEN, [
    'function paused() external view returns (bool)',
    'function compliance() external view returns (address)',
  ], provider);

  try {
    const paused = await tokenContract.paused();
    console.log('Token Paused:', paused);
    
    if (paused) {
      console.log('\n❌ TOKEN IS PAUSED! This would prevent burns.');
    }
  } catch (e) {
    console.log('Could not check paused status');
  }

  try {
    const compliance = await tokenContract.compliance();
    console.log('Compliance Module:', compliance);
  } catch (e) {
    console.log('Could not check compliance module');
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
