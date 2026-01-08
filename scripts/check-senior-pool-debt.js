import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SENIOR_POOL = '0x1ddf8f4d580F018FD1a6BB927e961602845B4dED';

const SENIOR_POOL_ABI = [
  'function loans(uint256) external view returns (uint256 principal, uint256 interestAccrued, uint256 lastUpdateTime, bool active)',
  'function getOutstandingDebt(uint256 positionId) external view returns (uint256)',
  'function getAccruedInterest(uint256 positionId) external view returns (uint256)',
];

async function main() {
  const positionId = parseInt(process.argv[2] || '1');

  console.log('\n============================================================');
  console.log('Senior Pool Debt Check');
  console.log('============================================================\n');
  console.log('Position ID:', positionId);
  console.log('SeniorPool:', SENIOR_POOL);

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const seniorPool = new ethers.Contract(SENIOR_POOL, SENIOR_POOL_ABI, provider);

  console.log('\n📊 Fetching loan data...\n');
  
  const loan = await seniorPool.loans(positionId);
  const outstandingDebt = await seniorPool.getOutstandingDebt(positionId);
  const accruedInterest = await seniorPool.getAccruedInterest(positionId);
  
  console.log('Loan Details:');
  console.log('  Principal:', ethers.formatUnits(loan[0], 6), 'USDC');
  console.log('  Interest Accrued:', ethers.formatUnits(loan[1], 6), 'USDC');
  console.log('  Last Update Time:', new Date(Number(loan[2]) * 1000).toISOString());
  console.log('  Active:', loan[3]);

  console.log('\n💰 Debt Status:');
  console.log('  Accrued Interest:', ethers.formatUnits(accruedInterest, 6), 'USDC');
  console.log('  Outstanding Debt (Principal + Interest):', ethers.formatUnits(outstandingDebt, 6), 'USDC');

  const yieldNeeded = outstandingDebt;
  console.log('\n💡 Yield needed to settle:', ethers.formatUnits(yieldNeeded, 6), 'USDC');

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
