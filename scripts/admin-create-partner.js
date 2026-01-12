#!/usr/bin/env node

/**
 * Admin: Create New Partner
 *
 * This script allows admins to create new partner platforms and generate their API keys.
 *
 * Usage:
 *   ADMIN_KEY=0x... node scripts/admin-create-partner.js <partner_name> <partner_prefix> <tier>
 *
 * Tiers: BASIC, PREMIUM, ENTERPRISE
 *
 * Examples:
 *   ADMIN_KEY=0x... node scripts/admin-create-partner.js "XYZ Lending" xyz PREMIUM
 *   ADMIN_KEY=0x... node scripts/admin-create-partner.js "ABC Finance" abc BASIC
 *
 * Required Environment Variables:
 *   ADMIN_KEY           - Admin wallet private key
 *   BACKEND_URL         - Backend API URL (default: http://localhost:3000)
 *
 * This script will:
 * 1. Authenticate as admin
 * 2. Create partner in database
 * 3. Generate and return API key (shown only once!)
 * 4. Display partner configuration
 */

import { ethers } from 'ethers';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, colors.bright + colors.cyan);
  console.log('='.repeat(60));
}

function logSuccess(message) {
  log(`✅ ${message}`, colors.green);
}

function logError(message) {
  log(`❌ ${message}`, colors.red);
}

function logInfo(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logWarning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// Validation
if (!ADMIN_KEY) {
  logError('ADMIN_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/admin-create-partner.js <name> <prefix> <tier>');
  console.log('\nExample:');
  console.log('  ADMIN_KEY=0x123... node scripts/admin-create-partner.js "XYZ Lending" xyz PREMIUM');
  process.exit(1);
}

const partnerName = process.argv[2];
const partnerPrefix = process.argv[3];
const tier = process.argv[4] || 'BASIC';

if (!partnerName || !partnerPrefix) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  ADMIN_KEY=0x... node scripts/admin-create-partner.js <name> <prefix> <tier>');
  console.log('\nTiers: BASIC, PREMIUM, ENTERPRISE');
  console.log('\nExample:');
  console.log('  ADMIN_KEY=0x123... node scripts/admin-create-partner.js "XYZ Lending" xyz PREMIUM');
  process.exit(1);
}

// Tier configurations
const TIER_CONFIGS = {
  BASIC: {
    dailyBorrowLimit: '50000000000',   // $50k
    totalBorrowLimit: '200000000000',  // $200k
    platformFeePercentage: 75,          // 0.75%
  },
  PREMIUM: {
    dailyBorrowLimit: '100000000000',  // $100k
    totalBorrowLimit: '500000000000',  // $500k
    platformFeePercentage: 50,          // 0.50%
  },
  ENTERPRISE: {
    dailyBorrowLimit: '500000000000',  // $500k
    totalBorrowLimit: '2000000000000', // $2M
    platformFeePercentage: 25,          // 0.25%
  },
};

/**
 * Get Admin JWT Token
 */
async function getAdminToken() {
  logSection('Step 1: Admin Authentication');

  const wallet = new ethers.Wallet(ADMIN_KEY);
  const adminAddress = wallet.address;

  logInfo(`Admin Address: ${adminAddress}`);
  logInfo('Requesting authentication challenge...');

  try {
    // Request challenge
    const challengeResponse = await fetch(
      `${BACKEND_URL}/auth/challenge?walletAddress=${adminAddress}&role=ADMIN`
    );

    if (!challengeResponse.ok) {
      throw new Error(`Failed to get challenge: ${challengeResponse.statusText}`);
    }

    const challengeData = await challengeResponse.json();
    logInfo(`Challenge received (nonce: ${challengeData.nonce})`);

    // Sign message
    logInfo('Signing challenge message...');
    const signature = await wallet.signMessage(challengeData.message);

    // Login
    logInfo('Submitting login request...');
    const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: adminAddress,
        message: challengeData.message,
        signature: signature,
      }),
    });

    if (!loginResponse.ok) {
      const errorData = await loginResponse.json();
      throw new Error(`Login failed: ${JSON.stringify(errorData)}`);
    }

    const loginData = await loginResponse.json();

    if (!loginData.tokens || !loginData.tokens.access) {
      throw new Error('No access token in login response');
    }

    logSuccess(`Authenticated as ${loginData.user.role}`);
    return loginData.tokens.access;

  } catch (error) {
    logError(`Authentication failed: ${error.message}`);
    throw error;
  }
}

/**
 * Create Partner
 */
