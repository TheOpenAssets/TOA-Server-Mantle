#!/usr/bin/env node

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;

const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
const deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));

const SENIOR_POOL_ABI = [
  'function totalLiquidity() view returns (uint256)',
  'function totalBorrowed() view returns (uint256)',
  'function depositLiquidity(uint256) external',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function mint(address, uint256) external',
  'function approve(address, uint256) external returns (bool)',
];

const provider = new ethers.JsonRpcProvider(RPC_URL);
const seniorPool = new ethers.Contract(deployed.contracts.SeniorPool, SENIOR_POOL_ABI, provider);
const usdc = new ethers.Contract(deployed.contracts.USDC, USDC_ABI, provider);

console.log('💰 Checking SeniorPool Liquidity...\n');
console.log(`SeniorPool: ${deployed.contracts.SeniorPool}`);
console.log(`USDC: ${deployed.contracts.USDC}\n`);

const totalLiquidity = await seniorPool.totalLiquidity();
const totalBorrowed = await seniorPool.totalBorrowed();
const poolBalance = await usdc.balanceOf(deployed.contracts.SeniorPool);
const available = totalLiquidity - totalBorrowed;

console.log('📊 Pool Status:');
console.log(`  Total Liquidity: $${ethers.formatUnits(totalLiquidity, 6)} USDC`);
console.log(`  Total Borrowed:  $${ethers.formatUnits(totalBorrowed, 6)} USDC`);
console.log(`  Available:       $${ethers.formatUnits(available, 6)} USDC`);
console.log(`  Pool Balance:    $${ethers.formatUnits(poolBalance, 6)} USDC\n`);

if (totalLiquidity === 0n && DEPLOYER_KEY) {
  console.log('⚠️  Pool has no liquidity! Funding with 500,000 USDC...\n');
  
  const wallet = new ethers.Wallet(DEPLOYER_KEY, provider);
  const seniorPoolWithSigner = seniorPool.connect(wallet);
  const usdcWithSigner = usdc.connect(wallet);
  
  const amount = ethers.parseUnits('500000', 6);
  
  // Mint USDC to deployer
  console.log('1. Minting USDC...');
  const mintTx = await usdcWithSigner.mint(wallet.address, amount);
  await mintTx.wait();
  console.log('✅ Minted 500,000 USDC\n');
  
  // Approve SeniorPool
  console.log('2. Approving SeniorPool...');
  const approveTx = await usdcWithSigner.approve(deployed.contracts.SeniorPool, amount);
  await approveTx.wait();
  console.log('✅ Approved\n');
  
  // Deposit liquidity
  console.log('3. Depositing liquidity...');
  const depositTx = await seniorPoolWithSigner.depositLiquidity(amount);
  await depositTx.wait();
  console.log('✅ Deposited 500,000 USDC to SeniorPool\n');
  
  const newLiquidity = await seniorPool.totalLiquidity();
  console.log(`💰 New Total Liquidity: $${ethers.formatUnits(newLiquidity, 6)} USDC`);
} else if (totalLiquidity === 0n) {
  console.log('⚠️  Pool has no liquidity! Run with DEPLOYER_KEY to fund it.');
  console.log('   DEPLOYER_KEY=0x... node scripts/check-senior-pool-liquidity.js');
} else {
  console.log('✅ Pool has sufficient liquidity');
}
