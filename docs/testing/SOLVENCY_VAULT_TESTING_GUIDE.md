# Solvency Vault (OAID) - Testing Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Environment Setup](#environment-setup)
3. [Test Scenarios](#test-scenarios)
4. [Admin Operations](#admin-operations)
5. [Edge Cases](#edge-cases)
6. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Tools
- Node.js v18+
- Hardhat for contract deployment
- MongoDB for backend storage
- Postman or curl for API testing
- MetaMask or similar wallet for frontend testing

### Required Wallets
Ensure you have the following wallets configured in `.env`:

```bash
# Platform wallets
ADMIN_PRIVATE_KEY=0x...                    # Admin operations
PLATFORM_PRIVATE_KEY=0x...                 # Platform operations
CUSTODY_WALLET_ADDRESS=0x...               # Token custody

# Test users
TEST_USER_1_PRIVATE_KEY=0x...              # Regular user
TEST_USER_2_PRIVATE_KEY=0x...              # Second user for multi-user tests
```

### Contract Addresses
Verify these are deployed and configured:

```bash
SOLVENCY_VAULT_ADDRESS=0x...
OAID_ADDRESS=0x...
SENIOR_POOL_ADDRESS=0x...
PRIMARY_MARKETPLACE_ADDRESS=0x...
TOKEN_FACTORY_ADDRESS=0x...
```

---

## Environment Setup

### 1. Deploy Contracts

```bash
cd packages/contracts

# Deploy SolvencyVault
npx hardhat run scripts/deploy/deploy-solvency-vault.ts --network mantleSepolia

# Deploy OAID (optional)
npx hardhat run scripts/deploy/deploy-oaid.ts --network mantleSepolia

# Update deployed_contracts.json with new addresses
```

### 2. Configure SeniorPool

```bash
# Allow SolvencyVault to borrow from SeniorPool
npx hardhat run scripts/config/authorize-solvency-vault.ts --network mantleSepolia
```

Expected output:
```
✅ SolvencyVault authorized to borrow from SeniorPool
Vault address: 0x...
Transaction: 0x...
```

### 3. Configure PrimaryMarket

```bash
# Allow SolvencyVault to create listings for liquidations
npx hardhat run scripts/config/authorize-vault-for-marketplace.ts --network mantleSepolia
```

Expected output:
```
✅ SolvencyVault authorized to create marketplace listings
Vault address: 0x...
Transaction: 0x...
```

### 4. Start Backend

```bash
cd packages/backend

# Install dependencies
npm install

# Start server
npm run start:dev
```

Verify server is running:
```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2026-01-04T12:00:00.000Z"
}
```

### 5. Prepare Test Tokens

#### Deploy RWA Test Token
```bash
cd packages/contracts

npx hardhat run scripts/deploy/deploy-test-rwa-token.ts --network mantleSepolia
```

Save the token address for testing.

#### Mint Private Asset Token (Admin)
```bash
curl -X POST http://localhost:3000/admin/solvency/private-asset/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -d '{
    "name": "Test Property Deed",
    "symbol": "DEED-TEST",
    "totalSupply": "1000000000000000000",
    "assetType": "DEED",
    "location": "Test Location",
    "valuation": "100000000000",
    "documentHash": "QmTestHash123",
    "issuer": "0xIssuerAddress"
  }'
```

Expected response:
```json
{
  "success": true,
  "assetId": "0x7d5a99...",
  "tokenAddress": "0x9fE467...",
  "transaction": {
    "hash": "0xabc123...",
    "blockNumber": 12345678
  }
}
```

#### Fund Test Users with Tokens
```bash
# Transfer RWA tokens to test user
npx hardhat run scripts/test/transfer-tokens.ts --network mantleSepolia
```

---

## Quick Testing Scripts

For rapid testing, use the automated scripts that handle authentication, approvals, deposits, and borrowing:

### Deposit RWA Tokens and Borrow USDC (Bash)

```bash
# Navigate to project root
cd /path/to/rwa

# Deposit 90 RWA tokens and borrow $50,000 USDC
INVESTOR_PRIVATE_KEY=0x... ./scripts/deposit-to-solvency-vault.sh \
  0xYourRWATokenAddress \
  90 \
  50000

# Or deposit without borrowing
INVESTOR_PRIVATE_KEY=0x... ./scripts/deposit-to-solvency-vault.sh \
  0xYourRWATokenAddress \
  90
```

**What this script does**:
1. Authenticates with backend (challenge-response)
2. Checks your RWA token balance
3. Approves SolvencyVault to spend tokens (if needed)
4. Deposits tokens as collateral via backend API
5. Optionally borrows USDC (if amount specified)
6. Displays position summary with health factor

**Expected output**:
```
========================================
💰 Deposit to Solvency Vault & Borrow USDC
========================================

ℹ Investor Wallet: 0x580f5b09765e71d64613c8f4403234f8790dd7d3
ℹ Token Address: 0xC91f80c110fE53c0549D990D0eE5bE8EAF123D5e

========================================
Step 1: Authenticate with Backend
========================================

✓ Login successful (Role: INVESTOR)

========================================
Step 2: Check Token Balance & Contract Info
========================================

Your RWA Token Balance: 90.00 INVOICE-001
✓ Token balance verified: 90.00 INVOICE-001

========================================
Step 4: Deposit Collateral to SolvencyVault
========================================

✓ Deposit successful!
Position ID: 5
Collateral Value: $76500.00 USD
Max Borrow: $53550.00 USDC (70% LTV)
Transaction: https://explorer.sepolia.mantle.xyz/tx/0x...

========================================
Step 5: Borrow USDC Against Collateral
========================================

✓ Borrow successful!
Borrowed: $50000.00 USDC
Total Debt: $50000.00 USDC
Health Factor: 153.00%
Transaction: https://explorer.sepolia.mantle.xyz/tx/0x...

🎉 SolvencyVault Deposit Complete!
```

### Deposit RWA Tokens and Borrow USDC (Node.js)

```bash
# Using Node.js script for more detailed control
INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js \
  0xYourRWATokenAddress \
  90 \
  50000

# Without borrowing
INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js \
  0xYourRWATokenAddress \
  90
```

**Advanced options**:
```bash
# Custom backend URL
BACKEND_URL=http://api.example.com \
INVESTOR_KEY=0x... \
node scripts/deposit-to-solvency-vault.js 0xTokenAddr 90 50000

# Custom RPC URL
RPC_URL=https://custom-rpc.mantle.xyz \
INVESTOR_KEY=0x... \
node scripts/deposit-to-solvency-vault.js 0xTokenAddr 90
```

### Example: Using Your 90 Invoice Tokens

Based on your MongoDB document:
```bash
# Your specific case
INVESTOR_PRIVATE_KEY=0xYourPrivateKey ./scripts/deposit-to-solvency-vault.sh \
  0xC91f80c110fE53c0549D990D0eE5bE8EAF123D5e \
  90 \
  50000
```

**Expected outcome**:
- ✅ 90 INVOICE tokens deposited to SolvencyVault
- ✅ Collateral value: ~$76,500 (based on token price $0.85)
- ✅ Maximum borrowable: ~$53,550 (70% LTV)
- ✅ Borrowed: $50,000 USDC
- ✅ Health factor: ~153% (healthy)
- ✅ OAID credit line created automatically

---

## Test Scenarios

### Scenario 1: RWA Token Deposit and Borrow

**Objective**: Test full cycle of depositing RWA tokens, borrowing USDC, and repaying.

#### Step 1.1: Get JWT Token
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0xTestUser1Address",
    "signature": "0x..."
  }'
```

Save the JWT token from response.

#### Step 1.2: Check RWA Token Balance
```bash
# On-chain check
cast call <RWA_TOKEN_ADDRESS> "balanceOf(address)(uint256)" <USER_ADDRESS> --rpc-url $MANTLE_RPC_URL
```

Expected: User should have some RWA tokens (e.g., 100 tokens = 100000000000000000000 wei)

#### Step 1.3: Approve Token Spending
```bash
# Using cast
cast send <RWA_TOKEN_ADDRESS> \
  "approve(address,uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  100000000000000000000 \
  --private-key $TEST_USER_1_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL
```

Expected output:
```
Transaction hash: 0x...
Status: success
```

#### Step 1.4: Deposit Collateral
```bash
curl -X POST http://localhost:3000/solvency/deposit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "tokenAddress": "<RWA_TOKEN_ADDRESS>",
    "amount": "100000000000000000000",
    "valueUSD": "10000000000",
    "tokenType": "RWA"
  }'
```

Expected response:
```json
{
  "success": true,
  "positionId": 1,
  "transaction": {
    "hash": "0xdef456...",
    "blockNumber": 12345679
  },
  "position": {
    "collateralAmount": "100000000000000000000",
    "maxBorrowUSDC": "7000000000",
    "healthFactor": 0
  }
}
```

**Verification**:
- Position ID returned (e.g., 1)
- Max borrow = 70% of collateral value ($7,000 for $10,000 collateral)
- Health factor = 0 (no debt yet)

#### Step 1.5: Check Position Details
```bash
curl -X GET http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer YOUR_JWT"
```

Expected response:
```json
{
  "positionId": 1,
  "userAddress": "0x...",
  "collateralToken": {
    "address": "0x...",
    "symbol": "RWAT",
    "type": "RWA"
  },
  "collateralAmount": "100000000000000000000",
  "tokenValueUSD": "10000000000",
  "usdcBorrowed": "0",
  "outstandingDebt": "0",
  "healthFactor": 0,
  "healthStatus": "HEALTHY",
  "status": "ACTIVE",
  "maxBorrowCapacity": "7000000000"
}
```

#### Step 1.6: Borrow USDC
```bash
curl -X POST http://localhost:3000/solvency/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "positionId": 1,
    "amount": "5000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xghi789...",
    "blockNumber": 12345680
  },
  "position": {
    "outstandingDebt": "5000000000",
    "healthFactor": 20000,
    "remainingBorrowCapacity": "2000000000"
  }
}
```

**Verification**:
- USDC transferred to user wallet (check balance)
- Health factor = 200% (10000 / 5000 * 10000 = 20000)
- Remaining capacity = $2,000 ($7,000 max - $5,000 borrowed)

#### Step 1.7: Check USDC Balance
```bash
cast call <USDC_ADDRESS> "balanceOf(address)(uint256)" <USER_ADDRESS> --rpc-url $MANTLE_RPC_URL
```

Expected: Balance increased by 5000000000 (5,000 USDC with 6 decimals)

#### Step 1.8: Wait for Interest Accrual
```bash
# Wait 30 days or manipulate block timestamp in test environment
# For testing, you can calculate expected interest:
# Interest = Principal × APR × Time / 365
# Interest = 5000 × 0.05 × 30 / 365 = $20.55
```

#### Step 1.9: Check Outstanding Debt (After 30 Days)
```bash
curl -X GET http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer YOUR_JWT"
```

Expected response:
```json
{
  "positionId": 1,
  "outstandingDebt": "5020550000",
  "interestAccrued": "20550000",
  "healthFactor": 19918
}
```

**Verification**:
- Outstanding debt includes principal + interest
- Health factor slightly lower due to interest

#### Step 1.10: Approve USDC for Repayment
```bash
cast send <USDC_ADDRESS> \
  "approve(address,uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  5020550000 \
  --private-key $TEST_USER_1_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL
```

#### Step 1.11: Repay Loan (Partial)
```bash
curl -X POST http://localhost:3000/solvency/repay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "positionId": 1,
    "amount": "2000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xjkl012...",
    "blockNumber": 12345681
  },
  "position": {
    "outstandingDebt": "3020550000",
    "healthFactor": 33099
  }
}
```

**Verification**:
- Debt reduced by $2,000
- Health factor improved to ~331%

#### Step 1.12: Repay Loan (Full)
```bash
# Approve remaining debt
cast send <USDC_ADDRESS> \
  "approve(address,uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  3020550000 \
  --private-key $TEST_USER_1_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL

# Repay
curl -X POST http://localhost:3000/solvency/repay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "positionId": 1,
    "amount": "3020550000"
  }'
```

Expected response:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xmno345...",
    "blockNumber": 12345682
  },
  "position": {
    "outstandingDebt": "0",
    "healthFactor": 0,
    "fullyRepaid": true
  }
}
```

**Verification**:
- Debt = 0
- Health factor = 0 (no debt)
- Can now withdraw collateral

#### Step 1.13: Withdraw Collateral
```bash
curl -X POST http://localhost:3000/solvency/withdraw \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{
    "positionId": 1,
    "amount": "100000000000000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xpqr678...",
    "blockNumber": 12345683
  },
  "withdrawn": "100000000000000000000",
  "positionClosed": true
}
```