async function createPartner(jwt) {
  logSection('Step 2: Create Partner Platform');

  const tierConfig = TIER_CONFIGS[tier.toUpperCase()];

  if (!tierConfig) {
    throw new Error(`Invalid tier: ${tier}. Valid tiers: BASIC, PREMIUM, ENTERPRISE`);
  }

  // Get settlement address from user or use a placeholder
  const settlementAddress = process.env.PARTNER_SETTLEMENT_ADDRESS || '0x0000000000000000000000000000000000000000';
  const contactEmail = process.env.PARTNER_EMAIL || `contact@${partnerPrefix}.example.com`;

  const partnerData = {
    partnerName,
    partnerPrefix,
    tier: tier.toUpperCase(),
    dailyBorrowLimit: tierConfig.dailyBorrowLimit,
    totalBorrowLimit: tierConfig.totalBorrowLimit,
    platformFeePercentage: tierConfig.platformFeePercentage,
    settlementAddress,
    contactEmail,
  };

  console.log('\n📋 Partner Configuration:');
  console.log(`  Name:                   ${partnerData.partnerName}`);
  console.log(`  Prefix:                 ${partnerData.partnerPrefix}`);
  console.log(`  Tier:                   ${partnerData.tier}`);
  console.log(`  Daily Borrow Limit:     $${(Number(partnerData.dailyBorrowLimit) / 1e6).toLocaleString()}`);
  console.log(`  Total Borrow Limit:     $${(Number(partnerData.totalBorrowLimit) / 1e6).toLocaleString()}`);
  console.log(`  Platform Fee:           ${tierConfig.platformFeePercentage / 100}%`);
  console.log(`  Settlement Address:     ${partnerData.settlementAddress}`);
  console.log(`  Contact Email:          ${partnerData.contactEmail}`);

  logInfo('\nCreating partner...');

  try {
    const response = await fetch(`${BACKEND_URL}/admin/partners`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(partnerData),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Partner creation failed: ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();

    logSuccess('Partner created successfully!');

    return result;

  } catch (error) {
    logError(`Partner creation failed: ${error.message}`);
    throw error;
  }
}

/**
 * Display Partner Information
 */
function displayPartnerInfo(partner) {
  logSection('✨ Partner Created Successfully!');

  console.log('\n🔑 API CREDENTIALS (Save these securely - API key shown only once!)');
  console.log('─'.repeat(60));
  console.log(colors.yellow + colors.bright);
  console.log(`  Partner ID:    ${partner.partner.partnerId}`);
  console.log(`  API Key:       ${partner.plainApiKey}`);
  console.log(colors.reset);
  console.log('─'.repeat(60));

  console.log('\n📊 Partner Details:');
  console.log(`  Name:                  ${partner.partner.partnerName}`);
  console.log(`  Status:                ${partner.partner.status}`);
  console.log(`  Tier:                  ${partner.partner.tier}`);
  console.log(`  Created:               ${new Date(partner.partner.createdAt).toLocaleString()}`);

  console.log('\n💰 Limits:');
  console.log(`  Daily Borrow Limit:    $${(Number(partner.partner.dailyBorrowLimit) / 1e6).toLocaleString()}`);
  console.log(`  Total Borrow Limit:    $${(Number(partner.partner.totalBorrowLimit) / 1e6).toLocaleString()}`);
  console.log(`  Platform Fee:          ${partner.partner.platformFeePercentage / 100}%`);

  console.log('\n🔧 Configuration:');
  console.log(`  Settlement Address:    ${partner.partner.settlementAddress}`);
  console.log(`  Contact Email:         ${partner.partner.contactEmail}`);

  console.log('\n📝 Next Steps:');
  console.log('  1. Save the API key securely (it will not be shown again)');
  console.log('  2. Share integration documentation with partner');
  console.log('  3. Set up partner settlement wallet address if needed');
  console.log('  4. Test integration in sandbox environment');

  console.log('\n📚 Integration Guide:');
  console.log('  - Repayment Guide:     docs/PARTNER_REPAYMENT_GUIDE.md');
  console.log('  - Testing Guide:       docs/testing/PARTNER_INTEGRATION_TESTING_GUIDE.md');
  console.log('  - Implementation:      docs/code/PARTNER_IMPLEMENTATION_STATUS.md');

  console.log('\n🧪 Test the Integration:');
  console.log(colors.cyan + `  PARTNER_API_KEY=${partner.plainApiKey} \\` + colors.reset);
  console.log(colors.cyan + `  node scripts/partner-repay-with-transfer.js query <loan_id>` + colors.reset);

  console.log('\n⚠️  Security Reminders:');
  console.log('  - Store API key in environment variables, never in code');
  console.log('  - Use HTTPS only for API requests');
  console.log('  - Monitor API usage and set up alerts');
  console.log('  - Regenerate API key if compromised');

  console.log('\n🔄 Regenerate API Key:');
  console.log(colors.yellow + `  ADMIN_KEY=... node scripts/admin-regenerate-partner-key.js ${partner.partner.partnerId}` + colors.reset);
}

/**
 * Main
 */
async function main() {
  logSection('Create New Partner Platform');

  console.log('\n📝 Configuration:');
  console.log(`  Partner Name:     ${partnerName}`);
  console.log(`  Partner Prefix:   ${partnerPrefix}`);
  console.log(`  Tier:             ${tier.toUpperCase()}`);
  console.log(`  Backend URL:      ${BACKEND_URL}`);

  try {
    // Step 1: Authenticate as admin
    const jwt = await getAdminToken();

    // Step 2: Create partner
    const partner = await createPartner(jwt);

    // Step 3: Display results
    displayPartnerInfo(partner);

    logSuccess('\n✨ Partner creation complete!');

  } catch (error) {
    console.error('\n' + '='.repeat(60));
    logError('Script failed:');
    console.error(error);
    console.error('='.repeat(60));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
