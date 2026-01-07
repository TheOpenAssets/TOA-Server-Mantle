#!/usr/bin/env node

/**
 * Check OAID Credit Lines (Direct On-Chain Query)
 * 
 * Queries the OAID contract directly to check credit lines for a user
 * Usage: node scripts/check-oaid-credit.js [userAddress]
 */

import { createPublicClient, http, formatUnits, defineChain } from 'viem';
import fs from 'fs';
import path from 'path';

const RPC_URL = 'https://rpc.sepolia.mantle.xyz';
const DEPLOYED_CONTRACTS_PATH = path.join(process.cwd(), 'packages/contracts/deployed_contracts.json');

// Define Mantle Sepolia chain
const mantleSepolia = defineChain({
  id: 5003,
  name: 'Mantle Sepolia',
  nativeCurrency: {
    decimals: 18,
    name: 'Mantle',
    symbol: 'MNT',
  },
  rpcUrls: {
    default: { http: ['https://rpc.sepolia.mantle.xyz'] },
    public: { http: ['https://rpc.sepolia.mantle.xyz'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://explorer.sepolia.mantle.xyz' },
  },
});

// Get user address from args or use default
const USER_ADDRESS = process.argv[2] || '0x23e67597f0898f747Fa3291C8920168adF9455D0';

// OAID ABI (minimal for credit checking)
const OAID_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserCreditLines',
    outputs: [{ name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'creditLineId', type: 'uint256' }],
    name: 'getCreditLine',
    outputs: [
      {
        components: [
          { name: 'user', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'collateralAmount', type: 'uint256' },
          { name: 'creditLimit', type: 'uint256' },
          { name: 'creditUsed', type: 'uint256' },
          { name: 'solvencyPositionId', type: 'uint256' },
          { name: 'issuedAt', type: 'uint256' },
          { name: 'totalPayments', type: 'uint256' },
          { name: 'onTimePayments', type: 'uint256' },
          { name: 'latePayments', type: 'uint256' },
          { name: 'totalAmountRepaid', type: 'uint256' },
          { name: 'liquidated', type: 'bool' },
          { name: 'liquidatedAt', type: 'uint256' },
          { name: 'active', type: 'bool' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getTotalCreditLimit',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getTotalAvailableCredit',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'isUserRegistered',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function checkOAIDCredit() {
  try {
    console.log('🔍 Checking OAID Credit Lines On-Chain\n');
    console.log('👤 User A', USER_ADDRESS);
    console.log('');

    // Load deployed contracts
    const contractsData = JSON.parse(fs.readFileSync(DEPLOYED_CONTRACTS_PATH, 'utf8'));
    const OAID_ADDRESS = contractsData.contracts?.OAID || contractsData.OAID;

    if (!OAID_ADDRESS) {
      console.error('❌ OAID contract address not found in deployed_contracts.json');
      process.exit(1);
    }

    console.log('📄 OAID Contract:', OAID_ADDRESS);
    console.log('');

    // Create public client
    const client = createPublicClient({
      chain: mantleSepolia,
      transport: http(RPC_URL),
    });

    // Check if user is registered
    console.log('📋 Checking Registration...');
    const isRegistered = await client.readContract({
      address: OAID_ADDRESS,
      abi: OAID_ABI,
      functionName: 'isUserRegistered',
      args: [USER_ADDRESS],
    });

    console.log(`   Registered: ${isRegistered ? '✅ Yes' : '❌ No'}`);
    console.log('');

    if (!isRegistered) {
      console.log('⚠️  User is not registered with OAID. Complete KYC to register.');
      console.log('');
      return;
    }

    // Get total credit limit
    console.log('💳 Fetching Credit Summary...');
    const totalCreditLimit = await client.readContract({
      address: OAID_ADDRESS,
      abi: OAID_ABI,
      functionName: 'getTotalCreditLimit',
      args: [USER_ADDRESS],
    });

    const totalAvailableCredit = await client.readContract({
      address: OAID_ADDRESS,
      abi: OAID_ABI,
      functionName: 'getTotalAvailableCredit',
      args: [USER_ADDRESS],
    });

    const totalCreditUsed = totalCreditLimit - totalAvailableCredit;

    console.log(`   Total Credit Limit:     $${formatUnits(totalCreditLimit, 6)}`);
    console.log(`   Total Credit Used:      $${formatUnits(totalCreditUsed, 6)}`);
    console.log(`   Total Available Credit: $${formatUnits(totalAvailableCredit, 6)}`);
    console.log('');

    // Get individual credit lines
    console.log('📊 Fetching Individual Credit Lines...');
    const creditLineIds = await client.readContract({
      address: OAID_ADDRESS,
      abi: OAID_ABI,
      functionName: 'getUserCreditLines',
      args: [USER_ADDRESS],
    });

    console.log(`   Found ${creditLineIds} credit line(s)`);
    console.log('');

    if (creditLineIds.length === 0) {
      console.log('ℹ️  No credit lines found. Deposit collateral with issueOAID=true to create one.');
      console.log('');
      console.log('💡 To create a credit line:');
      console.log('   1. Deposit RWA/Private Asset tokens to SolvencyVault');
      console.log('   2. Set issueOAID: true in the deposit request');
      console.log('   3. Credit line will be automatically created');
      console.log('');
      return;
    }

    // Fetch and display each credit line
    for (let i = 0; i < creditLineIds.length; i++) {
      const creditLineId = creditLineIds[i];
      console.log(`📌 Credit Line #${creditLineId}`);
      console.log('   ─────────────────────────────────────────');

      const creditLine = await client.readContract({
        address: OAID_ADDRESS,
        abi: OAID_ABI,
        functionName: 'getCreditLine',
        args: [creditLineId],
      });

      // Access properties by name from the returned object
      const user = creditLine.user;
      const collateralToken = creditLine.collateralToken;
      const collateralAmount = creditLine.collateralAmount;
      const creditLimit = creditLine.creditLimit;
      const creditUsed = creditLine.creditUsed;
      const solvencyPositionId = creditLine.solvencyPositionId;
      const issuedAt = creditLine.issuedAt;
      const active = creditLine.active;

      const availableCredit = creditLimit - creditUsed;
      const utilizationRate = creditLimit > 0n ? Number((creditUsed * 10000n) / creditLimit) / 100 : 0;

      console.log(`   Status:              ${active ? '✅ Active' : '❌ Inactive'}`);
      console.log(`   Collateral Token:    ${collateralToken}`);
      console.log(`   Collateral Amount:   ${formatUnits(collateralAmount, 18)}`);
      console.log(`   Credit Limit:        $${formatUnits(creditLimit, 6)}`);
      console.log(`   Credit Used:         $${formatUnits(creditUsed, 6)}`);
      console.log(`   Available Credit:    $${formatUnits(availableCredit, 6)}`);
      console.log(`   Utilization Rate:    ${utilizationRate.toFixed(2)}%`);
      console.log(`   Solvency Position:   #${solvencyPositionId}`);
      console.log(`   Issued At:           ${new Date(Number(issuedAt) * 1000).toISOString()}`);
      console.log('');
    }

    // Summary
    const activeCreditLines = creditLineIds.length;
    console.log('📈 Summary');
    console.log('   ─────────────────────────────────────────');
    console.log(`   Active Credit Lines:  ${activeCreditLines}`);
    console.log(`   Total Credit Limit:   $${formatUnits(totalCreditLimit, 6)}`);
    console.log(`   Total Used:           $${formatUnits(totalCreditUsed, 6)}`);
    console.log(`   Total Available:      $${formatUnits(totalAvailableCredit, 6)}`);
    
    if (totalCreditLimit > 0n) {
      const overallUtilization = Number((totalCreditUsed * 10000n) / totalCreditLimit) / 100;
      console.log(`   Utilization Rate:     ${overallUtilization.toFixed(2)}%`);
    }
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
checkOAIDCredit();
