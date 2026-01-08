import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const YIELD_VAULT = '0xa05bDf67483EB6ba5CcA0dc81543DeD5Ed845Da7';
const TINV_TOKEN = '0xB7292c58e9Af0b32A87dbf19056B54c74fD0b8A8';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('Please set ADMIN_KEY environment variable');
  process.exit(1);
}

const YIELD_VAULT_ABI = [
  'function assets(address) external view returns (bytes32 assetId, uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, bool isSettled)',
  'function claimYield(address tokenAddress, uint256 tokenAmount) external returns (uint256)',
  'function getSettlementInfo(address tokenAddress) external view returns (uint256 totalSettlement, uint256 totalTokenSupply, uint256 totalClaimed, uint256 totalTokensBurned, uint256 yieldPerToken)',
];

const TINV_ABI = [
  'function balanceOf(address) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

async function main() {
  console.log('\n============================================================');
  console.log('Test Direct Yield Claim');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  
  console.log('Admin Address:', wallet.address);
  console.log('Yield Vault:', YIELD_VAULT);
  console.log('TINV Token:', TINV_TOKEN);
  console.log('Solvency Vault:', SOLVENCY_VAULT);

  const yieldVault = new ethers.Contract(YIELD_VAULT, YIELD_VAULT_ABI, wallet);
  const tinvToken = new ethers.Contract(TINV_TOKEN, TINV_ABI, wallet);

  console.log('\n📊 Checking settlement info...\n');
  
  const settlementInfo = await yieldVault.getSettlementInfo(TINV_TOKEN);
  console.log('Total Settlement:', ethers.formatUnits(settlementInfo[0], 6), 'USDC');
  console.log('Total Token Supply:', ethers.formatUnits(settlementInfo[1], 18));
  console.log('Total Claimed:', ethers.formatUnits(settlementInfo[2], 6), 'USDC');
  console.log('Yield Per Token:', ethers.formatUnits(settlementInfo[4], 6), 'USDC');

  console.log('\n📊 Checking Solvency Vault token balance...\n');
  const solvencyVaultBalance = await tinvToken.balanceOf(SOLVENCY_VAULT);
  console.log('Solvency Vault TINV Balance:', ethers.formatUnits(solvencyVaultBalance, 18));

  console.log('\n📊 Checking approvals...\n');
  const allowance = await tinvToken.allowance(SOLVENCY_VAULT, YIELD_VAULT);
  console.log('Solvency Vault → Yield Vault allowance:', ethers.formatUnits(allowance, 18));

  console.log('\n🧪 Test: Can Admin call claimYield directly?\n');
  
  try {
    // Try to estimate gas for admin calling claimYield
    const tokenAmount = ethers.parseUnits('100', 18);
    await yieldVault.claimYield.staticCall(TINV_TOKEN, tokenAmount);
    console.log('✅ Admin can call claimYield (would work)');
  } catch (error) {
    console.log('❌ Admin cannot call claimYield:',error.message.split('\n')[0]);
  }

  console.log('\n💡 Note: The issue is that claimYield calls burnFrom(msg.sender, amount)');
  console.log('   where msg.sender would be the admin, not the SolvencyVault.');
  console.log('   So the admin would need to own the tokens and approve the YieldVault.');
  console.log('   When SolvencyVault calls it, msg.sender = SolvencyVault, which owns the tokens.');

  console.log('\n');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
