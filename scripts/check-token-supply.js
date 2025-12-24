#!/usr/bin/env node
import { ethers } from 'ethers';

const TOKEN_ABI = [
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function owner() view returns (address)',
];

async function checkTokenSupply() {
  const tokenAddress = '0x6591b5A3b79850ab530244BF9A262036A3667575';
  const provider = new ethers.JsonRpcProvider('https://rpc.sepolia.mantle.xyz');
  const tokenContract = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
  
  const totalSupply = await tokenContract.totalSupply();
  console.log('Total Supply:', ethers.formatUnits(totalSupply, 18), 'tokens');
  console.log('Total Supply (raw):', totalSupply.toString());
  
  // Check owner
  try {
    const owner = await tokenContract.owner();
    console.log('Token Owner:', owner);
    
    const ownerBalance = await tokenContract.balanceOf(owner);
    console.log('Owner Balance:', ethers.formatUnits(ownerBalance, 18), 'tokens');
  } catch (e) {
    console.log('No owner function');
  }
  
  // Check common addresses
  const addresses = [
    { name: 'Admin', addr: '0x23e67597f0898f747Fa3291C8920168adF9455D0' },
    { name: 'Token Contract', addr: tokenAddress },
    { name: 'Zero Address', addr: ethers.ZeroAddress },
  ];
  
  console.log('\nBalances:');
  for (const {name, addr} of addresses) {
    const balance = await tokenContract.balanceOf(addr);
    console.log(`  ${name}: ${ethers.formatUnits(balance, 18)} tokens`);
  }
}

checkTokenSupply();