**Verification**:
- RWA tokens returned to user wallet
- Position status = CLOSED

**✅ Test Complete**: User deposited RWA tokens, borrowed USDC, repaid with interest, and withdrew collateral.

---

### Scenario 2: Private Asset Token Lifecycle

**Objective**: Test private asset minting, deposit, borrowing, and valuation update.

#### Step 2.1: Mint Private Asset Token (Admin)
```bash
curl -X POST http://localhost:3000/admin/solvency/private-asset/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "name": "Property Deed - 456 Oak Ave",
    "symbol": "DEED-456",
    "totalSupply": "1000000000000000000",
    "assetType": "DEED",
    "location": "New York, USA",
    "valuation": "500000000000",
    "documentHash": "QmPropertyDocs789",
    "issuer": "0xIssuerAddress"
  }'
```

Expected response:
```json
{
  "success": true,
  "assetId": "0x7d5a99...",
  "tokenAddress": "0x9fE467...",
  "metadata": {
    "assetType": "DEED",
    "location": "New York, USA",
    "valuation": "500000000000",
    "valuationDate": "2026-01-04T00:00:00Z"
  }
}
```

**Verification**:
- Token deployed with metadata
- Valuation = $500,000
- Document hash stored

#### Step 2.2: Transfer Token to User
```bash
# Using cast (as issuer/admin)
cast send <PRIVATE_ASSET_TOKEN_ADDRESS> \
  "transfer(address,uint256)" \
  <TEST_USER_1_ADDRESS> \
  1000000000000000000 \
  --private-key $ADMIN_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL
```

