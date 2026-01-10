import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

async function main() {
  const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
  const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
  const seniorPoolAddress = deployed.contracts.SeniorPool;
  
  const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  console.log(`Checking bytecode at ${seniorPoolAddress}...`);
  const code = await provider.getCode(seniorPoolAddress);

  // Convert hex to string (ignoring non-printable chars)
  const codeString = Buffer.from(code.slice(2), 'hex').toString('utf8').replace(/[^ -~]/g, '');

  if (codeString.includes('Only LeverageVault')) {
    console.log('\n🚨 FOUND "Only LeverageVault" in bytecode!');
    console.log('✅ PROOF: The deployed contract is the OLD version.');
  } else if (codeString.includes('Only authorized vault')) {
    console.log('\n✅ FOUND "Only authorized vault" in bytecode.');
    console.log('❓ The contract code seems correct. Investigation continues.');
  } else {
    console.log('\n⚠️ Could not find either error string. Code might be different.');
  }
}

main();
