#!/usr/bin/env node

/**
 * Admin: Purchase and Settle Liquidation (Private Asset / Manual)
 * Admin buys the collateral tokens with USDC and settles the liquidation
 */

import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const deployedContracts = JSON.parse(
  readFileSync('./packages/contracts/deployed_contracts.json', 'utf-8')
);

const SOLVENCY_VAULT_ABI = [
  'function purchaseAndSettleLiquidation(uint256 positionId, uint256 purchaseAmount) external returns (uint256 debtRepaid, uint256 userRefund)',
  'function positions(uint256) view returns (address user, address collateralToken, uint256 collateralAmount, uint256 tokenValueUSD, uint256 usdcBorrowed, bool active, uint256 creditLineId, uint8 tokenType)',
  'function positionsInLiquidation(uint256) view returns (bool)',
  'function repaymentPlans(uint256) view returns (uint256 loanDuration, uint256 numberOfInstallments, uint256 installmentInterval, uint256 nextPaymentDue, uint256 installmentsPaid, uint256 missedPayments, bool isActive, bool defaulted)',
  'function seniorPool() view returns (address)',
];

const SENIOR_POOL_ABI = [
  'function getOutstandingDebt(uint256) view returns (uint256)',
];

const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function mint(address to, uint256 amount) external',
];

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
];

