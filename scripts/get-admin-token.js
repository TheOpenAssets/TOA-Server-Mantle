#!/usr/bin/env node

/**
 * Get Admin Authentication Token
 * Silent script that outputs only the JWT token for use in shell scripts
 */

import { ethers } from 'ethers';

const ADMIN_KEY = process.env.ADMIN_KEY;
const API_URL = process.env.API_URL || 'http://localhost:3000';

if (!ADMIN_KEY) {
  console.error('Error: ADMIN_KEY environment variable not set');
  process.exit(1);
}

async function getAdminToken() {
  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(ADMIN_KEY);
    const adminAddress = wallet.address;

    // Step 1: Request Challenge
    const challengeResponse = await fetch(
      `${API_URL}/auth/challenge?walletAddress=${adminAddress}&role=ADMIN`
    );
    const challengeData = await challengeResponse.json();

    if (!challengeData.message) {
      throw new Error('Failed to get challenge from backend');
    }

    // Step 2: Sign the message
    const signature = await wallet.signMessage(challengeData.message);

    // Step 3: Login
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
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }

    // Output only the token
    console.log(loginData.tokens.access);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Run the script
getAdminToken();
