#!/usr/bin/env node

/**
 * Investor Login Script
 *
 * This script automates the investor login flow:
 * 1. Requests challenge from backend
 * 2. Signs the message with investor private key
 * 3. Submits login request
 * 4. Returns JWT tokens
 */

import { ethers } from 'ethers';

const INVESTOR_PRIVATE_KEY = process.env.INVESTOR_PRIVATE_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
const API_URL = process.env.API_BASE_URL || 'http://localhost:3000';

async function investorLogin() {
  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(INVESTOR_PRIVATE_KEY);
    const investorAddress = wallet.address;

    console.log('🔐 Investor Wallet:', investorAddress);
    console.log('');

    // Step 1: Request Challenge
    console.log('📨 Requesting challenge...');
    const challengeResponse = await fetch(
      `${API_URL}/auth/challenge?walletAddress=${investorAddress}&role=INVESTOR`
    );
    const challengeData = await challengeResponse.json();

    if (!challengeResponse.ok) {
      console.error('❌ Failed to get challenge:', challengeData);
      process.exit(1);
    }

    console.log('✅ Challenge received');
    console.log('   Nonce:', challengeData.nonce);
    console.log('');

    // Step 2: Sign the message
    console.log('✍️  Signing message...');
    const signature = await wallet.signMessage(challengeData.message);

    console.log('✅ Signature created');
    console.log('   Signature:', signature.substring(0, 20) + '...');
    console.log('');

    // Step 3: Login
    console.log('🔑 Logging in...');
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: investorAddress,
        message: challengeData.message,
        signature: signature,
      }),
    });

    const loginData = await loginResponse.json();

    if (!loginResponse.ok) {
      console.error('❌ Login failed:', loginData);
      process.exit(1);
    }

    console.log('✅ Login successful!');
    console.log('');
    console.log('👤 User Info:');
    console.log('   ID:', loginData.user.id);
    console.log('   Wallet:', loginData.user.walletAddress);
    console.log('   Role:', loginData.user.role);
    console.log('   KYC:', loginData.user.kyc);
    console.log('');
    console.log('🎫 Access Token:');
    console.log('   ', loginData.tokens.access);
    console.log('');
    console.log('🔄 Refresh Token:');
    console.log('   ', loginData.tokens.refresh);
    console.log('');
    console.log('💡 Export token for use in curl commands:');
    console.log(`   export INVESTOR_TOKEN="${loginData.tokens.access}"`);
    console.log('');
    console.log('📝 Use this token to notify backend about bids:');
    console.log('   curl -X POST http://localhost:3000/marketplace/bids/notify \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log(`     -H "Authorization: Bearer ${loginData.tokens.access}" \\`);
    console.log('     -d \'{ "txHash": "0x...", "assetId": "...", "tokenAmount": "...", "price": "..." }\'');
    console.log('');

    return loginData;
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
investorLogin();
