import { ethers } from 'ethers';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const SOLVENCY_VAULT = '0xbCcaCeE907e3a2717873F38Ea45Cd45f18Ac9412';

const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  console.error('Please set ADMIN_KEY environment variable');
  process.exit(1);
}

const SOLVENCY_VAULT_ABI = [
  'function owner() external view returns (address)',
];

async function main() {
  console.log('\n============================================================');
  console.log('Check Solvency Vault Ownership');
  console.log('============================================================\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ADMIN_KEY, provider);
  const vault = new ethers.Contract(SOLVENCY_VAULT, SOLVENCY_VAULT_ABI, provider);

  console.log('Solvency Vault:', SOLVENCY_VAULT);
  console.log('Admin Address:', wallet.address);

  console.log('\n📊 Checking ownership...\n');
  
  const owner = await vault.owner();
  console.log('Contract Owner:', owner);
  console.log('Match:', owner.toLowerCase() === wallet.address.toLowerCase());

  if (owner.toLowerCase() === wallet.address.toLowerCase()) {
    console.log('\n✅ Admin is the owner - onlyOwner modifier should pass');
  } else {
    console.log('\n❌ Admin is NOT the owner - this would cause reverts!');
  }

  console.log('\n');
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
