import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';

const SOLVENCY_VAULT_ABI = [
  'function positions(uint256) external view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, uint256 liquidatedAt, uint256 creditLineId, bool active, uint8 tokenType)',
];

async function main() {
  const positionId = parseInt(process.argv[2] || '1');

  console.log('\n============================================================');
  console.log('Debug Token Type - Raw Contract Data');
  console.log('============================================================\n');
  console.log('Position ID:', positionId);
  console.log('Solvency Vault:', SOLVENCY_VAULT);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vault = new ethers.Contract(SOLVENCY_VAULT, SOLVENCY_VAULT_ABI, provider);

  console.log('\n📊 Fetching raw position data...\n');
  
  const position = await vault.positions(positionId);
  
  console.log('Raw position tuple:');
  console.log(position);
  
  console.log('\n🔍 Decoded values:');
  console.log('  user:', position[0]);
  console.log('  collateralToken:', position[1]);
  console.log('  collateralAmount:', ethers.formatUnits(position[2], 18));
  console.log('  usdcBorrowed:', ethers.formatUnits(position[3], 6));
  console.log('  tokenValueUSD:', ethers.formatUnits(position[4], 6));
  console.log('  createdAt:', new Date(Number(position[5]) * 1000).toISOString());
  console.log('  liquidatedAt:', position[6].toString() === '0' ? 'Not liquidated' : new Date(Number(position[6]) * 1000).toISOString());
  console.log('  creditLineId:', position[7].toString());
  console.log('  active:', position[8]);
  console.log('  tokenType (uint8):', position[9].toString());
  console.log('  tokenType (as number):', Number(position[9]));

  console.log('\n💡 Token Type Interpretation:');
  const tokenTypeNum = Number(position[9]);
  if (tokenTypeNum === 0) {
    console.log('  0 = RWA (Real World Asset)');
    console.log('  ✅ Can use settleLiquidation() - burn tokens to claim yield');
    console.log('  ❌ Cannot use purchaseAndSettleLiquidation()');
  } else if (tokenTypeNum === 1) {
    console.log('  1 = PRIVATE_ASSET (Private Asset)');
    console.log('  ❌ Cannot use settleLiquidation()');
    console.log('  ✅ Can use purchaseAndSettleLiquidation() - admin buys tokens');
  } else {
    console.log('  Unknown token type:', tokenTypeNum);
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
