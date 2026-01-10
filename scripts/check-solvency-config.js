import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';

const SOLVENCY_VAULT_ABI = [
  'function seniorPool() external view returns (address)',
  'function yieldVault() external view returns (address)',
  'function usdc() external view returns (address)',
  'function positionsInLiquidation(uint256) external view returns (bool)',
];

async function main() {
  console.log('\n============================================================');
  console.log('Solvency Vault Configuration Check');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const vault = new ethers.Contract(SOLVENCY_VAULT, SOLVENCY_VAULT_ABI, provider);

  console.log('Solvency Vault:', SOLVENCY_VAULT);

  console.log('\n📊 Configuration...\n');
  
  const seniorPool = await vault.seniorPool();
  const yieldVault = await vault.yieldVault();
  const usdc = await vault.usdc();
  const inLiquidation = await vault.positionsInLiquidation(1);

  console.log('Senior Pool:', seniorPool);
  console.log('Yield Vault:', yieldVault);
  console.log('USDC:', usdc);
  console.log('Position 1 in Liquidation:', inLiquidation);

  console.log('\n✅ All addresses configured:', seniorPool !== ethers.ZeroAddress && yieldVault !== ethers.ZeroAddress);

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
