#!/usr/bin/env node

/**
 * Buy RWA Tokens with Leverage (mETH Collateral)
 *
 * Usage:
 *   INVESTOR_KEY=0x... node scripts/buy-leverage-meth.js <asset_id> <token_amount>
 *
 * Example:
 *   INVESTOR_KEY=0x1234... node scripts/buy-leverage-meth.js 1aa1e321-f783-4504-ad19-676a397057d7 100
 *
 * This script will:
 * 1. Request mETH from faucet (10 mETH)
 * 2. Approve mETH spending for LeverageVault
 * 3. Initiate leveraged position via backend API
 * 4. Monitor position health
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
  console.log('  INVESTOR_KEY=0x... node scripts/buy-leverage-meth.js <asset_id> <token_amount>');
  console.log('\nExample:');
  console.log('  INVESTOR_KEY=0x1234... node scripts/buy-leverage-meth.js 1aa1e321-f783-4504-ad19-676a397057d7 100');
  process.exit(1);
}

const assetId = process.argv[2];
const tokenAmount = process.argv[3];

if (!assetId || !tokenAmount) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/buy-leverage-meth.js <asset_id> <token_amount>');
  console.log('\nExample:');
  console.log('  INVESTOR_KEY=0x1234... node scripts/buy-leverage-meth.js 1aa1e321-f783-4504-ad19-676a397057d7 100');
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

// ABI fragments
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

async function requestMethFromFaucet(receiverAddress) {
  logSection('Step 1: Request mETH from Faucet');

  try {
    const response = await fetch(`${BACKEND_URL}/faucet/meth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverAddress }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Faucet request failed');
    }

    const result = await response.json();
    logSuccess(`Received ${result.amount} mETH`);
    logInfo(`Transaction: ${result.explorerUrl}`);

    // Wait for transaction confirmation
    logInfo('Waiting for transaction confirmation...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    return result;
  } catch (error) {
    logError(`Faucet request failed: ${error.message}`);
    throw error;
  }
}

async function checkMethBalance(wallet, mockMETH) {
  const balance = await mockMETH.balanceOf(wallet.address);
  const balanceFormatted = ethers.formatEther(balance);
  logInfo(`Current mETH balance: ${balanceFormatted} mETH`);
  return balance;
}

async function approveMeth(wallet, mockMETH, spender, amount) {
  logSection('Step 2: Approve mETH Spending');

  // Check current allowance
  const currentAllowance = await mockMETH.allowance(wallet.address, spender);
  logInfo(`Current allowance: ${ethers.formatEther(currentAllowance)} mETH`);

  if (currentAllowance >= amount) {
    logSuccess('Sufficient allowance already granted');
    return;
  }

  logInfo(`Approving ${ethers.formatEther(amount)} mETH for LeverageVault...`);
  const tx = await mockMETH.approve(spender, amount);
  logInfo(`Approval transaction: ${tx.hash}`);

  await tx.wait();
  logSuccess('mETH approved successfully');
}

async function getAssetDetails(assetId, jwt) {
  try {
    const response = await fetch(`${BACKEND_URL}/assets/${assetId}`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (!response.ok) {
      throw new Error('Asset not found');
    }

    return await response.json();
  } catch (error) {
    logWarning(`Could not fetch asset details: ${error.message}`);
    return null;
  }
}

async function getMethPrice(jwt) {
  try {
    const response = await fetch(`${BACKEND_URL}/leverage/meth-price`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (response.ok) {
      const data = await response.json();
      // API returns price as string in USDC wei (6 decimals)
      // e.g., "2856450000" = $2856.45
      return data.price;
    }
  } catch (error) {
    logWarning('Could not fetch mETH price');
  }
  return '3000000000'; // Default $3000 in USDC wei (6 decimals)
}

async function initiateLeveragePurchase(assetId, tokenAddress, tokenAmount, pricePerToken, mETHCollateral, jwt) {
  logSection('Step 3: Initiate Leveraged Purchase');

  logInfo('Purchase Details:');
  console.log(`  Asset ID: ${assetId}`);
  console.log(`  Token Address: ${tokenAddress}`);
  console.log(`  Token Amount: ${ethers.formatEther(tokenAmount)} tokens`);
  console.log(`  Price per Token: ${pricePerToken / 1e6} USDC`);
  console.log(`  mETH Collateral: ${ethers.formatEther(mETHCollateral)} mETH`);

  const purchaseData = {
    assetId,
    tokenAddress,
    tokenAmount: tokenAmount.toString(),
    pricePerToken: pricePerToken.toString(),
    mETHCollateral: mETHCollateral.toString(),
  };

  try {
    const response = await fetch(`${BACKEND_URL}/leverage/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify(purchaseData),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Purchase failed');
    }

    const result = await response.json();
    logSuccess(`Position created! Position ID: ${result.positionId}`);
    logInfo(`Transaction: https://explorer.sepolia.mantle.xyz/tx/${result.transactionHash}`);

    return result;
  } catch (error) {
    logError(`Leverage purchase failed: ${error.message}`);
    throw error;
  }
}

async function getJWTToken(wallet) {
  try {
    // Step 1: Request challenge
    logInfo('Requesting authentication challenge...');
    const challengeResponse = await fetch(
      `${BACKEND_URL}/auth/challenge?walletAddress=${wallet.address}&role=INVESTOR`
    );

    if (!challengeResponse.ok) {
      const errorData = await challengeResponse.json();
      throw new Error(`Failed to get challenge: ${JSON.stringify(errorData)}`);
    }

    const challengeData = await challengeResponse.json();
    logInfo(`Challenge received: ${challengeData.message.substring(0, 50)}...`);

    // Step 2: Sign the challenge message
    logInfo('Signing challenge message...');
    const signature = await wallet.signMessage(challengeData.message);

    // Step 3: Login with signature
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

    return loginData.tokens.access;
  } catch (error) {
    logError(`Authentication failed: ${error.message}`);
    return null;
  }
}

async function monitorPosition(positionId, jwt) {
  logSection('Position Monitoring');

  if (!jwt) {
    logWarning('Skipping position monitoring (no JWT token)');
    return;
  }

  try {
    const response = await fetch(`${BACKEND_URL}/leverage/position/${positionId}`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (!response.ok) {
      throw new Error('Could not fetch position');
    }

    const data = await response.json();
    const position = data.position;

    console.log('\n📊 Position Details:');
    console.log(`  Position ID: ${position.positionId}`);
    console.log(`  Status: ${position.status}`);
    console.log(`  Health Factor: ${(position.currentHealthFactor / 100).toFixed(2)}%`);
    console.log(`  Health Status: ${position.healthStatus}`);
    console.log(`  mETH Collateral: ${ethers.formatEther(position.mETHCollateral)} mETH`);
    console.log(`  USDC Borrowed: ${position.usdcBorrowed / 1e6} USDC`);
    console.log(`  Outstanding Debt: ${data.outstandingDebt / 1e6} USDC`);

    if (position.healthStatus === 'CRITICAL') {
      logError('⚠️  WARNING: Position health is CRITICAL!');
    } else if (position.healthStatus === 'WARNING') {
      logWarning('Position health is in WARNING state');
    } else {
      logSuccess('Position health is HEALTHY');
    }
  } catch (error) {
    logWarning(`Could not monitor position: ${error.message}`);
  }
}

async function main() {
  logSection('RWA Token Purchase with Leverage (mETH Collateral)');

  console.log('\n📝 Configuration:');
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Asset ID: ${assetId}`);
  console.log(`  Token Amount: ${tokenAmount} tokens`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(INVESTOR_KEY, provider);

  logInfo(`Investor Address: ${wallet.address}`);

  // Get JWT token (optional, for authenticated endpoints)
  let jwt = null;
  try {
    jwt = await getJWTToken(wallet);
    if (jwt) {
      logSuccess('Authenticated successfully');
    }
  } catch (error) {
    logWarning('Continuing without authentication');
  }

  // Connect to contracts
  const mockMETH = new ethers.Contract(contracts.MockMETH, ERC20_ABI, wallet);

  // Check initial balance
  let balance = await checkMethBalance(wallet, mockMETH);

  // Calculate required mETH (assuming 150% LTV)
  const tokenAmountWei = ethers.parseEther(tokenAmount);
  const pricePerToken = 850000; // $0.80 in USDC (6 decimals)
  const totalCostUSDC = (tokenAmountWei * BigInt(pricePerToken)) / ethers.parseEther('1');

  logInfo(`Total cost: ${totalCostUSDC / BigInt(1e6)} USDC`);

  // Get current mETH price (returns USDC wei, 6 decimals)
  const methPriceUSDCWei = jwt ? await getMethPrice(jwt) : '3000000000'; // Default $3000 in USDC wei
  const methPriceUSD = Number(methPriceUSDCWei) / 1e6;
  logInfo(`Current mETH price: $${methPriceUSD.toFixed(2)}`);

  // Calculate required mETH collateral (150% LTV)
  const requiredUSDC = (totalCostUSDC * BigInt(150) ) / BigInt(100); // 150% LTV +1 usdc rounding
  // methPrice is in USDC wei (6 decimals), requiredUSDC is in USDC wei (6 decimals)₹
  // Formula: (requiredUSDC * 1e18) / methPrice = mETH (18 decimals)
  // Add 0.1% buffer to account for rounding errors
  const requiredMETHBase = (requiredUSDC * ethers.parseEther('1')) / BigInt(methPriceUSDCWei);
  const requiredMETH = (requiredMETHBase * BigInt(1001)) / BigInt(1000); // Add 0.1% buffer

  logInfo(`Required mETH collateral (150% LTV): ${ethers.formatEther(requiredMETH)} mETH`);

  // Request mETH if balance is insufficient
  if (balance < requiredMETH) {
    logWarning(`Insufficient mETH balance. Requesting from faucet...`);
    await requestMethFromFaucet(wallet.address);
    balance = await checkMethBalance(wallet, mockMETH);

    if (balance < requiredMETH) {
      logError(`Still insufficient mETH. Need ${ethers.formatEther(requiredMETH - balance)} more mETH`);
      logInfo('You may need to request from faucet multiple times or adjust token amount');
      process.exit(1);
    }
  } else {
    logSuccess('Sufficient mETH balance');
  }

  // Approve mETH spending
  await approveMeth(wallet, mockMETH, contracts.LeverageVault, requiredMETH);

  // Get asset details
  let tokenAddress = contracts.MockMETH; // Fallback
  if (jwt) {
    const asset = await getAssetDetails(assetId, jwt);
    if (asset && asset.tokenParams && asset.tokenParams.tokenAddress) {
      tokenAddress = asset.tokenParams.tokenAddress;
      logInfo(`Found RWA token address: ${tokenAddress}`);
    }
  }

  // Initiate leverage purchase
  const result = await initiateLeveragePurchase(
    assetId,
    tokenAddress,
    tokenAmountWei,
    pricePerToken,
    requiredMETH,
    jwt
  );

  // Monitor position
  if (result.positionId) {
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for position to be indexed
    await monitorPosition(result.positionId, jwt);
  }

  logSection('✨ Purchase Complete!');
  logSuccess(`Position ID: ${result.positionId}`);
  logInfo('Monitor your position at: ' + `${BACKEND_URL}/leverage/position/${result.positionId}`);

  console.log('\n📋 Next Steps:');
  console.log('  1. Monitor position health regularly');
  console.log('  2. Yield will be harvested automatically');
  console.log('  3. Watch for liquidation warnings');
  console.log('  4. Position can be unwound when asset matures');
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
