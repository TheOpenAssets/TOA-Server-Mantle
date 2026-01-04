# Solvency Vault (OAID) - Technical Documentation

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Key Concepts](#key-concepts)
4. [Smart Contracts](#smart-contracts)
5. [API Endpoints](#api-endpoints)
6. [Database Schemas](#database-schemas)
7. [Integration Guide](#integration-guide)
8. [Security Considerations](#security-considerations)

---

## Overview

The Solvency Vault is a collateralized lending system that enables users to:
- Deposit RWA tokens or Private Asset tokens as collateral
- Borrow USDC against their collateral at competitive rates
- Repay loans and withdraw collateral
- Obtain OAID (On-chain Asset Identity) credit lines backed by their positions

### Key Features
- **Multi-Asset Support**: Accepts both RWA tokens (tokenized real-world assets) and Private Asset tokens (platform-minted tokens representing physical assets like deeds, bonds, invoices)
- **Conservative LTV Ratios**: 70% for RWA tokens, 60% for private assets
- **5% APR**: Borrows USDC from the existing SeniorPool at platform rate
- **Manual Liquidation**: Admin-triggered liquidation at 110% health threshold
- **OAID Integration**: Issues verifiable credit lines for external protocols

---

## Architecture

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                        User Interface                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend API Layer                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Solvency    │  │  Solvency    │  │  Private     │      │
│  │  Controller  │  │  Admin Ctrl  │  │  Asset Svc   │      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘      │
│         │                  │                  │              │
│  ┌──────▼──────────────────▼──────────────────▼───────┐    │
│  │     Solvency Blockchain Service                     │    │
│  └──────┬──────────────────────────────────────────────┘    │
└─────────┼─────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Smart Contracts Layer                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Solvency    │◄─┤  Senior      │  │  Primary     │      │
│  │  Vault       │  │  Pool        │  │  Market      │      │
│  └──────┬───────┘  └──────────────┘  └──────────────┘      │
│         │                                                    │
│  ┌──────▼───────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  RWA Token   │  │PrivateAsset  │  │    OAID      │      │
│  │              │  │   Token      │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

**Deposit Flow**:
1. User approves token spending to SolvencyVault
2. Backend calls `depositCollateral(token, amount, valueUSD)`
3. Vault transfers tokens from user to vault custody
4. Position created in database with LTV calculations
5. User notified of successful deposit

**Borrow Flow**:
1. User requests USDC loan via API
2. Backend validates health factor allows borrowing
3. Vault borrows USDC from SeniorPool
4. USDC transferred to user's wallet
5. Position updated with new debt amount

**Repayment Flow**:
1. User approves USDC spending to SolvencyVault
2. Backend calls `repayLoan(positionId, amount)`
3. Vault transfers USDC to SeniorPool
4. Position debt reduced, health factor improved
5. User can withdraw collateral if fully repaid

**Liquidation Flow**:
1. Admin monitors positions with health < 110%
2. Admin triggers liquidation via API
3. Vault creates marketplace listing at 10% discount
4. On sale: proceeds applied to SeniorPool debt
5. Any shortfall recorded, excess returned to user

---

## Key Concepts

### Loan-to-Value (LTV) Ratios

The maximum borrowing capacity is determined by the collateral type:

- **RWA Tokens**: 70% LTV (7000 basis points)
  - Example: $10,000 worth of RWA tokens → borrow up to $7,000 USDC

- **Private Asset Tokens**: 60% LTV (6000 basis points)
  - Example: $50,000 property deed token → borrow up to $30,000 USDC

### Health Factor

Health factor measures position safety:

```
Health Factor = (Collateral Value USD / Outstanding Debt) × 10000
```

**Thresholds**:
- **> 11000** (110%): Healthy position
- **10000-11000** (100-110%): Warning zone, approaching liquidation
- **< 11000** (110%): Liquidatable

**Example**:
- Collateral: $10,000
- Debt: $7,000
- Health Factor: (10000 / 7000) × 10000 = 14285 (142.85%) ✅ Healthy

If collateral drops to $7,500:
- Health Factor: (7500 / 7000) × 10000 = 10714 (107.14%) ⚠️ Warning

If collateral drops to $7,000:
- Health Factor: (7000 / 7000) × 10000 = 10000 (100%) ❌ Liquidatable

### Private Asset Valuation

Private assets (deeds, bonds, invoices) are valued at mint time:

```solidity
struct AssetMetadata {
    string assetType;        // "DEED", "BOND", "INVOICE", "EQUIPMENT"
    string location;         // Physical location/jurisdiction
    uint256 valuation;       // USD value (6 decimals)
    uint256 valuationDate;   // Timestamp
    string documentHash;     // IPFS hash for verification
    bool isActive;
}
```

**Valuation Updates**:
- Only admin can update valuations
- Updates trigger health factor recalculation
- Users notified if position becomes liquidatable

### Interest Accrual

Borrowed USDC accrues interest at 5% APR (SeniorPool rate):

```
Daily Interest = (Principal × 0.05) / 365
Monthly Interest = (Principal × 0.05) / 12
```

**Example**:
- Borrow: $10,000 USDC
- 30 days interest: ($10,000 × 0.05 × 30) / 365 = $41.10
- Total to repay: $10,041.10

---

## Smart Contracts

### SolvencyVault.sol

**Location**: `packages/contracts/contracts/core/SolvencyVault.sol`

**Key State Variables**:
```solidity
mapping(uint256 => Position) public positions;
uint256 public nextPositionId;
ISeniorPool public seniorPool;
IPrimaryMarket public primaryMarket;

uint256 public constant RWA_LTV = 7000;              // 70%
uint256 public constant PRIVATE_ASSET_LTV = 6000;    // 60%
uint256 public constant LIQUIDATION_THRESHOLD = 11000; // 110%
uint256 public constant LIQUIDATION_DISCOUNT = 9000;  // 90% (10% discount)
```

**Core Functions**:

#### depositCollateral
```solidity
function depositCollateral(
    address token,
    uint256 amount,
    uint256 valueUSD,
    TokenType tokenType
) external returns (uint256 positionId)
```

**Parameters**:
- `token`: Address of RWA or PrivateAsset token
- `amount`: Token amount (18 decimals)
- `valueUSD`: USD valuation (6 decimals)
- `tokenType`: `TokenType.RWA` or `TokenType.PRIVATE_ASSET`

**Requirements**:
- Token must be approved for transfer
- Token must be whitelisted
- User must have KYC approval

#### borrowUSDC
```solidity
function borrowUSDC(
    uint256 positionId,
    uint256 amount
) external
```

**Parameters**:
- `positionId`: Position ID to borrow against
- `amount`: USDC amount to borrow (6 decimals)

**Requirements**:
- Position must be active
- Caller must be position owner
- New health factor must be ≥ 100%

#### repayLoan
```solidity
function repayLoan(
    uint256 positionId,
    uint256 amount
) external
```

**Parameters**:
- `positionId`: Position to repay
- `amount`: USDC repayment amount (6 decimals)

**Effects**:
- Reduces outstanding debt
- Improves health factor
- Transfers USDC to SeniorPool

#### withdrawCollateral
```solidity
function withdrawCollateral(
    uint256 positionId,
    uint256 amount
) external
```

**Parameters**:
- `positionId`: Position to withdraw from
- `amount`: Token amount to withdraw (18 decimals)

**Requirements**:
- Debt must be 0 (fully repaid)
- Position must be active

#### liquidatePosition
```solidity
function liquidatePosition(
    uint256 positionId
) external onlyAdmin
```

**Requirements**:
- Health factor < 110%
- Position active

**Effects**:
- Creates marketplace listing at 90% valuation
- Marks position as liquidating
- Emits liquidation event

### PrivateAssetToken.sol

**Location**: `packages/contracts/contracts/core/PrivateAssetToken.sol`

**Extends**: `RWAToken` (inherits compliance checks)

**Additional Features**:
```solidity
struct AssetMetadata {
    string assetType;
    string location;
    uint256 valuation;
    uint256 valuationDate;
    string documentHash;
    bool isActive;
}

mapping(bytes32 => AssetMetadata) public assetMetadata;

function updateValuation(
    bytes32 assetId,
    uint256 newValuation
) external onlyAdmin
```

**Metadata Management**:
- Platform mints tokens representing physical assets
- Each token has unique metadata
- Valuation tracked on-chain
- Document hash for off-chain verification

### OAID.sol

**Location**: `packages/contracts/contracts/integrations/OAID.sol`

**Purpose**: Issue verifiable credit lines for external protocols

**Credit Line Structure**:
```solidity
struct CreditLine {
    address user;
    address collateralToken;
    uint256 collateralAmount;
    uint256 creditLimit;        // Based on LTV
    uint256 creditUsed;
    uint256 solvencyPositionId; // Link to vault position
    bool active;
}
```

**Key Function**:
```solidity
function issueCreditLine(
    address user,
    address token,
    uint256 amount,
    uint256 valueUSD,
    uint256 positionId
) external returns (uint256 creditLineId)
```

**Integration**:
- Called by SolvencyVault when position created
- External protocols can verify credit availability
- Credit line remains active while collateral locked

---

## API Endpoints

### User Endpoints

#### POST /solvency/deposit
Deposit collateral tokens to create a position.

**Request**:
```json
{
  "tokenAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "amount": "1000000000000000000",  // 1 token (18 decimals)
  "valueUSD": "10000000000",         // $10,000 (6 decimals)
  "tokenType": "RWA"                 // or "PRIVATE_ASSET"
}
```

**Response**:
```json
{
  "success": true,
  "positionId": 1,
  "transaction": {
    "hash": "0xabc123...",
    "blockNumber": 12345678
  },
  "position": {
    "collateralAmount": "1000000000000000000",
    "maxBorrowUSDC": "7000000000",   // 70% LTV for RWA
    "healthFactor": 0                // No debt yet
  }
}
```

#### POST /solvency/borrow
Borrow USDC against existing position.

**Request**:
```json
{
  "positionId": 1,
  "amount": "5000000000"  // $5,000 USDC (6 decimals)
}
```

**Response**:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xdef456...",
    "blockNumber": 12345679
  },
  "position": {
    "outstandingDebt": "5000000000",
    "healthFactor": 20000,           // 200%
    "remainingBorrowCapacity": "2000000000"  // Can borrow $2k more
  }
}
```

#### POST /solvency/repay
Repay outstanding loan.

**Request**:
```json
{
  "positionId": 1,
  "amount": "5000000000"  // $5,000 USDC
}
```

**Response**:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xghi789...",
    "blockNumber": 12345680
  },
  "position": {
    "outstandingDebt": "0",
    "healthFactor": 0,  // No debt
    "fullyRepaid": true
  }
}
```

#### POST /solvency/withdraw
Withdraw collateral after full repayment.

**Request**:
```json
{
  "positionId": 1,
  "amount": "1000000000000000000"  // Withdraw all collateral
}
```

**Response**:
```json
{
  "success": true,
  "transaction": {
    "hash": "0xjkl012...",
    "blockNumber": 12345681
  },
  "withdrawn": "1000000000000000000",
  "positionClosed": true
}
```

#### GET /solvency/positions/my
Get all user positions.

**Query Parameters**:
- `status`: Filter by status (ACTIVE, LIQUIDATED, REPAID, CLOSED)
- `limit`: Results per page (default: 20)
- `offset`: Pagination offset (default: 0)

**Response**:
```json
{
  "positions": [
    {
      "positionId": 1,
      "collateralToken": {
        "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
        "symbol": "RWAT",
        "name": "RWA Token",
        "type": "RWA"
      },
      "collateralAmount": "1000000000000000000",
      "tokenValueUSD": "10000000000",
      "usdcBorrowed": "0",
      "outstandingDebt": "0",
      "healthFactor": 0,
      "healthStatus": "HEALTHY",
      "status": "ACTIVE",
      "maxBorrowCapacity": "7000000000",
      "createdAt": "2026-01-03T10:30:00Z"
    }
  ],
  "meta": {
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

#### GET /solvency/position/:id
Get detailed position information.

**Response**:
```json
{
  "positionId": 1,
  "userAddress": "0xCFCC97f7Ed394CB0a454345465996CC9f12F0e25",
  "collateralToken": {
    "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "symbol": "RWAT",
    "type": "RWA",
    "metadata": {
      "assetType": "INVOICE",
      "valuation": "10000000000",
      "valuationDate": "2026-01-01T00:00:00Z"
    }
  },
  "collateralAmount": "1000000000000000000",
  "tokenValueUSD": "10000000000",
  "usdcBorrowed": "5000000000",
  "outstandingDebt": "5041100000",  // Includes 30 days interest
  "interestAccrued": "41100000",
  "initialLTV": 7000,
  "currentLTV": 5041,
  "healthFactor": 19836,  // 198.36%
  "healthStatus": "HEALTHY",
  "status": "ACTIVE",
  "maxBorrowCapacity": "7000000000",
  "remainingBorrowCapacity": "1958900000",
  "createdAt": "2026-01-03T10:30:00Z",
  "lastRepaymentTime": null,
  "oaidCreditLine": {
    "creditLineId": 1,
    "creditLimit": "7000000000",
    "creditUsed": "5000000000",
    "creditAvailable": "2000000000"
  }
}
```

---

### Admin Endpoints

#### POST /admin/solvency/private-asset/mint
Mint new private asset token.

**Request**:
```json
{
  "name": "123 Main St Property Deed",
  "symbol": "DEED-001",
  "totalSupply": "1000000000000000000",  // 1 whole deed
  "assetType": "DEED",
  "location": "California, USA",
  "valuation": "500000000000",  // $500,000
  "documentHash": "QmX4H8Yp9kqZ...",  // IPFS hash
  "issuer": "0xIssuerAddress..."
}
```

**Response**:
```json
{
  "success": true,
  "assetId": "0x7d5a99f603f231d53a4f39d1521f98d2e8bb279cf29bebfd0687dc98458e7f89",
  "tokenAddress": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "transaction": {
    "hash": "0xmno345...",
    "blockNumber": 12345682
  },
  "metadata": {
    "assetType": "DEED",
    "location": "California, USA",
    "valuation": "500000000000",
    "valuationDate": "2026-01-04T00:00:00Z",
    "documentHash": "QmX4H8Yp9kqZ..."
  }
}
```

#### POST /admin/solvency/liquidate/:id
Trigger manual liquidation of unhealthy position.

**Request Body**: None (position ID in URL)

**Response**:
```json
{
  "success": true,
  "positionId": 1,
  "liquidation": {
    "collateralValue": "7000000000",
    "outstandingDebt": "7500000000",
    "healthFactor": 9333,  // 93.33%
    "liquidationPrice": "6300000000",  // 90% discount
    "marketplaceListingId": "0xpqr678..."
  },
  "transaction": {
    "hash": "0xstu901...",
    "blockNumber": 12345683
  }
}
```

#### GET /admin/solvency/liquidatable
Get all positions eligible for liquidation.

**Response**:
```json
{
  "positions": [
    {
      "positionId": 2,
      "userAddress": "0xUser123...",
      "collateralValue": "7000000000",
      "outstandingDebt": "7500000000",
      "healthFactor": 9333,
      "daysSinceWarning": 3,
      "recommendedAction": "LIQUIDATE"
    }
  ],
  "meta": {
    "total": 1,
    "criticalCount": 1,  // Health < 100%
    "warningCount": 0    // Health 100-110%
  }
}
```

#### POST /admin/solvency/private-asset/:assetId/update-valuation
Update private asset valuation.

**Request**:
```json
{
  "newValuation": "450000000000"  // $450,000
}
```

**Response**:
```json
{
  "success": true,
  "assetId": "0x7d5a99f603f231d53a4f39d1521f98d2e8bb279cf29bebfd0687dc98458e7f89",
  "oldValuation": "500000000000",
  "newValuation": "450000000000",
  "valuationDate": "2026-01-04T12:00:00Z",
  "affectedPositions": [
    {
      "positionId": 3,
      "oldHealthFactor": 11111,
      "newHealthFactor": 10000,
      "newStatus": "WARNING"
    }
  ]
}
```

#### POST /admin/solvency/approve-token
Approve token for vault deposits.

**Request**:
```json
{
  "tokenAddress": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "tokenType": "PRIVATE_ASSET"
}
```

**Response**:
```json
{
  "success": true,
  "tokenAddress": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  "approved": true
}
```

---

## Database Schemas

### SolvencyPosition

**Collection**: `solvencypositions`

```typescript
{
  positionId: number;                    // On-chain ID
  userAddress: string;                   // Indexed
  collateralTokenAddress: string;
  collateralTokenType: 'RWA' | 'PRIVATE_ASSET';
  collateralAmount: string;              // Wei (18 decimals)
  tokenValueUSD: string;                 // Wei (6 decimals)
  usdcBorrowed: string;                  // Wei (6 decimals)
  outstandingDebt: string;               // Including interest

  // LTV and Health
  initialLTV: number;                    // Basis points (7000 = 70%)
  currentLTV: number;                    // Current loan/value ratio
  currentHealthFactor: number;           // Basis points (10000 = 100%)
  healthStatus: 'HEALTHY' | 'WARNING' | 'LIQUIDATABLE';

  // Status
  status: 'ACTIVE' | 'LIQUIDATED' | 'REPAID' | 'CLOSED';

  // Repayment tracking
  totalRepaid: string;
  lastRepaymentTime?: Date;

  // Liquidation details
  liquidationTimestamp?: Date;
  liquidationTxHash?: string;
  marketplaceListingId?: string;
  liquidationPrice?: string;
  debtRecovered?: string;
  shortfall?: string;

  // OAID integration
  oaidCreditLineId?: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}
```

**Indexes**:
- `userAddress` (ascending)
- `status` (ascending)
- `healthStatus` (ascending)
- `positionId` (unique)

### PrivateAsset

**Collection**: `privateassets`

```typescript
{
  assetId: string;                       // bytes32 on-chain
  tokenAddress: string;                  // PrivateAssetToken address
  assetType: 'DEED' | 'BOND' | 'INVOICE' | 'EQUIPMENT' | 'OTHER';
  name: string;
  symbol: string;

  // Supply
  totalSupply: string;                   // Wei (18 decimals)

  // Valuation
  valuation: string;                     // USD (6 decimals)
  valuationDate: Date;
  valuationHistory: Array<{
    valuation: string;
    date: Date;
    updatedBy: string;
  }>;

  // Metadata
  location?: string;
  documentHash?: string;                 // IPFS hash
  documentUrl?: string;

  // Issuer
  issuer: string;                        // Wallet address

  // Status
  isActive: boolean;

  // Timestamps
  mintedAt: Date;
  updatedAt: Date;
}
```

**Indexes**:
- `assetId` (unique)
- `tokenAddress` (unique)
- `issuer` (ascending)
- `assetType` (ascending)

---

## Integration Guide

### 1. Frontend Integration

#### Initialize Web3 Connection
```typescript
import { ethers } from 'ethers';

const provider = new ethers.providers.Web3Provider(window.ethereum);
const signer = provider.getSigner();

// Contract ABIs
import SolvencyVaultABI from './abis/SolvencyVault.json';

const solvencyVault = new ethers.Contract(
  SOLVENCY_VAULT_ADDRESS,
  SolvencyVaultABI,
  signer
);
```

#### Deposit Collateral Flow
```typescript
async function depositCollateral(
  tokenAddress: string,
  amount: string,
  valueUSD: string,
  tokenType: 'RWA' | 'PRIVATE_ASSET'
) {
  // 1. Approve token spending
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const approveTx = await token.approve(SOLVENCY_VAULT_ADDRESS, amount);
  await approveTx.wait();

  // 2. Call backend API
  const response = await fetch('/api/solvency/deposit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`
    },
    body: JSON.stringify({
      tokenAddress,
      amount,
      valueUSD,
      tokenType
    })
  });

  const result = await response.json();
  return result.positionId;
}
```

#### Borrow USDC
```typescript
async function borrowUSDC(positionId: number, amount: string) {
  const response = await fetch('/api/solvency/borrow', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${jwt}`
    },
    body: JSON.stringify({ positionId, amount })
  });

  const result = await response.json();
  return result;
}
```

#### Monitor Health Factor
```typescript
async function monitorPosition(positionId: number) {
  const response = await fetch(`/api/solvency/position/${positionId}`, {
    headers: { 'Authorization': `Bearer ${jwt}` }
  });

  const position = await response.json();

  if (position.healthFactor < 11000 && position.healthFactor >= 10000) {
    // Warning: approaching liquidation
    showWarning('Your position is at risk. Consider repaying or adding collateral.');
  } else if (position.healthFactor < 10000) {
    // Critical: liquidatable
    showCritical('Your position may be liquidated! Repay immediately.');
  }

  return position;
}
```

### 2. Backend Service Integration

#### Listen for Liquidation Events
```typescript
// In solvency-blockchain.service.ts

async listenForLiquidations() {
  this.publicClient.watchContractEvent({
    address: this.solvencyVaultAddress,
    abi: SOLVENCY_VAULT_ABI,
    eventName: 'PositionLiquidated',
    onLogs: async (logs) => {
      for (const log of logs) {
        const { positionId, collateralValue, debt, listingId } = log.args;

        // Update database
        await this.positionService.markLiquidated(positionId, {
          listingId,
          collateralValue: collateralValue.toString(),
          outstandingDebt: debt.toString()
        });

        // Notify user
        await this.notificationService.create({
          userId: position.userAddress,
          walletAddress: position.userAddress,
          header: 'Position Liquidated',
          detail: `Your position #${positionId} was liquidated due to low health factor.`,
          type: NotificationType.LIQUIDATION,
          severity: NotificationSeverity.ERROR
        });
      }
    }
  });
}
```

#### Handle Marketplace Settlement
```typescript
// Listen for listing sales
async onListingSale(listingId: string, salePrice: string) {
  // Find position by listing ID
  const position = await this.positionModel.findOne({
    marketplaceListingId: listingId
  });

  if (!position) return;

  const debt = BigInt(position.outstandingDebt);
  const proceeds = BigInt(salePrice);

  if (proceeds >= debt) {
    // Full recovery + excess
    const excess = proceeds - debt;
    position.debtRecovered = debt.toString();
    position.status = 'LIQUIDATED';

    // Return excess to user
    if (excess > 0n) {
      await this.transferUSDC(position.userAddress, excess.toString());
    }
  } else {
    // Partial recovery - shortfall
    const shortfall = debt - proceeds;
    position.debtRecovered = proceeds.toString();
    position.shortfall = shortfall.toString();
    position.status = 'LIQUIDATED';
  }

  await position.save();
}
```

### 3. External Protocol Integration (OAID)

#### Verify Credit Line
```typescript
// External protocol calling OAID contract

