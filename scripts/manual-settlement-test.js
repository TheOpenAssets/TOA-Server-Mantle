import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';
const YIELD_VAULT = '0xa05bDf67483EB6ba5CcA0dc81543DeD5Ed845Da7';
const TINV_TOKEN = '0xB7292c58e9Af0b32A87dbf19056B54c74fD0b8A8';
const SENIOR_POOL = '0x1ddf8f4d580F018FD1a6BB927e961602845B4dED';

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('Please set ADMIN_KEY environment variable');
  process.exit(1);
}

// Try manual settlement by calling each step separately
const SOLVENCY_VAULT_ABI = [
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, uint256 liquidatedAt, uint256 creditLineId, bool active, uint8 tokenType)',
];

const YIELD_VAULT_ABI = [
  'function claimYield(address tokenAddress, uint256 tokenAmount) external returns (uint256)',
];

const TINV_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address) external view returns (uint256)',
];

async function main() {
  const positionId = 1;

  console.log('\n============================================================');
  console.log('Manual Settlement Test - Step by Step');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  
  console.log('Admin:', wallet.address);
  console.log('Position ID:', positionId);

  const solvencyVault = new ethers.Contract(SOLVENCY_VAULT, SOLVENCY_VAULT_ABI, provider);
  const yieldVault = new ethers.Contract(YIELD_VAULT, YIELD_VAULT_ABI, wallet);
  const tinvToken = new ethers.Contract(TINV_TOKEN, TINV_ABI, wallet);

  console.log('\n📊 Getting position info...\n');
  
  const position = await solvencyVault.positions(positionId);
  console.log('Collateral Token:', position.collateralToken);
  console.log('Collateral Amount:', ethers.formatUnits(position.collateralAmount, 18));
  console.log('Token Type:', position.tokenType === 0n ? 'RWA' : 'PRIVATE_ASSET');

  console.log('\n📊 Checking balances...\n');
  
  const vaultBalance = await tinvToken.balanceOf(SOLVENCY_VAULT);
  console.log('Solvency Vault TINV balance:', ethers.formatUnits(vaultBalance, 18));
  
  const allowance = await tinvToken.allowance(SOLVENCY_VAULT, YIELD_VAULT);
  console.log('Solvency Vault → Yield Vault allowance:', ethers.formatUnits(allowance, 18));

  console.log('\n💡 The problem: Admin cannot approve on behalf of Solvency Vault!');
  console.log('   Only the Solvency Vault contract itself can call approve.');
  console.log('   The approval MUST happen inside the settleLiquidation transaction.');

  console.log('\n🔍 Let me try to simulate what happens in yieldVault.claimYield...\n');
  
  console.log('YieldVault.claimYield will try to:');
  console.log('  1. Check settlement exists ✅');
  console.log('  2. Calculate USDC amount ✅');
  console.log('  3. Call tokenAddress.burnFrom(msg.sender, tokenAmount)');
  console.log('     where msg.sender = Solvency Vault');
  console.log('  4. This requires Solvency Vault to have approved YieldVault');

  console.log('\n💡 Since allowance is currently 0, burnFrom will fail.');
  console.log('   The settleLiquidation function approves first, THEN calls claimYield.');
  console.log('   So it SHOULD work...');

  console.log('\n🧪 Unless... let me check if maybe claimYield is reverting for another reason');
  console.log('   Let me try calling it as admin (will fail, but might show different error):\n');

  try {
    await yieldVault.claimYield.staticCall(TINV_TOKEN, ethers.parseUnits('1', 18));
    console.log('✅ Admin could claim yield (unexpected)');
  } catch (error) {
    const errorStr = error.message;
    console.log('❌ claimYield reverted:', errorStr.substring(0, 200));
    
    if (errorStr.includes('0xfb8f41b2')) {
      console.log('\n💡 Error signature 0xfb8f41b2 is ERC20InsufficientAllowance');
      console.log("   This is expected - admin hasn't approved Yield Vault");
    }
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
