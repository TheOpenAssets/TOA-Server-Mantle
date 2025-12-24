#!/usr/bin/env node

/**
 * Originator Asset Upload Script
 * Authenticates as originator and uploads an invoice asset
 */

const { createWalletClient, http } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { mantleSepolia } = require('../packages/backend/dist/config/mantle-chain');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const ORIGINATOR_PRIVATE_KEY = process.env.ORIGINATOR_PRIVATE_KEY;
const INVOICE_FILE_PATH = process.argv[2];

// Colors
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

function log(message, color = RESET) {
  console.log(`${color}${message}${RESET}`);
}

function logHeader(message) {
  console.log('');
  console.log(`${BLUE}========================================${RESET}`);
  console.log(`${BLUE}${message}${RESET}`);
  console.log(`${BLUE}========================================${RESET}`);
  console.log('');
}

async function main() {
  try {
    // Validate inputs
    if (!ORIGINATOR_PRIVATE_KEY) {
      log('❌ Error: ORIGINATOR_PRIVATE_KEY not set!', RED);
      log('Usage: ORIGINATOR_PRIVATE_KEY=0x... node scripts/upload-asset-as-originator.js <path-to-invoice.pdf>', YELLOW);
      process.exit(1);
    }

    if (!INVOICE_FILE_PATH) {
      log('❌ Error: Invoice file path not provided!', RED);
      log('Usage: ORIGINATOR_PRIVATE_KEY=0x... node scripts/upload-asset-as-originator.js <path-to-invoice.pdf>', YELLOW);
      process.exit(1);
    }

    if (!fs.existsSync(INVOICE_FILE_PATH)) {
      log(`❌ Error: File not found: ${INVOICE_FILE_PATH}`, RED);
      process.exit(1);
    }

    // Create wallet from private key
    const account = privateKeyToAccount(ORIGINATOR_PRIVATE_KEY);
    const walletAddress = account.address;
    
    logHeader('Originator Asset Upload');
    log(`📍 API: ${API_BASE_URL}`);
    log(`👤 Originator: ${walletAddress}`);
    log(`📄 Invoice: ${path.basename(INVOICE_FILE_PATH)}`);

    // Step 1: Get Challenge
    logHeader('Step 1: Get Authentication Challenge');
    log('Requesting challenge from server...');

    const challengeResponse = await fetch(
      `${API_BASE_URL}/auth/challenge?walletAddress=${walletAddress}&role=ORIGINATOR`
    );

    if (!challengeResponse.ok) {
      throw new Error(`Failed to get challenge: ${challengeResponse.statusText}`);
    }

    const { message, nonce } = await challengeResponse.json();
    log(`✓ Challenge received`, GREEN);
    log(`  Nonce: ${nonce}`);
    log(`  Message: ${message.substring(0, 50)}...`);

    // Step 2: Sign Message
    logHeader('Step 2: Sign Authentication Message');
    log('Signing message with private key...');

    const walletClient = createWalletClient({
      account,
      chain: mantleSepolia,
      transport: http(),
    });

    const signature = await walletClient.signMessage({
      message,
    });

    log(`✓ Message signed`, GREEN);
    log(`  Signature: ${signature.substring(0, 20)}...`);

    // Step 3: Login
    logHeader('Step 3: Login to Platform');
    log('Submitting authentication...');

    const loginResponse = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress,
        message,
        signature,
      }),
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.text();
      throw new Error(`Login failed: ${error}`);
    }

    const loginData = await loginResponse.json();
    const accessToken = loginData.tokens.access;

    log(`✓ Login successful`, GREEN);
    log(`  User ID: ${loginData.user.id}`);
    log(`  Role: ${loginData.user.role}`);
    log(`  KYC Status: ${loginData.user.kyc ? 'Verified ✓' : 'Not Verified'}`);
    log(`  Access Token: ${accessToken.substring(0, 30)}...`);

    // Step 4: Upload Asset
    logHeader('Step 4: Upload Invoice Asset');
    log('Preparing asset upload...');

    const formData = new FormData();
    formData.append('file', fs.createReadStream(INVOICE_FILE_PATH));
    formData.append('invoiceNumber', 'INV-2025-' + Date.now().toString().slice(-6));
    formData.append('faceValue', '100000');
    formData.append('currency', 'USD');
    formData.append('issueDate', '2025-01-01');
    formData.append('dueDate', '2025-07-01');
    formData.append('buyerName', 'Tech Solutions Inc');
    formData.append('industry', 'Technology');
    formData.append('riskTier', 'A');
    formData.append('totalSupply', '100000');
    formData.append('pricePerToken', '1');
    formData.append('minInvestment', '1000');

    log('Uploading asset...');

    const uploadResponse = await fetch(`${API_BASE_URL}/assets/upload`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.text();
      throw new Error(`Upload failed: ${error}`);
    }

    const uploadData = await uploadResponse.json();

    log(`✓ Asset uploaded successfully!`, GREEN);
    console.log('');
    console.log('Response:', JSON.stringify(uploadData, null, 2));

    // Summary
    logHeader('Upload Complete! 🎉');
    log(`Asset ID: ${uploadData.assetId}`, GREEN);
    log(`Status: ${uploadData.status}`, GREEN);
    log(`Message: ${uploadData.message}`, GREEN);
    console.log('');
    log('Next Steps:', YELLOW);
    log('1. Wait for asset processing (hash computation, merkle tree)');
    log('2. Admin approves the asset');
    log('3. Asset gets registered on-chain');
    log('4. Token gets deployed');
    log('5. Asset is listed on marketplace');
    console.log('');
    log('To check asset status:', BLUE);
    log(`curl -X GET "${API_BASE_URL}/assets/${uploadData.assetId}" \\`);
    log(`  --header "Authorization: Bearer ${accessToken}" | jq`);
    console.log('');
    log('Save this Asset ID:', YELLOW);
    log(`export ASSET_ID="${uploadData.assetId}"`);
    console.log('');

  } catch (error) {
    log(`\n❌ Error: ${error.message}`, RED);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run the script
main();
