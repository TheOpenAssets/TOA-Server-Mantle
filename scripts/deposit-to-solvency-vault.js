#!/usr/bin/env node

/**
 * Deposit RWA Tokens to Solvency Vault & Borrow USDC
 *
 * Usage:
 *   INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js <asset_id> <deposit_amount>
 *
 * Example:
 *   INVESTOR_KEY=0x1234... node scripts/deposit-to-solvency-vault.js 4c81f5c6... 90
 *
 * This script will:
 * 1. Authenticate with backend
 * 2. Fetch asset details (token address, price) from backend using asset ID
 * 3. Check RWA token balance
 * 4. Approve SolvencyVault to spend tokens
 * 5. Deposit tokens as collateral (investor signs transaction directly)
 * 6. Sync position with backend database (MANDATORY)
 * 7. Display position summary
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
  console.log('  INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js <asset_id> <deposit_amount>');
  console.log('\nExample:');
  console.log('  INVESTOR_KEY=0x1234... node scripts/deposit-to-solvency-vault.js 4c81f5c6... 90');
  process.exit(1);
}

const assetId = process.argv[2];
const depositAmount = process.argv[3];

if (!assetId || !depositAmount) {
  logError('Missing required arguments');
  console.log('\nUsage:');
  console.log('  INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js <asset_id> <deposit_amount>');
  console.log('\nExample:');
  console.log('  INVESTOR_KEY=0x1234... node scripts/deposit-to-solvency-vault.js 4c81f5c6... 90');
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
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const SOLVENCY_VAULT_ABI = [
  'function depositCollateral(address collateralToken, uint256 collateralAmount, uint256 tokenValueUSD, uint8 tokenType, bool issueOAID) external returns (uint256 positionId)',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 usdcBorrowed, uint256 tokenValueUSD, uint256 createdAt, bool active, uint8 tokenType)',
  'event PositionCreated(uint256 indexed positionId, address indexed user, address collateralToken, uint256 collateralAmount, uint256 tokenValueUSD, uint8 tokenType)',
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

async function checkTokenBalance(wallet, tokenContract) {
  const balance = await tokenContract.balanceOf(wallet.address);
  const decimals = await tokenContract.decimals();
  const symbol = await tokenContract.symbol();
  const balanceFormatted = ethers.formatUnits(balance, decimals);

  logInfo(`Your RWA Token Balance: ${balanceFormatted} ${symbol}`);

  return { balance, decimals, symbol };
}

async function approveToken(wallet, tokenContract, spender, amount, symbol) {
  logSection('Approve SolvencyVault to Spend Tokens');

  const currentAllowance = await tokenContract.allowance(wallet.address, spender);
  logInfo(`Current allowance: ${ethers.formatUnits(currentAllowance, 18)} ${symbol}`);

  if (currentAllowance >= amount) {
    logSuccess('Sufficient allowance already granted');
    return;
  }

  logInfo(`Approving ${ethers.formatUnits(amount, 18)} ${symbol} for SolvencyVault...`);
  const tx = await tokenContract.approve(spender, amount);
  logInfo(`Approval transaction: ${tx.hash}`);

  await tx.wait();
  logSuccess('Tokens approved successfully');
}

async function depositCollateral(wallet, solvencyVaultContract, tokenAddr, amount, tokenValueUSD, issueOAID = false) {
  logSection('Deposit Collateral to SolvencyVault');

  logInfo(`Depositing ${ethers.formatUnits(amount, 18)} RWA tokens...`);
  logInfo(`Token value: $${ethers.formatUnits(tokenValueUSD, 6)} USD`);
  logInfo(`Issue OAID: ${issueOAID}`);

  try {
    // Call depositCollateral on SolvencyVault (investor signs the transaction directly)
    // TokenType: 0 = RWA, 1 = PRIVATE_ASSET
    const tx = await solvencyVaultContract.depositCollateral(
      tokenAddr,
      amount,
      tokenValueUSD,
      0, // RWA token type
      issueOAID
    );

    logInfo(`Transaction submitted: ${tx.hash}`);
    logInfo('Waiting for confirmation (this may take up to 5 minutes)...');

    const receipt = await tx.wait();
    logSuccess(`Deposit confirmed in block ${receipt.blockNumber}`);

    // Parse PositionCreated event
    let positionId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = solvencyVaultContract.interface.parseLog(log);
        if (parsed.name === 'PositionCreated') {
          positionId = parsed.args.positionId.toString();
          logSuccess(`Position created with ID: ${positionId}`);
          break;
        }
      } catch (e) {
        // Skip non-matching logs
      }
    }

    if (!positionId) {
      throw new Error('Could not parse position ID from transaction');
    }

    logInfo(`Explorer: https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);

    return {
      positionId,
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      tokenValueUSD,
    };
  } catch (error) {
    logError(`Deposit failed: ${error.message}`);
    throw error;
  }
}

async function getPositionOnChain(solvencyVaultContract, positionId) {
  try {
    const position = await solvencyVaultContract.positions(positionId);

    return {
      user: position.user,
      collateralToken: position.collateralToken,
      collateralAmount: position.collateralAmount,
      usdcBorrowed: position.usdcBorrowed,
      tokenValueUSD: position.tokenValueUSD,
      createdAt: position.createdAt,
      active: position.active,
      tokenType: position.tokenType,
    };
  } catch (error) {
    logWarning(`Could not fetch position from chain: ${error.message}`);
    return null;
  }
}

async function syncPositionWithBackend(positionId, depositData, jwt) {
  logSection('Sync Position with Backend');
  logInfo('Syncing position with backend database...');

  try {
    // Backend sync endpoint - creates DB record for the on-chain position
    const response = await fetch(`${BACKEND_URL}/solvency/sync-position`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        positionId: positionId.toString(),
        txHash: depositData.txHash,
        blockNumber: depositData.blockNumber,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Backend sync failed');
    }

    const result = await response.json();
    logSuccess('Position synced with backend database');
    logInfo(`Backend Position ID: ${result.position?.id || positionId}`);

    return result;
  } catch (error) {
    logError(`Failed to sync with backend: ${error.message}`);
    logWarning('Position exists on-chain but not in backend database!');
    logWarning('You may need to manually sync this position later.');
    throw error;
  }
}

async function fetchOAIDCredit(jwt) {
  logSection('Fetch OAID Credit Details');
  logInfo('Fetching your OAID credit lines from backend...');

  try {
    const response = await fetch(`${BACKEND_URL}/solvency/oaid/my-credit`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Failed to fetch credit details');
    }

    const data = await response.json();
    
    logSuccess('OAID credit details retrieved');
    console.log('\n' + '═'.repeat(60));
    log('OAID Credit Summary', colors.bright + colors.blue);
    console.log(`  Total Credit Limit: $${ethers.formatUnits(data.totalCreditLimit, 6)} USDC`);
    console.log(`  Total Credit Used:  $${ethers.formatUnits(data.totalCreditUsed, 6)} USDC`);
    console.log(`  Available Credit:   $${ethers.formatUnits(data.totalAvailableCredit, 6)} USDC`);
    console.log(`  Utilization Rate:   ${data.summary.utilizationRate}`);
    console.log(`  Active Credit Lines: ${data.summary.activeCreditLines} / ${data.summary.totalCreditLines}`);
    console.log('═'.repeat(60));

    if (data.creditLines && data.creditLines.length > 0) {
      console.log('\nActive Credit Lines:');
      data.creditLines.forEach((line, index) => {
        if (line.active) {
          console.log(`  ${index + 1}. Position #${line.solvencyPositionId}: $${ethers.formatUnits(line.creditLimit, 6)} limit`);
        }
      });
    }

    return data;
  } catch (error) {
    logError(`Failed to fetch credit details: ${error.message}`);
    return null;
  }
}

async function main() {
  logSection('Deposit to Solvency Vault');

  console.log('\n📝 Configuration:');
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  Asset ID: ${assetId}`);
  console.log(`  Deposit Amount: ${depositAmount} tokens`);

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(INVESTOR_KEY, provider);

  logInfo(`Investor Address: ${wallet.address}`);

  // Authenticate
  logSection('Step 1: Authenticate with Backend');
  const jwt = await getJWTToken(wallet);

  // Fetch asset details from backend
  logSection('Step 2: Fetch Asset Details');
  logInfo(`Fetching asset details for ${assetId}...`);

  let assetData;
  try {
    const assetResponse = await fetch(`${BACKEND_URL}/assets/${assetId}`, {
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    // console.log(await assetResponse.json())

    if (!assetResponse.ok) {
      const error = await assetResponse.json();
      throw new Error(error.message || 'Failed to fetch asset');
    }

    assetData = await assetResponse.json();

    if (!assetData.token.address) {
      throw new Error('Asset does not have a deployed token yet');
    }

    if (!assetData.listing?.price) {
      throw new Error('Asset does not have a price per token');
    }

    logSuccess('Asset details retrieved');
    logInfo(`Token Address: ${assetData.token.address}`);
    logInfo(`Price per Token: $${(assetData.listing.price / 1e6).toFixed(6)}`);
  } catch (error) {
    logError(`Failed to fetch asset: ${error.message}`);
    throw error;
  }

  const tokenAddress = assetData.token.address;
  const pricePerToken = parseInt(assetData.listing.price); // Price in 6 decimals (USDC format)
  const solvencyVaultAddress = contracts.SolvencyVault;

  // Connect to contracts
  logSection('Step 3: Connect to Contracts');
  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
  const solvencyVaultContract = new ethers.Contract(solvencyVaultAddress, SOLVENCY_VAULT_ABI, wallet);

  logInfo(`Token Contract: ${tokenAddress}`);
  logInfo(`SolvencyVault Contract: ${solvencyVaultAddress}`);

  // Check token balance
  logSection('Step 4: Check Token Balance');
  const { balance, decimals, symbol } = await checkTokenBalance(wallet, tokenContract);

  const depositAmountWei = ethers.parseUnits(depositAmount, decimals);

  if (balance < depositAmountWei) {
    logError(`Insufficient balance! You have ${ethers.formatUnits(balance, decimals)} ${symbol} but trying to deposit ${depositAmount}`);
    process.exit(1);
  }

  logSuccess(`Sufficient balance confirmed: ${ethers.formatUnits(balance, decimals)} ${symbol}`);

  // Approve tokens
  await approveToken(wallet, tokenContract, solvencyVaultAddress, depositAmountWei, symbol);

  // Calculate token value in USD using fetched price
  // Price is in 6 decimals (USDC format), amount is in 18 decimals
  const tokenValueUSD = (depositAmountWei * BigInt(pricePerToken)) / ethers.parseEther('1');

  logSection('Step 5: Calculate Collateral Value');
  logInfo(`Deposit Amount: ${depositAmount} ${symbol}`);
  logInfo(`Token Price: $${(pricePerToken / 1e6).toFixed(6)} per token`);
  logInfo(`Total Collateral Value: $${ethers.formatUnits(tokenValueUSD, 6)} USD`);

  // Deposit collateral (investor signs transaction directly)
  logSection('Step 6: Deposit Collateral');
  const depositResult = await depositCollateral(
    wallet,
    solvencyVaultContract,
    tokenAddress,
    depositAmountWei,
    tokenValueUSD,
    true // Issue OAID credit line
  );

  // Sync with backend (MANDATORY)
  await syncPositionWithBackend(depositResult.positionId, depositResult, jwt);

  // Get final position details from chain
  logSection('Final Position Summary');
  const position = await getPositionOnChain(solvencyVaultContract, depositResult.positionId);

  if (position) {
    console.log('\n' + '═'.repeat(60));
    console.log(`Position ID: ${depositResult.positionId}`);
    console.log(`Status: ${position.active ? 'ACTIVE' : 'CLOSED'}`);
    console.log(`Collateral: ${ethers.formatUnits(position.collateralAmount, decimals)} ${symbol}`);
    console.log(`Collateral Value: $${ethers.formatUnits(position.tokenValueUSD, 6)} USD`);
    console.log(`Debt: $${ethers.formatUnits(position.usdcBorrowed, 6)} USDC`);
    console.log(`Token Type: ${position.tokenType === 0 ? 'RWA' : 'PRIVATE_ASSET'}`);
    console.log('═'.repeat(60));
  }

  // Fetch and show OAID credit details
  await fetchOAIDCredit(jwt);

  logSection('✨ Complete!');
  logSuccess(`Position ID: ${depositResult.positionId}`);
  logSuccess(`Deposited: ${depositAmount} ${symbol}`);

  console.log('\n📋 Next Steps:');
  console.log('  • To borrow against this collateral, run:');
  console.log(`    node scripts/borrow-solvency-loan.js ${depositResult.positionId} <amount> <installments>`);
  console.log('');
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