#### Step 2.3: Approve and Deposit Private Asset
```bash
# Approve
cast send <PRIVATE_ASSET_TOKEN_ADDRESS> \
  "approve(address,uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  1000000000000000000 \
  --private-key $TEST_USER_1_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL

# Deposit
curl -X POST http://localhost:3000/solvency/deposit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "tokenAddress": "<PRIVATE_ASSET_TOKEN_ADDRESS>",
    "amount": "1000000000000000000",
    "valueUSD": "500000000000",
    "tokenType": "PRIVATE_ASSET"
  }'
```

Expected response:
```json
{
  "success": true,
  "positionId": 2,
  "position": {
    "collateralAmount": "1000000000000000000",
    "maxBorrowUSDC": "300000000000",
    "healthFactor": 0
  }
}
```

**Verification**:
- Max borrow = 60% of $500,000 = $300,000 (private asset LTV is 60%)
- Position created with lower LTV than RWA

#### Step 2.4: Borrow Maximum Amount
```bash
curl -X POST http://localhost:3000/solvency/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 2,
    "amount": "300000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "position": {
    "outstandingDebt": "300000000000",
    "healthFactor": 16666,
    "remainingBorrowCapacity": "0"
  }
}
```

**Verification**:
- Health factor = 166.66% (500000 / 300000 * 10000)
- No remaining capacity (borrowed max)

#### Step 2.5: Update Private Asset Valuation (Admin)
```bash
# Simulate property value drop to $400,000
curl -X POST http://localhost:3000/admin/solvency/private-asset/<ASSET_ID>/update-valuation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "newValuation": "400000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "assetId": "0x7d5a99...",
  "oldValuation": "500000000000",
  "newValuation": "400000000000",
  "affectedPositions": [
    {
      "positionId": 2,
      "oldHealthFactor": 16666,
      "newHealthFactor": 13333,
      "newStatus": "HEALTHY"
    }
  ]
}
```

**Verification**:
- Health factor recalculated: (400000 / 300000 * 10000) = 13333 (133.33%)
- Still healthy, but closer to warning zone

#### Step 2.6: Further Valuation Drop (Critical)
```bash
# Simulate further drop to $320,000 (triggers warning)
curl -X POST http://localhost:3000/admin/solvency/private-asset/<ASSET_ID>/update-valuation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "newValuation": "320000000000"
  }'
```

