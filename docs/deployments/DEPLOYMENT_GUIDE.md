# Deployment Guide - Mantle RWA Platform

Complete guide for deploying the Mantle RWA Platform to production or testnet environments.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Phase 1: Smart Contract Deployment](#phase-1-smart-contract-deployment)
- [Phase 2: Backend Setup](#phase-2-backend-setup)
- [Phase 3: Asset Deployment Pipeline](#phase-3-asset-deployment-pipeline)
- [Phase 4: Marketplace Setup](#phase-4-marketplace-setup)
- [Testing the Deployment](#testing-the-deployment)
- [Environment Configuration](#environment-configuration)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Mantle RWA Platform consists of:
1. **Smart Contracts** (Solidity) - On-chain asset tokenization and marketplace
2. **Backend API** (NestJS) - Off-chain processing and database
3. **Event Listeners** - Blockchain event processing
4. **Scripts** - Automation and testing utilities

### Deployment Flow
```
1. Deploy Smart Contracts → 2. Configure Backend → 3. Test Asset Pipeline → 4. Launch Marketplace
```

---

## Prerequisites

### Required Tools
- [x] Node.js v18+ and npm/yarn
- [x] MongoDB (local or cloud instance)
- [x] Redis (for queue processing)
- [x] Git
- [x] Web3 wallet with testnet/mainnet funds

### Required Accounts
- [x] Mantle RPC access (https://rpc.sepolia.mantle.xyz)
- [x] EigenDA disperser access (for blob storage)
- [x] MongoDB connection string
- [x] Typeform account (for asset submissions)

### Network Configuration
**Mantle Sepolia Testnet:**
- RPC: `https://rpc.sepolia.mantle.xyz`
- WSS: `wss://rpc.sepolia.mantle.xyz`
- Chain ID: `5003`
- Explorer: `https://sepolia.mantlescan.xyz`

---

## Phase 1: Smart Contract Deployment

### 1.1 Clone and Setup

```bash
git clone https://github.com/your-org/mantle-rwa.git
cd mantle-rwa
yarn install
```

### 1.2 Configure Environment

Create `.env` in project root:

```bash
# Blockchain
PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
ADMIN_PRIVATE_KEY=0xYOUR_ADMIN_PRIVATE_KEY
MANTLE_TESTNET_RPC=https://rpc.sepolia.mantle.xyz
MANTLE_MAINNET_RPC=https://rpc.mantle.xyz
CHAIN_ID=5003

# Platform Wallets
PLATFORM_PRIVATE_KEY=0xYOUR_PLATFORM_WALLET_KEY
CUSTODY_WALLET_ADDRESS=0xYOUR_CUSTODY_WALLET_ADDRESS
ORIGINATOR_PRIVATE_KEY=0xYOUR_ORIGINATOR_KEY
```

### 1.3 Deploy Contracts

```bash
cd packages/contracts

# Compile contracts
npx hardhat compile

# Deploy to Mantle Sepolia
npx hardhat run scripts/deploy.ts --network mantleTestnet

# Or use deployment script
yarn deploy:testnet
```

### 1.4 Save Deployment Addresses

After deployment, contracts will be saved to:
```
packages/contracts/deployed_contracts.json
```

**Example output:**
```json
{
  "network": "mantleTestnet",
  "timestamp": "2025-12-24T09:34:50.996Z",
  "contracts": {
    "AttestationRegistry": "0x4d0B52aB6303C4532bE779c14C49d6a97A5867ac",
    "TrustedIssuersRegistry": "0x2104A6Fff392f36d03f3D6C38b37E2b215Bd7D7c",
    "IdentityRegistry": "0xD93911f05958b017F43DAcF99A0eB9a1EB91431d",
    "YieldVault": "0x04bABaDA4b187d39BcB4e3e851e909fAD0513Fe5",
    "TokenFactory": "0x094A619b6E7e851C128317795266468552F4e964",
    "PrimaryMarketplace": "0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615",
    "USDC": "0xfD61dC86e7799479597c049D7b19e6E638adDdd0"
  }
}
```

### 1.5 Verify Contracts (Optional)

```bash
# Verify on block explorer
npx hardhat verify --network mantleTestnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## Phase 2: Backend Setup

### 2.1 Configure Backend Environment

Create `packages/backend/.env`:

```bash
# JWT & Security
JWT_SECRET=YOUR_SUPER_SECRET_JWT_KEY_CHANGE_IN_PRODUCTION

# Database
MONGODB_URI=mongodb://127.0.0.1:27017/mantle-rwa?directConnection=true

# Redis (for BullMQ queues)
REDIS_HOST=127.0.0.1
REDIS_PORT=6379

# Blockchain
MANTLE_RPC_URL=https://rpc.sepolia.mantle.xyz
MANTLE_WSS_URL=wss://rpc.sepolia.mantle.xyz
CHAIN_ID=5003

# Admin & Platform Keys
ADMIN_PRIVATE_KEY=0xYOUR_ADMIN_PRIVATE_KEY
PLATFORM_PRIVATE_KEY=0xYOUR_PLATFORM_PRIVATE_KEY
CUSTODY_WALLET_ADDRESS=0xYOUR_CUSTODY_WALLET

# Contract Addresses (from deployed_contracts.json)
ATTESTATION_REGISTRY_ADDRESS=0x...
IDENTITY_REGISTRY_ADDRESS=0x...
TOKEN_FACTORY_ADDRESS=0x...
YIELD_VAULT_ADDRESS=0x...
PRIMARY_MARKETPLACE_ADDRESS=0x...

# EigenDA
EIGENDA_DISPERSER_URL=https://disperser-holesky.eigenda.xyz

# Typeform
TYPEFORM_WEBHOOK_SECRET=your_typeform_webhook_secret
```

### 2.2 Start Database Services

```bash
# Start MongoDB
mongod --dbpath /path/to/data

# Start Redis
redis-server

# Or use Docker
docker-compose up -d mongodb redis
```

### 2.3 Start Backend

```bash
cd packages/backend

# Development
yarn dev

# Production
yarn build
yarn start:prod
```

**Backend should start on:** `http://localhost:3000`

### 2.4 Verify Backend Health

```bash
# Check API health
curl http://localhost:3000/

# Expected: Server running message or health check response
```

---

## Phase 3: Asset Deployment Pipeline

### 3.1 Configure Typeform Integration

1. Create a Typeform for asset submissions
2. Add webhook: `https://your-backend.com/webhooks/typeform`
3. Set webhook secret in backend `.env`
4. Map form fields to asset schema (see Typeform docs)

### 3.2 Test Asset Submission → Tokenization

**Complete flow:**

```bash
# Step 1: Submit asset via Typeform
# (Fill out the form with invoice details)

# Step 2: Get the asset ID from webhook logs or database
export ASSET_ID="<UUID_FROM_SUBMISSION>"

# Step 3: Get admin JWT token
node scripts/sign-admin-login.js
export ADMIN_TOKEN="<JWT_TOKEN>"

# Step 4: Run full deployment pipeline
./scripts/deploy-asset.sh $ASSET_ID

# This will:
# - Approve the asset
# - Register on-chain (with attestation)
# - Deploy RWA token
# - List on marketplace
```

### 3.3 Manual Asset Deployment (Step-by-Step)

If the automated script fails, run manually:

```bash
# 1. Approve Asset
curl -X POST "http://localhost:3000/admin/compliance/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "'$ASSET_ID'",
    "adminWallet": "0x23e67597f0898f747Fa3291C8920168adF9455D0"
  }'

# 2. Register Asset On-Chain
curl -X POST "http://localhost:3000/admin/assets/$ASSET_ID/register" \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Wait 10 seconds for transaction...

# 3. Deploy Token
curl -X POST "http://localhost:3000/admin/assets/deploy-token" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "'$ASSET_ID'",
    "name": "Invoice Token",
    "symbol": "INVT"
  }'

# Wait 15 seconds for transaction...

# 4. List on Marketplace
curl -X POST "http://localhost:3000/admin/assets/list-on-marketplace" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "'$ASSET_ID'",
    "type": "STATIC",
    "price": "1000000",
    "minInvestment": "1000000000000000000000"
  }'
```

---

## Phase 4: Marketplace Setup

### 4.1 Prepare Platform Custody Wallet

The custody wallet must hold all tokens for sale:

```bash
# Check if tokens are in custody wallet
node scripts/check-token-supply.js

# Transfer tokens to custody and approve marketplace
node scripts/prepare-marketplace.js
```

### 4.2 Register Investors

Before investors can buy, register them:

```bash
# Register investor wallet
node scripts/register-investor.js 0xINVESTOR_WALLET_ADDRESS
```

### 4.3 Fund Investors (Testnet Only)

```bash
# Mint Mock USDC for testing
node scripts/mint-usdc.js 0xINVESTOR_WALLET_ADDRESS 10000
```

---

## Testing the Deployment

### Test 1: Marketplace Listings API

```bash
# Get investor JWT
node scripts/sign-investor-login.js
export INVESTOR_TOKEN="<JWT>"

# Fetch listings
curl -X GET "http://localhost:3000/marketplace/listings" \
  -H "Authorization: Bearer $INVESTOR_TOKEN"

# Expected: List of available assets
```

### Test 2: Token Purchase

```bash
# Buy tokens (on-chain transaction)
node scripts/buy-tokens.js <ASSET_ID> 1000

# Expected: Transaction confirmation and token balance update
```

### Test 3: Event Processing

Check backend logs for event processing:
```
[EventProcessor] Processing TokensPurchased event...
[EventProcessor] Updated database with purchase
```

### Test 4: Yield Distribution (Optional)

```bash
# Deposit yield to vault
node scripts/deposit-yield.js <TOKEN_ADDRESS> 1000

# Distribute to holders
node scripts/distribute-yield.js <TOKEN_ADDRESS>
```

---

## Environment Configuration

### Production Checklist

- [ ] Update `JWT_SECRET` to a strong random key
- [ ] Use production MongoDB with authentication
- [ ] Use production Redis with authentication
- [ ] Enable CORS only for your frontend domain
- [ ] Set up SSL/TLS certificates
- [ ] Configure rate limiting
- [ ] Enable logging and monitoring
- [ ] Set up backup strategy for database
- [ ] Configure alerting for failed transactions
- [ ] Review and harden smart contract permissions

### Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_PRIVATE_KEY` | Admin wallet for approvals | `0xabc...` |
| `PLATFORM_PRIVATE_KEY` | Platform operations | `0xdef...` |
| `MONGODB_URI` | Database connection | `mongodb://...` |
| `REDIS_HOST` | Queue service | `127.0.0.1` |
| `JWT_SECRET` | Auth token secret | `random_string` |
| `TYPEFORM_WEBHOOK_SECRET` | Webhook verification | `hellotypeform...` |
| `ATTESTATION_REGISTRY_ADDRESS` | Contract address | `0x4d0B52aB...` |

---

## Troubleshooting

### Common Issues

#### 1. Backend won't start
```bash
# Check MongoDB is running
mongosh

# Check Redis is running
redis-cli ping

# Check environment variables
cat packages/backend/.env
```

#### 2. Transactions failing
```bash
# Check wallet has MNT for gas
# Check contract addresses are correct
# Check wallet has required permissions
# View transaction on explorer for revert reason
```

#### 3. Event listeners not processing
```bash
# Check WSS connection
# Verify contract addresses in .env
# Check BullMQ queue is running
# View backend logs for errors
```

#### 4. Token purchase fails
```bash
# Ensure investor is KYC registered
node scripts/register-investor.js <WALLET>

# Ensure investor has USDC
node scripts/mint-usdc.js <WALLET> 10000

# Ensure tokens are in custody wallet
node scripts/prepare-marketplace.js

# Check marketplace listing is active
curl http://localhost:3000/marketplace/listings
```

---

## Post-Deployment

### Monitoring

Set up monitoring for:
- [ ] Backend API uptime
- [ ] Database connections
- [ ] Queue processing rate
- [ ] Failed transactions
- [ ] Event listener health
- [ ] Gas prices and transaction costs

### Maintenance Tasks

**Daily:**
- Monitor event processing queue
- Check failed transactions
- Review system logs

**Weekly:**
- Database backups
- Review and archive old logs
- Check contract balance

**Monthly:**
- Security audit
- Update dependencies
- Performance optimization

---

## Quick Reference

### Useful Commands

```bash
# Get admin token
node scripts/sign-admin-login.js

# Deploy full asset
ADMIN_TOKEN=<token> ./scripts/deploy-asset.sh <asset-id>

# Check listing
curl http://localhost:3000/marketplace/listings/<asset-id>

# Buy tokens
node scripts/buy-tokens.js <asset-id> 1000

# Register investor
node scripts/register-investor.js <wallet>

# Mint test USDC
node scripts/mint-usdc.js <wallet> 10000

# Close listing
node scripts/close-listing.js <asset-id>
```

### API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/challenge` | GET | Public | Get login challenge |
| `/auth/login` | POST | Public | Login with signature |
| `/marketplace/listings` | GET | JWT | Get all listings |
| `/marketplace/listings/:id` | GET | JWT | Get listing details |
| `/admin/compliance/approve` | POST | Admin | Approve asset |
| `/admin/assets/:id/register` | POST | Admin | Register on-chain |
| `/admin/assets/deploy-token` | POST | Admin | Deploy token |
| `/admin/assets/list-on-marketplace` | POST | Admin | List asset |

---

## Support & Resources

- **Documentation:** [Link to docs]
- **GitHub:** [Repository link]
- **Discord:** [Community link]
- **Bug Reports:** GitHub Issues

---

**Version:** 1.0.0
**Last Updated:** December 24, 2025
**Maintainer:** Mantle RWA Team
