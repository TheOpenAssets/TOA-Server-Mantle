#!/usr/bin/env node

/**
 * Get User Authentication Token
 * Silent script that outputs only the JWT token for use in shell scripts
 */

import { ethers } from 'ethers';

const INVESTOR_KEY = process.env.INVESTOR_KEY || process.env.USER_KEY;
const API_URL = process.env.API_URL || 'http://localhost:3000';

if (!INVESTOR_KEY) {
  console.error('Error: INVESTOR_KEY or USER_KEY environment variable not set');
  process.exit(1);
}

async function getUserToken() {
  try {
    // Create wallet from private key
    const wallet = new ethers.Wallet(INVESTOR_KEY);
    const userAddress = wallet.address;

    // Step 1: Request Challenge
    const challengeResponse = await fetch(
      `${API_URL}/auth/challenge?walletAddress=${userAddress}&role=INVESTOR`
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
        walletAddress: userAddress,
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
getUserToken();