import { ethers } from 'ethers';

const oaid = new ethers.Contract(OAID_ADDRESS, OAID_ABI, provider);

async function verifyCreditLine(userAddress: string) {
  const creditLine = await oaid.getCreditLine(userAddress);

  return {
    creditLimit: creditLine.creditLimit,
    creditUsed: creditLine.creditUsed,
    creditAvailable: creditLine.creditLimit - creditLine.creditUsed,
    collateralToken: creditLine.collateralToken,
    collateralAmount: creditLine.collateralAmount,
    active: creditLine.active
  };
}

async function canBorrow(userAddress: string, amount: bigint): Promise<boolean> {
  const creditLine = await oaid.getCreditLine(userAddress);
  const available = creditLine.creditLimit - creditLine.creditUsed;
  return amount <= available && creditLine.active;
}
```

---

## Security Considerations

### 1. Access Control
- **User Operations**: Only position owner can borrow, repay, or withdraw
- **Admin Operations**: Only platform admin can liquidate or mint private assets
- **Token Approvals**: Users must explicitly approve token spending

### 2. Valuation Risks
- Private asset valuations are admin-controlled (centralized risk)
- Conservative LTV ratios (60-70%) provide buffer
- Regular revaluation recommended for long-term positions
- Document hashes provide audit trail

### 3. Liquidation Risks
- Manual liquidation requires admin monitoring
- 10% discount ensures quick sales during liquidation
- Waterfall prioritizes debt recovery to SeniorPool
- Users notified at health < 125% to prevent liquidation

### 4. Smart Contract Risks
- SeniorPool integration creates dependency
- Reentrancy protection on all external calls
- Pausable functionality for emergency situations
- Time-locks on critical parameter changes

### 5. Oracle Risks
- Private asset valuations not oracle-based
- RWA token prices may need external price feeds
- Consider Chainlink or similar for RWA pricing

### 6. Compliance
- KYC required for all participants
- Private asset documents stored off-chain (IPFS)
- Audit trail for all valuations and liquidations
- Regulatory compliance varies by jurisdiction

---

## Monitoring and Maintenance

### Daily Tasks
1. Check positions with health < 125% (warning zone)
2. Monitor SeniorPool liquidity for borrowing capacity
3. Review marketplace activity for liquidated assets

### Weekly Tasks
1. Update private asset valuations (if applicable)
2. Review OAID credit line utilization
3. Analyze liquidation rates and bad debt

### Monthly Tasks
1. Audit position health across all users
2. Review LTV ratios and consider adjustments
3. Update documentation for any contract changes

### Emergency Procedures
1. **Critical Health Positions**: Notify users immediately
2. **Smart Contract Issues**: Pause vault if vulnerability detected
3. **Oracle Failure**: Manual valuation updates if price feeds fail
4. **Liquidity Crisis**: Coordinate with SeniorPool for emergency funding

---

## Support and Resources

**Smart Contract Addresses**:
- SolvencyVault: See `deployed_contracts.json`
- OAID: See `deployed_contracts.json`
- PrivateAssetToken: Deployed per-asset via TokenFactory

**API Base URL**:
- Production: `https://api.openassets.xyz`
- Development: `http://localhost:3000`

**Documentation**:
- Testing Guide: See `SOLVENCY_VAULT_TESTING_GUIDE.md`
- Contract Source: `packages/contracts/contracts/core/`
- Backend Source: `packages/backend/src/modules/solvency/`

**Support**:
- GitHub Issues: Report bugs and feature requests
- Developer Discord: Real-time support for integrations