Expected response:
```json
{
  "success": true,
  "affectedPositions": [
    {
      "positionId": 2,
      "oldHealthFactor": 13333,
      "newHealthFactor": 10666,
      "newStatus": "WARNING"
    }
  ]
}
```

**Verification**:
- Health factor = 106.66% (320000 / 300000 * 10000)
- Status = WARNING (between 100-110%)
- User should receive notification

#### Step 2.7: Check User Notifications
```bash
curl -X GET http://localhost:3000/notifications \
  -H "Authorization: Bearer USER_JWT"
```

Expected to include:
```json
{
  "notifications": [
    {
      "header": "Position at Risk",
      "detail": "Your position #2 health factor is now 106.66%. Consider repaying or adding collateral to avoid liquidation.",
      "type": "POSITION_WARNING",
      "severity": "WARNING"
    }
  ]
}
```

**✅ Test Complete**: Private asset minted, deposited, borrowed against, and valuation updated with health monitoring.

---

### Scenario 3: Liquidation Flow

**Objective**: Test full liquidation when health factor drops below 110%.

#### Step 3.1: Create Position Near Liquidation
```bash
# Use existing position from Scenario 2, or create new one
# Ensure health factor is between 100-110%
```

#### Step 3.2: Drop Valuation Below Liquidation Threshold
```bash
# Drop property value to $310,000
curl -X POST http://localhost:3000/admin/solvency/private-asset/<ASSET_ID>/update-valuation \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "newValuation": "310000000000"
  }'
```

Expected:
- Health factor = (310000 / 300000 * 10000) = 10333 (103.33%)
- Status = LIQUIDATABLE

#### Step 3.3: Check Liquidatable Positions (Admin)
```bash
curl -X GET http://localhost:3000/admin/solvency/liquidatable \
  -H "Authorization: Bearer ADMIN_JWT"
```

Expected response:
```json
{
  "positions": [
    {
      "positionId": 2,
      "userAddress": "0xUser...",
      "collateralValue": "310000000000",
      "outstandingDebt": "300000000000",
      "healthFactor": 10333,
      "daysSinceWarning": 1,
      "recommendedAction": "LIQUIDATE"
    }
  ],
  "meta": {
    "total": 1,
    "criticalCount": 1
  }
}
```

#### Step 3.4: Trigger Liquidation (Admin)
```bash
curl -X POST http://localhost:3000/admin/solvency/liquidate/2 \
  -H "Authorization: Bearer ADMIN_JWT"
```

Expected response:
```json
{
  "success": true,
  "positionId": 2,
  "liquidation": {
    "collateralValue": "310000000000",
    "outstandingDebt": "300000000000",
    "healthFactor": 10333,
    "liquidationPrice": "279000000000",
    "marketplaceListingId": "0xabc..."
  },
  "transaction": {
    "hash": "0xstu901...",
    "blockNumber": 12345690
  }
}
```

**Verification**:
- Liquidation price = 90% of valuation ($310k × 0.9 = $279k)
- Marketplace listing created
- Position status = LIQUIDATED

#### Step 3.5: Verify Marketplace Listing
```bash
curl -X GET http://localhost:3000/marketplace/listings/<LISTING_ID>
```

Expected:
```json
{
  "listingId": "0xabc...",
  "tokenAddress": "<PRIVATE_ASSET_TOKEN_ADDRESS>",
  "amount": "1000000000000000000",
  "pricePerToken": "279000000000",
  "totalPrice": "279000000000",
  "seller": "<SOLVENCY_VAULT_ADDRESS>",
  "listingType": "STATIC",
  "status": "ACTIVE"
}
```

#### Step 3.6: Simulate Listing Purchase
```bash
# As another user, purchase the liquidated asset
curl -X POST http://localhost:3000/marketplace/purchase \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer BUYER_JWT" \
  -d '{
    "listingId": "<LISTING_ID>",
    "amount": "1000000000000000000"
  }'
```

#### Step 3.7: Verify Settlement
```bash
# Check position status
curl -X GET http://localhost:3000/solvency/position/2 \
  -H "Authorization: Bearer ADMIN_JWT"
```

Expected response:
```json
{
  "positionId": 2,
  "status": "LIQUIDATED",
  "liquidation": {
    "liquidationPrice": "279000000000",
    "outstandingDebt": "300000000000",
    "debtRecovered": "279000000000",
    "shortfall": "21000000000"
  }
}
```

