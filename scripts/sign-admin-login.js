#!/usr/bin/env node

/**
 * Admin Login Script
 *
 * This script automates the admin login flow:
 * 1. Requests challenge from backend
 * 2. Signs the message with admin private key
 * 3. Submits login request
 * 4. Returns JWT tokens
 */

import { ethers } from 'ethers';

const ADMIN_PRIVATE_KEY = '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
const API_URL = 'http://localhost:3000';

async function adminLogin() {
  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY);
    const adminAddress = wallet.address;

    console.log('🔐 Admin Wallet:', adminAddress);
    console.log('');

    // Step 1: Request Challenge
    console.log('📨 Requesting challenge...');
    const challengeResponse = await fetch(
      `${API_URL}/auth/challenge?walletAddress=${adminAddress}&role=ADMIN`
    );
    const challengeData = await challengeResponse.json();

    console.log('✅ Challenge received');
    console.log('   Nonce:', challengeData.nonce);
    console.log('');

    // Step 2: Sign the message
    console.log('✍️  Signing message...');
    const signature = await wallet.signMessage(challengeData.message);

    console.log('✅ Signature created');
    console.log('   Signature:', signature);
    console.log('');

    // Step 3: Login
    console.log('🔑 Logging in...');
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress: adminAddress,
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
    console.log(`   export ADMIN_TOKEN="${loginData.tokens.access}"`);
    console.log('');

    return loginData;
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
adminLogin();
