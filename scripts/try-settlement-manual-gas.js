import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('Please set ADMIN_KEY environment variable');
  process.exit(1);
}

const SOLVENCY_VAULT_ABI = [
  'function settleLiquidation(uint256 positionId) external returns (uint256 yieldReceived, uint256 liquidationFee, uint256 userRefund)',
];

async function main() {
  const positionId = parseInt(process.argv[2] || '1');

  console.log('\n============================================================');
  console.log('Try Settlement with Manual Gas Limit');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  const vault = new ethers.Contract(SOLVENCY_VAULT, SOLVENCY_VAULT_ABI, wallet);

  console.log('Admin:', wallet.address);
  console.log('Solvency Vault:', SOLVENCY_VAULT);
  console.log('Position ID:', positionId);

  console.log('\n🧪 Attempting settlement with manual gas limit...\n');

  try {
    // Try with a very high gas limit
    const tx = await vault.settleLiquidation(positionId, {
      gasLimit: 5000000, // 5M gas
    });
    
    console.log('✅ Transaction sent:', tx.hash);
    console.log('⏳ Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());
    
  } catch (error) {
    console.log('❌ Failed:', error.message);
    
    if (error.data) {
      console.log('\nError data:', error.data);
    }
    
    // Try to decode the error
    if (error.reason) {
      console.log('Reason:', error.reason);
    }
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  process.exit(1);
});