**Verification**:
- Debt recovery = $279,000 (listing sale price)
- Shortfall = $21,000 (debt - recovery)
- Position marked as LIQUIDATED

**✅ Test Complete**: Position liquidated when health < 110%, listing sold, settlement recorded.

---

### Scenario 4: OAID Credit Line Integration

**Objective**: Test OAID credit line issuance and verification.

#### Step 4.1: Create Position with OAID
```bash
# Deposit collateral (creates position + OAID credit line)
curl -X POST http://localhost:3000/solvency/deposit \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "tokenAddress": "<RWA_TOKEN_ADDRESS>",
    "amount": "50000000000000000000",
    "valueUSD": "50000000000",
    "tokenType": "RWA",
    "issueOAID": true
  }'
```

Expected response:
```json
{
  "success": true,
  "positionId": 3,
  "oaidCreditLine": {
    "creditLineId": 1,
    "creditLimit": "35000000000",
    "creditUsed": "0",
    "creditAvailable": "35000000000"
  }
}
```

**Verification**:
- Credit limit = 70% of $50,000 = $35,000
- Credit line active and linked to position

#### Step 4.2: Verify OAID On-Chain
```bash
# Call OAID contract
cast call <OAID_ADDRESS> \
  "getCreditLine(address)(uint256,uint256,uint256,address,uint256,uint256,bool)" \
  <USER_ADDRESS> \
  --rpc-url $MANTLE_RPC_URL
```

Expected output:
```
creditLineId: 1
creditLimit: 35000000000
creditUsed: 0
collateralToken: 0x...
collateralAmount: 50000000000000000000
solvencyPositionId: 3
active: true
```

#### Step 4.3: Borrow Against Position (Uses OAID Credit)
```bash
curl -X POST http://localhost:3000/solvency/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 3,
    "amount": "20000000000"
  }'
```

Expected response includes updated OAID:
```json
{
  "success": true,
  "position": {
    "outstandingDebt": "20000000000",
    "oaidCreditLine": {
      "creditUsed": "20000000000",
      "creditAvailable": "15000000000"
    }
  }
}
```

#### Step 4.4: External Protocol Verification
```bash
# Simulate external protocol checking credit
cast call <OAID_ADDRESS> \
  "canBorrow(address,uint256)(bool)" \
  <USER_ADDRESS> \
  10000000000 \
  --rpc-url $MANTLE_RPC_URL
```

Expected: `true` (user has $15k available, requesting $10k)

#### Step 4.5: Repay and Check OAID Update
```bash
# Repay $10,000
curl -X POST http://localhost:3000/solvency/repay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 3,
    "amount": "10000000000"
  }'
```

Expected:
- Credit used: $10,000 (reduced from $20k)
- Credit available: $25,000 (increased)

**✅ Test Complete**: OAID credit line issued, used, and updated correctly.

---

## Admin Operations

### Test: Mint Multiple Private Assets

**Objective**: Mint various private asset types and verify metadata.

```bash
# DEED
curl -X POST http://localhost:3000/admin/solvency/private-asset/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "name": "Commercial Property",
    "symbol": "DEED-COM",
    "totalSupply": "1000000000000000000",
    "assetType": "DEED",
    "location": "California",
    "valuation": "1000000000000",
    "documentHash": "QmDeed1",
    "issuer": "0xIssuer"
  }'

# BOND
curl -X POST http://localhost:3000/admin/solvency/private-asset/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "name": "Corporate Bond Series A",
    "symbol": "BOND-A",
    "totalSupply": "1000000000000000000000",
    "assetType": "BOND",
    "valuation": "50000000000",
    "documentHash": "QmBond1",
    "issuer": "0xIssuer"
  }'

# INVOICE
curl -X POST http://localhost:3000/admin/solvency/private-asset/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT" \
  -d '{
    "name": "Invoice #12345",
    "symbol": "INV-12345",
    "totalSupply": "1000000000000000000",
    "assetType": "INVOICE",
    "valuation": "25000000000",
    "documentHash": "QmInvoice1",
    "issuer": "0xIssuer"
  }'
```

**Verification**:
- Each asset type minted successfully
- Different valuations and metadata
- Document hashes stored

---

