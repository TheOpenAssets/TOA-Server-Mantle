#!/usr/bin/env node

/**
 * Borrow USDC from Solvency Vault with Auto-Calculated Maturity
 *
 * Usage:
 *   INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js <position_id> <amount_usdc> <installments>
 *
 * Example:
 *   INVESTOR_KEY=0x1234... node scripts/borrow-solvency-loan.js 1 5000 3
 *
 * This script will:
 * 1. Authenticate with backend
 * 2. Fetch position details to identify the collateral token
 * 3. Find the underlying Asset to determine maturity date (dueDate)
 * 4. Calculate loan duration based on maturity date
 * 5. Execute borrowUSDC transaction
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { join } from 'path';

// Configuration
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL || 'https://rpc.sepolia.mantle.xyz';
const INVESTOR_KEY = process.env.INVESTOR_KEY;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
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
if (!INVESTOR_KEY) {
  logError('INVESTOR_KEY environment variable is required');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js <position_id> <amount_usdc> <installments>');
  process.exit(1);
}

const positionId = process.argv[2];
const borrowAmount = process.argv[3];
const numberOfInstallments = process.argv[4];

if (!positionId || !borrowAmount || !numberOfInstallments) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js <position_id> <amount_usdc> <installments>');
  process.exit(1);
}

// Load deployed contracts
const deployedPath = join(process.cwd(), 'packages/contracts/deployed_contracts.json');
let deployed;
try {
  deployed = JSON.parse(readFileSync(deployedPath, 'utf-8'));
} catch (error) {
  logError('deployed_contracts.json not found. Have you deployed the contracts?');
  process.exit(1);
}

const contracts = deployed.contracts;

const SOLVENCY_VAULT_ABI = [
  'function borrowUSDC(uint256 positionId, uint256 amount, uint256 loanDuration, uint256 numberOfInstallments) external',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, bool active, uint8 tokenType)',
  'event USDCBorrowed(uint256 indexed positionId, uint256 amount, uint256 totalDebt)',
];

const SENIOR_POOL_ABI = [
  'function getOutstandingDebt(uint256 positionId) view returns (uint256)',
];

async function getJWTToken(wallet) {
  try {
    logInfo('Requesting authentication challenge...');
    const challengeResponse = await fetch(
      `${BACKEND_URL}/auth/challenge?walletAddress=${wallet.address}&role=INVESTOR`
    );

    if (!challengeResponse.ok) {
      const errorData = await challengeResponse.json();
      throw new Error(`Failed to get challenge: ${JSON.stringify(errorData)}`);
    }

    const challengeData = await challengeResponse.json();
    logInfo(`Challenge received (nonce: ${challengeData.nonce})`);

    logInfo('Signing challenge message...');
    const signature = await wallet.signMessage(challengeData.message);

    logInfo('Submitting login request...');
    const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: wallet.address,
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

    logSuccess(`Authenticated successfully (Role: ${loginData.user.role})`);
    return loginData.tokens.access;
  } catch (error) {
    logError(`Authentication failed: ${error.message}`);
    throw error;
  }
}

async function fetchPosition(jwt, positionId) {
  logSection('Step 2: Fetch Position Details');
  logInfo(`Fetching position ${positionId}...`);

  const response = await fetch(`${BACKEND_URL}/solvency/position/${positionId}`, {
    headers: { 'Authorization': `Bearer ${jwt}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch position: ${response.statusText}`);
  }

  const data = await response.json();
  const position = data.position;
  
  if (!position) {
    throw new Error('Position not found');
  }

  logSuccess(`Found position. Collateral Token: ${position.collateralTokenAddress}`);
  return position;
}

async function findAssetByToken(jwt, tokenAddress) {
  logSection('Step 3: Find Asset & Maturity Date');
  logInfo('Searching for asset matching token address...');

  try {
    const response = await fetch(`${BACKEND_URL}/assets/token/${tokenAddress}`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to lookup asset: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.success || !data.asset) {
      throw new Error(`Asset not found for token address ${tokenAddress}`);
    }

    const asset = data.asset;
    logSuccess(`Found Asset: ${asset.assetId}`);
    
    if (!asset.metadata || !asset.metadata.dueDate) {
      throw new Error('Asset metadata does not contain a due date (maturity)');
    }

    return asset;
  } catch (error) {
    logError(`Asset lookup failed: ${error.message}`);
    throw error;
  }
}

async function borrowUSDC(solvencyVaultContract, positionId, amount, loanDurationSeconds, numberOfInstallments) {
  logSection('Step 5: Borrow USDC');

  logInfo(`Borrowing $${ethers.formatUnits(amount, 6)} USDC...`);

  try {
    const tx = await solvencyVaultContract.borrowUSDC(
      positionId,
      amount,
      loanDurationSeconds,
      numberOfInstallments
    );

    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation...');

    const receipt = await tx.wait();
    logSuccess(`Borrow confirmed in block ${receipt.blockNumber}`);

    // Parse USDCBorrowed event
    let borrowed = null;
    let totalDebt = null;
    for (const log of receipt.logs) {
      try {
        const parsed = solvencyVaultContract.interface.parseLog(log);
        if (parsed.name === 'USDCBorrowed') {
          borrowed = parsed.args.amount;
          totalDebt = parsed.args.totalDebt;
          logSuccess(`Borrowed: $${ethers.formatUnits(borrowed, 6)} USDC`);
          logInfo(`Total Debt: $${ethers.formatUnits(totalDebt, 6)} USDC`);
          break;
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    logInfo(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

    return {
      borrowed,
      totalDebt,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
    };
  } catch (error) {
    logError(`Borrow failed: ${error.message}`);
    throw error;
  }
}

async function notifyBackendOfBorrow(jwt, positionId, borrowResult, loanDurationSeconds, numberOfInstallments) {
  logSection('Step 6: Sync Loan with Backend');
  logInfo('Notifying backend of loan borrow...');

  try {
    const response = await fetch(`${BACKEND_URL}/solvency/loan/borrow-notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        txHash: borrowResult.txHash,
        positionId: positionId.toString(),
        borrowAmount: borrowResult.borrowed.toString(),
        loanDuration: loanDurationSeconds.toString(),
        numberOfInstallments: numberOfInstallments.toString(),
        blockNumber: borrowResult.blockNumber.toString(),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Backend notification failed');
    }

    const result = await response.json();
    logSuccess('Backend synced successfully');
    logInfo(`Position updated in database`);

    return result;
  } catch (error) {
    logError(`Failed to notify backend: ${error.message}`);
    logWarning('Loan exists on-chain but not synced with backend!');
    logWarning('The backend may not show correct loan details.');
    throw error;
  }
}

async function main() {
  logSection('Borrow Solvency Loan (Asset-Based Maturity)');

  console.log('\n📝 Configuration:');
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Position ID: ${positionId}`);
  console.log(`  Amount: $${borrowAmount} USDC`);
  console.log(`  Installments: ${numberOfInstallments}`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(INVESTOR_KEY, provider);

  logInfo(`Investor Address: ${wallet.address}`);

  // Authenticate
  logSection('Step 1: Authenticate');
  const jwt = await getJWTToken(wallet);

  // Get Position
  const position = await fetchPosition(jwt, positionId);

  // Find Asset & Calculate Duration
  const asset = await findAssetByToken(jwt, position.collateralTokenAddress);
  const dueDate = new Date(asset.metadata.dueDate);
  const now = new Date();

  logInfo(`Asset Due Date: ${dueDate.toLocaleString()}`);
  logInfo(`Current Date:   ${now.toLocaleString()}`);

  if (dueDate <= now) {
    logError('Asset has already matured or is past due date! Cannot borrow against it.');
    process.exit(1);
  }

  const durationMs = dueDate.getTime() - now.getTime();
  const durationSeconds = Math.floor(durationMs / 1000);
  const durationDays = (durationSeconds / 86400).toFixed(2);

  logSection('Step 4: Loan Terms Calculation');
  logInfo(`Calculated Duration: ${durationSeconds} seconds (~${durationDays} days)`);
  logInfo(`Installments: ${numberOfInstallments}`);
  
  const intervalSeconds = Math.floor(durationSeconds / numberOfInstallments);
  const intervalDays = (intervalSeconds / 86400).toFixed(2);
  logInfo(`Payment Interval: Every ~${intervalDays} days`);

  if (intervalSeconds < 86400) {
    logWarning('Warning: Payment interval is less than 1 day!');
  }

  // Connect to contract
  const solvencyVaultAddress = contracts.SolvencyVault;
  const solvencyVaultContract = new ethers.Contract(solvencyVaultAddress, SOLVENCY_VAULT_ABI, wallet);

  // Borrow
  const borrowAmountWei = ethers.parseUnits(borrowAmount, 6); // USDC 6 decimals
  const borrowResult = await borrowUSDC(
    solvencyVaultContract,
    positionId,
    borrowAmountWei,
    durationSeconds,
    numberOfInstallments
  );

  // Sync with backend
  await notifyBackendOfBorrow(
    jwt,
    positionId,
    borrowResult,
    durationSeconds,
    numberOfInstallments
  );

  logSection('✨ Complete!');
  logSuccess(`Loan initiated for Position #${positionId}`);
  logSuccess(`Maturity Date locked to Asset Due Date: ${dueDate.toLocaleDateString()}`);
  logSuccess('Loan details synced with backend database');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n' + '='.repeat(60));
    logError('Script failed:');
    console.error(error);
    console.error('='.repeat(60));
    process.exit(1);
  });
