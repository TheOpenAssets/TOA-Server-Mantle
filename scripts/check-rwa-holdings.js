#!/usr/bin/env node

/**
 * Check RWA Token Holdings
 * 
 * Usage:
 *   node scripts/check-rwa-holdings.js <investor_address>
 * 
 * Example:
 *   node scripts/check-rwa-holdings.js 0x580F5b09765E71D64613c8F4403234f8790DD7D3
 */

import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const investorAddress = process.argv[2];

if (!investorAddress) {
  console.error('❌ Missing investor address');
  console.log('\nUsage:');
  console.log('  node scripts/check-rwa-holdings.js <investor_address>');
  console.log('\nExample:');
  console.log('  node scripts/check-rwa-holdings.js 0x580F5b09765E71D64613c8F4403234f8790DD7D3');
  process.exit(1);
}

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function totalSupply() view returns (uint256)',
];

// Common RWA token addresses to check (add your known token addresses here)
const knownTokens = [
  '0xC91f80c110fE53c0549D990D0eE5bE8EAF123D5e', // From your MongoDB data
  '0x76a2867Ac400EDE124949459eD2A2379b5d4930d', // You tried this one
];

async function checkHoldings() {
  console.log('🔍 Checking RWA Token Holdings');
  console.log('═'.repeat(60));
  console.log(`Investor: ${investorAddress}`);
  console.log(`Network: Mantle Sepolia`);
  console.log('═'.repeat(60));
  console.log('');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  let hasTokens = false;

  for (const tokenAddr of knownTokens) {
    try {
      const token = new ethers.Contract(tokenAddr, ERC20_ABI, provider);
      
      const [balance, decimals, symbol, name] = await Promise.all([
        token.balanceOf(investorAddress),
        token.decimals(),
        token.symbol(),
        token.name(),
      ]);

      const balanceFormatted = ethers.formatUnits(balance, decimals);

      if (balance > 0n) {
        hasTokens = true;
        console.log('✅ FOUND TOKENS!');
        console.log(`   Token: ${name} (${symbol})`);
        console.log(`   Address: ${tokenAddr}`);
        console.log(`   Balance: ${balanceFormatted} ${symbol}`);
        console.log(`   Balance (wei): ${balance.toString()}`);
        console.log('');
      } else {
        console.log(`⚪ ${symbol} - Balance: 0`);
        console.log(`   Address: ${tokenAddr}`);
        console.log('');
      }
    } catch (error) {
      console.log(`❌ Error checking ${tokenAddr}: ${error.message}`);
      console.log('');
    }
  }

  if (!hasTokens) {
    console.log('═'.repeat(60));
    console.log('⚠️  No RWA tokens found in known addresses');
    console.log('');
    console.log('Possible reasons:');
    console.log('  1. Tokens were claimed/transferred to another address');
    console.log('  2. Token address not in the known list above');
    console.log('  3. Purchase not yet finalized on-chain');
    console.log('');
    console.log('💡 To check a specific token address:');
    console.log('   Add it to the knownTokens array in this script');
  }
}

checkHoldings()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