## Edge Cases

### Test 1: Attempt to Borrow More Than LTV
```bash
curl -X POST http://localhost:3000/solvency/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 1,
    "amount": "8000000000"
  }'
```

Expected error:
```json
{
  "error": "Insufficient collateral. Max borrow: 7000000000"
}
```

### Test 2: Withdraw Without Full Repayment
```bash
curl -X POST http://localhost:3000/solvency/withdraw \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 1,
    "amount": "100000000000000000000"
  }'
```

Expected error:
```json
{
  "error": "Cannot withdraw. Outstanding debt: 5000000000"
}
```

### Test 3: Liquidate Healthy Position
```bash
curl -X POST http://localhost:3000/admin/solvency/liquidate/1 \
  -H "Authorization: Bearer ADMIN_JWT"
```

Expected error:
```json
{
  "error": "Position is healthy. Health factor: 20000 (must be < 11000)"
}
```

### Test 4: Non-Owner Access Position
```bash
# User 2 tries to access User 1's position
curl -X GET http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer USER2_JWT"
```

Expected error:
```json
{
  "error": "Access denied. You do not own this position."
}
```

### Test 5: Zero Amount Operations
```bash
# Try to borrow 0 USDC
curl -X POST http://localhost:3000/solvency/borrow \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer USER_JWT" \
  -d '{
    "positionId": 1,
    "amount": "0"
  }'
```

Expected error:
```json
{
  "error": "Amount must be greater than 0"
}
```

---

## Troubleshooting

### Issue 1: "Insufficient allowance" Error

**Symptom**: Deposit or repay fails with insufficient allowance

**Solution**:
```bash
# Check current allowance
cast call <TOKEN_ADDRESS> \
  "allowance(address,address)(uint256)" \
  <USER_ADDRESS> \
  <SOLVENCY_VAULT_ADDRESS> \
  --rpc-url $MANTLE_RPC_URL

# Approve sufficient amount
cast send <TOKEN_ADDRESS> \
  "approve(address,uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  <AMOUNT> \
  --private-key $USER_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL
```

### Issue 2: Health Factor Not Updating

**Symptom**: Health factor shows old value after valuation update

**Solution**:
- Check if valuation update transaction confirmed
- Verify backend listener is running
- Manually refresh position:
```bash
curl -X POST http://localhost:3000/admin/solvency/refresh-position/1 \
  -H "Authorization: Bearer ADMIN_JWT"
```

### Issue 3: SeniorPool Has No Liquidity

**Symptom**: Borrow fails with "Insufficient pool liquidity"

**Solution**:
```bash
# Check SeniorPool balance
cast call <SENIOR_POOL_ADDRESS> \
  "totalLiquidity()(uint256)" \
  --rpc-url $MANTLE_RPC_URL

# Add liquidity (as admin)
cast send <SENIOR_POOL_ADDRESS> \
  "depositLiquidity(uint256)" \
  100000000000000 \
  --private-key $ADMIN_PRIVATE_KEY \
  --rpc-url $MANTLE_RPC_URL
```

### Issue 4: OAID Credit Line Not Created

**Symptom**: Position created but no OAID credit line

**Solution**:
- Ensure `issueOAID: true` in deposit request
- Check OAID contract is deployed and configured
- Verify SolvencyVault has permission to call OAID:
```bash
cast call <OAID_ADDRESS> \
  "authorizedVaults(address)(bool)" \
  <SOLVENCY_VAULT_ADDRESS> \
  --rpc-url $MANTLE_RPC_URL
```

### Issue 5: Notification Not Received

**Symptom**: Position liquidated but user not notified

**Solution**:
- Check SSE connection:
```bash
curl -N -H "Authorization: Bearer JWT" \
  http://localhost:3000/notifications/stream
```
- Verify MongoDB notification stored:
```bash
mongo
> use rwa_platform
> db.usernotifications.find({ userId: "0xuser..." })
```

### Issue 6: Marketplace Listing Not Created on Liquidation

**Symptom**: Liquidation succeeds but no listing appears