async function purchaseLiquidation() {
  console.log('');
  console.log('='.repeat(60));
  console.log('Admin: Purchase and Settle Liquidation');
  console.log('='.repeat(60));
  console.log('');

  // Configuration
  const positionId = process.argv[2];
  const purchaseAmountUSD = process.argv[3]; // Optional - if not provided, uses token value
  const adminPrivateKey = process.env.ADMIN_KEY || '0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305';
  const rpcUrl = 'https://rpc.sepolia.mantle.xyz';

  if (!positionId) {
    console.log('❌ Usage: node admin-purchase-liquidation.js <position_id> [purchase_amount_usd]');
    console.log('   or: ADMIN_KEY=0x... node admin-purchase-liquidation.js <position_id> [purchase_amount_usd]');
    console.log('');
    console.log('Parameters:');
    console.log('  position_id         : Position ID to settle');
    console.log('  purchase_amount_usd : (Optional) Amount in USD to pay. If not specified, uses tokenValueUSD');
    process.exit(1);
  }

  console.log('📝 Configuration:');
  console.log('  RPC URL:', rpcUrl);
  console.log('  Position ID:', positionId);
  console.log('  Solvency Vault:', deployedContracts.contracts.SolvencyVault);

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(adminPrivateKey, provider);
  
  console.log('ℹ️  Admin Address:', wallet.address);
  console.log('');

  const solvencyVault = new ethers.Contract(
    deployedContracts.contracts.SolvencyVault,
    SOLVENCY_VAULT_ABI,
    wallet
  );

  const usdc = new ethers.Contract(
    deployedContracts.contracts.USDC,
    USDC_ABI,
    wallet
  );

  // Check position status
  console.log('='.repeat(60));
  console.log('Position Status Check');
  console.log('='.repeat(60));
  
  const position = await solvencyVault.positions(positionId);
  const plan = await solvencyVault.repaymentPlans(positionId);
  const inLiquidation = await solvencyVault.positionsInLiquidation(positionId);

  const token = new ethers.Contract(position.collateralToken, ERC20_ABI, provider);
  const symbol = await token.symbol();
  const vaultBalance = await token.balanceOf(deployedContracts.contracts.SolvencyVault);

  // Get actual outstanding debt from SeniorPool
  const seniorPoolAddress = await solvencyVault.seniorPool();
  const seniorPool = new ethers.Contract(seniorPoolAddress, SENIOR_POOL_ABI, provider);
  const outstandingDebt = await seniorPool.getOutstandingDebt(positionId);

  console.log('📊 Position:', positionId);
  console.log('  User:', position.user);
  console.log('  Collateral Token:', position.collateralToken, `(${symbol})`);
  console.log('  Collateral Amount:', ethers.formatEther(position.collateralAmount), symbol);
  console.log('  Collateral Value:', `$${ethers.formatUnits(position.tokenValueUSD, 6)}`);
  console.log('  Outstanding Debt:', `$${ethers.formatUnits(outstandingDebt, 6)}`);
  console.log('  Token Type:', position.tokenType === 0n ? 'RWA' : 'PRIVATE_ASSET');
  console.log('  Active:', position.active);
  console.log('  In Liquidation:', inLiquidation);
  console.log('  Missed Payments:', plan.missedPayments.toString());
  console.log('  Vault Balance:', ethers.formatEther(vaultBalance), symbol);
  console.log('');

  if (!inLiquidation) {
    console.log('❌ Position is not in liquidation!');
    console.log('   Run: node admin-liquidate-position.js', positionId);
    process.exit(1);
  }

  // Determine purchase amount
  let purchaseAmountWei;
  if (purchaseAmountUSD) {
    purchaseAmountWei = ethers.parseUnits(purchaseAmountUSD, 6);
    console.log('💰 Purchase Amount (specified):', `$${purchaseAmountUSD}`);
  } else {
    // Default to collateral value (what was originally valued at)
    // Admin pays the collateral value to acquire the tokens
    purchaseAmountWei = position.tokenValueUSD;
    console.log('💰 Purchase Amount (collateral value):', `$${ethers.formatUnits(purchaseAmountWei, 6)}`);
  }
  
  console.log('');
  console.log('💡 Note: Admin purchases collateral at its value.');
  console.log('   Debt of $' + ethers.formatUnits(outstandingDebt, 6) + ' will be repaid.');
  console.log('   Any excess goes back to the user.');
  console.log('');

  // Check if admin needs to mint USDC
  const adminBalance = await usdc.balanceOf(wallet.address);
  console.log('');
  console.log('Admin USDC Balance:', ethers.formatUnits(adminBalance, 6), 'USDC');
  
  if (adminBalance < purchaseAmountWei) {
    const needed = purchaseAmountWei - adminBalance;
    console.log('⚠️  Insufficient USDC! Need:', ethers.formatUnits(needed, 6), 'more USDC');
    console.log('ℹ️  Minting USDC...');
    
    const mintTx = await usdc.mint(wallet.address, needed);
    await mintTx.wait();
    console.log('✅ Minted', ethers.formatUnits(needed, 6), 'USDC');
  }

  // Check allowance
  const allowance = await usdc.allowance(wallet.address, deployedContracts.contracts.SolvencyVault);
  if (allowance < purchaseAmountWei) {
    console.log('ℹ️  Approving SolvencyVault to spend USDC...');
    const approveTx = await usdc.approve(deployedContracts.contracts.SolvencyVault, purchaseAmountWei);
    await approveTx.wait();
    console.log('✅ Approved');
  }
  console.log('');

  // Purchase and settle
  console.log('='.repeat(60));
  console.log('Purchasing Collateral and Settling');
  console.log('='.repeat(60));
  console.log('');
  console.log('ℹ️  This will:');
  console.log('  1. Admin pays', ethers.formatUnits(purchaseAmountWei, 6), 'USDC');
  console.log('  2. Admin receives', ethers.formatEther(position.collateralAmount), symbol, 'tokens');
  console.log('  3. Debt of $' + ethers.formatUnits(outstandingDebt, 6), 'repaid to SeniorPool');
  console.log('  4. Remaining USDC ($' + ethers.formatUnits(purchaseAmountWei - outstandingDebt, 6) + ') returned to user');
  console.log('');
  console.log('ℹ️  Calling purchaseAndSettleLiquidation(' + positionId + ', ' + ethers.formatUnits(purchaseAmountWei, 6) + ')...');
  
  try {
    const tx = await solvencyVault.purchaseAndSettleLiquidation(positionId, purchaseAmountWei);
    console.log('ℹ️  Transaction submitted:', tx.hash);
    console.log('ℹ️  Waiting for confirmation...');
    
    const receipt = await tx.wait();
    console.log('✅ Transaction confirmed in block', receipt.blockNumber);
    console.log('✅ Liquidation SETTLED!');
    console.log('');
    console.log('🔗 Explorer:', `https://explorer.sepolia.mantle.xyz/tx/${tx.hash}`);
    console.log('');

    // Check token balance
    const adminTokenBalance = await token.balanceOf(wallet.address);
    console.log('='.repeat(60));
    console.log('✨ Complete!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📊 Final Status:');
    console.log('  ✓ Collateral purchased by admin');
    console.log('  ✓ Admin now has:', ethers.formatEther(adminTokenBalance), symbol);
    console.log('  ✓ Debt repaid to SeniorPool');
    console.log('  ✓ Remaining USDC returned to user');
    console.log('  ✓ Position closed');
  } catch (error) {
    console.log('');
    console.log('❌ Purchase failed!');
    console.log('');
    console.log('Error:', error.message);
    console.log('');
    console.log('💡 Common issues:');
    console.log('  1. Position not in liquidation');
    console.log('  2. Insufficient USDC balance');
    console.log('  3. Position already settled');
    console.log('');
    throw error;
  }
}

purchaseLiquidation().catch(console.error);