**Solution**:
- Verify PrimaryMarket authorization:
```bash
cast call <PRIMARY_MARKET_ADDRESS> \
  "authorizedVaults(address)(bool)" \
  <SOLVENCY_VAULT_ADDRESS> \
  --rpc-url $MANTLE_RPC_URL
```
- Check vault token approval:
```bash
cast call <TOKEN_ADDRESS> \
  "allowance(address,address)(uint256)" \
  <SOLVENCY_VAULT_ADDRESS> \
  <PRIMARY_MARKET_ADDRESS> \
  --rpc-url $MANTLE_RPC_URL
```

---

## Performance Testing

### Load Test: Multiple Concurrent Borrows

```bash
# Create 10 positions and borrow simultaneously
for i in {1..10}; do
  curl -X POST http://localhost:3000/solvency/borrow \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer USER${i}_JWT" \
    -d "{\"positionId\": $i, \"amount\": \"1000000000\"}" &
done
wait
```

**Expected**: All requests succeed without conflicts

### Stress Test: Rapid Valuation Updates

```bash
# Update valuation 100 times in rapid succession
for i in {1..100}; do
  VALUE=$((450000000000 + RANDOM % 100000000000))
  curl -X POST http://localhost:3000/admin/solvency/private-asset/<ASSET_ID>/update-valuation \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ADMIN_JWT" \
    -d "{\"newValuation\": \"$VALUE\"}" &
done
wait
```

**Expected**: Final valuation is consistent, all positions recalculated

---

## Test Checklist

### Pre-Deployment
- [ ] All contracts deployed successfully
- [ ] SeniorPool authorized SolvencyVault
- [ ] PrimaryMarket authorized SolvencyVault
- [ ] OAID contract linked to SolvencyVault
- [ ] Test tokens minted and distributed
- [ ] Backend connected to correct contract addresses

### Core Functionality
- [ ] Deposit RWA tokens (70% LTV)
- [ ] Deposit Private Asset tokens (60% LTV)
- [ ] Borrow USDC within limits
- [ ] Repay partial loan
- [ ] Repay full loan
- [ ] Withdraw collateral after repayment
- [ ] Health factor calculated correctly
- [ ] Interest accrual works

### Admin Operations
- [ ] Mint private asset tokens
- [ ] Update private asset valuations
- [ ] Trigger manual liquidation
- [ ] View liquidatable positions
- [ ] Approve tokens for vault

### OAID Integration
- [ ] Credit line issued on deposit
- [ ] Credit limit = LTV × collateral value
- [ ] Credit used updates on borrow
- [ ] Credit available updates on repay
- [ ] External verification works

### Edge Cases
- [ ] Reject over-borrowing
- [ ] Reject withdrawal with debt
- [ ] Reject liquidation of healthy position
- [ ] Reject non-owner access
- [ ] Handle zero amounts gracefully

### Notifications
- [ ] Deposit notification sent
- [ ] Borrow notification sent
- [ ] Repay notification sent
- [ ] Warning notification when health < 125%
- [ ] Liquidation notification sent
- [ ] SSE real-time delivery works

---

## Success Criteria

### Functional Tests
- ✅ All deposit/borrow/repay/withdraw flows complete successfully
- ✅ Health factors calculate accurately across all scenarios
- ✅ Liquidations execute when health < 110%
- ✅ Marketplace listings created and settled correctly
- ✅ OAID credit lines issued and verifiable

### Performance Tests
- ✅ Handle 100+ concurrent requests without errors
- ✅ Health factor updates complete within 5 seconds
- ✅ Liquidation triggers within 1 minute of health drop

### Security Tests
- ✅ Only position owner can borrow/repay/withdraw
- ✅ Only admin can liquidate/mint/update valuations
- ✅ Cannot borrow beyond LTV limits
- ✅ Cannot withdraw with outstanding debt

### Integration Tests
- ✅ SeniorPool liquidity correctly allocated
- ✅ Marketplace listings settle to SeniorPool
- ✅ OAID reflects accurate credit availability
- ✅ Notifications delivered via SSE and database

---

## Additional Resources

- **Main Documentation**: `SOLVENCY_VAULT_DOCUMENTATION.md`
- **Contract Source**: `packages/contracts/contracts/core/SolvencyVault.sol`
- **Backend Source**: `packages/backend/src/modules/solvency/`
- **Example Scripts**: `packages/contracts/scripts/test/solvency/`

For questions or issues, refer to the troubleshooting section or contact the development team.
