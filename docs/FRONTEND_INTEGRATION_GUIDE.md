# Frontend Integration Guide - SolvencyVault
**Complete Frontend to Backend Integration Documentation**

---

## Table of Contents
1. [Integration Architecture](#integration-architecture)
2. [Authentication Flow](#authentication-flow)
3. [User Operations (Wallet-Based)](#user-operations-wallet-based)
4. [Admin Operations (Backend API)](#admin-operations-backend-api)
5. [API Endpoints Reference](#api-endpoints-reference)
6. [Frontend Implementation Examples](#frontend-implementation-examples)
7. [State Management](#state-management)
8. [Error Handling](#error-handling)
9. [Real-Time Updates](#real-time-updates)

---

## Integration Architecture

### Two Integration Patterns

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND APPLICATION                         │
└─────┬───────────────────────────────────────────────┬───────────┘
      │                                               │
      │ USER OPERATIONS                               │ ADMIN OPERATIONS
      │ (Wallet Direct)                               │ (Backend API)
      ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│   Web3 Wallet   │                           │  Backend API    │
│  (MetaMask)     │                           │  (Admin Auth)   │
└────────┬────────┘                           └────────┬────────┘
         │                                             │
         │ Sign & Send TX                             │ Signed Admin TX
         ▼                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                        BLOCKCHAIN                                │
│  • SolvencyVault                                                 │
│  • SeniorPool                                                    │
│  • YieldVault                                                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Events Emitted
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   BACKEND EVENT LISTENERS                        │
│  (Automatic MongoDB Sync)                                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      MONGODB DATABASE                            │
│  (Source of truth for frontend queries)                         │
└─────────────────────────────────────────────────────────────────┘
```

### Decision Matrix: Direct vs Backend API

| Operation | Method | Reason | Auth Required |
|-----------|--------|--------|---------------|
| **Deposit Collateral** | 🟢 Direct Wallet | User owns collateral | MetaMask |
| **Borrow USDC** | 🟢 Direct Wallet | User taking loan | MetaMask |
| **Repay Loan** | 🟢 Direct Wallet | User repaying debt | MetaMask |
| **Withdraw Collateral** | 🟢 Direct Wallet | User owns collateral | MetaMask |
| **Mark Missed Payment** | 🔵 Backend API | Admin-only operation | JWT Admin Token |
| **Mark Defaulted** | 🔵 Backend API | Admin-only operation | JWT Admin Token |
| **Liquidate Position** | 🔵 Backend API | Admin-only operation | JWT Admin Token |
| **Settle Liquidation** | 🔵 Backend API | Admin-only operation | JWT Admin Token |
| **Query Position** | 🔵 Backend API | Read from MongoDB | JWT Token |

---

## Authentication Flow

### 1. User Authentication (Investors)

**Flow**:
```typescript
// Step 1: Request challenge
const challengeResponse = await fetch(
  `${BACKEND_URL}/auth/challenge?walletAddress=${address}&role=INVESTOR`
);
const { message, nonce } = await challengeResponse.json();

// Step 2: Sign challenge with wallet
const signature = await signer.signMessage(message);

// Step 3: Login
const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    walletAddress: address,
    message,
    signature,
  }),
});

const { tokens, user } = await loginResponse.json();
// Store tokens.access for subsequent API calls
```

### 2. Admin Authentication (Originators)

**Flow**:
```typescript
// Step 1: Request challenge (as ORIGINATOR role)
const challengeResponse = await fetch(
  `${BACKEND_URL}/auth/challenge?walletAddress=${adminAddress}&role=ORIGINATOR`
);
const { message, nonce } = await challengeResponse.json();

// Step 2: Sign with admin wallet
const signature = await adminSigner.signMessage(message);

// Step 3: Login
const loginResponse = await fetch(`${BACKEND_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    walletAddress: adminAddress,
    message,
    signature,
  }),
});

const { tokens, user } = await loginResponse.json();
// Store tokens.access - this gives admin privileges
```

---

## User Operations (Wallet-Based)

### Operation 1: Deposit Collateral

**When**: User wants to create a position by depositing RWA tokens

**Implementation**:
```typescript
async function depositCollateral(
  assetId: string,
  amount: string, // In token decimals
  signer: ethers.Signer,
  jwtToken: string
) {
  // Step 1: Get asset details from backend
  const assetResponse = await fetch(
    `${BACKEND_URL}/assets/${assetId}`,
    {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    }
  );
  const { asset } = await assetResponse.json();
  const tokenAddress = asset.token.address;

  // Step 2: Approve SolvencyVault to spend tokens
  const tokenContract = new ethers.Contract(
    tokenAddress,
    ERC20_ABI,
    signer
  );

  const approvalTx = await tokenContract.approve(
    SOLVENCY_VAULT_ADDRESS,
    amount
  );
  await approvalTx.wait();

  // Step 3: Deposit collateral
  const solvencyVault = new ethers.Contract(
    SOLVENCY_VAULT_ADDRESS,
    SOLVENCY_VAULT_ABI,
    signer
  );

  const depositTx = await solvencyVault.depositCollateral(
    amount,
    true // issueOAID
  );
  const receipt = await depositTx.wait();

  // Step 4: Extract position ID from event
  const positionCreatedEvent = receipt.logs.find(
    log => log.topics[0] === ethers.id('PositionCreated(uint256,address,address,uint256,uint256,uint256,bool)')
  );
  const positionId = ethers.toNumber('0x' + positionCreatedEvent.topics[1].slice(26));

  // Step 5: Sync with backend (optional - event listener will do it automatically)
  await fetch(
    `${BACKEND_URL}/solvency/position/${positionId}/sync`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    }
  );

  return {
    positionId,
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
  };
}
```

**UI Flow**:
1. User selects asset and enters amount
2. Show approval loading state
3. Request approval transaction (MetaMask popup)
4. Wait for approval confirmation
5. Show deposit loading state
6. Request deposit transaction (MetaMask popup)
7. Wait for deposit confirmation
8. Show success with position ID
9. Redirect to position detail page

**Expected State Changes**:
- MongoDB: New document created with `status: 'ACTIVE'`, `collateralAmount: amount`, `usdcBorrowed: '0'`

---

### Operation 2: Borrow USDC

**When**: User wants to borrow USDC against their collateral

**Implementation**:
```typescript
async function borrowUSDC(
  positionId: number,
  amountUSDC: string, // In USDC (6 decimals)
  numberOfInstallments: number,
  signer: ethers.Signer,
  jwtToken: string
) {
  // Step 1: Get position details
  const positionResponse = await fetch(
    `${BACKEND_URL}/solvency/position/${positionId}`,
    {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    }
  );
  const { position } = await positionResponse.json();

  // Step 2: Get asset to determine maturity date
  const assetResponse = await fetch(
    `${BACKEND_URL}/assets/token/${position.collateralTokenAddress}`,
    {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    }
  );
  const { asset } = await assetResponse.json();

  // Step 3: Calculate loan duration
  const dueDate = new Date(asset.metadata.dueDate);
  const now = new Date();
  const durationSeconds = Math.floor((dueDate.getTime() - now.getTime()) / 1000);

  if (durationSeconds <= 0) {
    throw new Error('Asset has already matured');
  }

  // Step 4: Borrow USDC
  const solvencyVault = new ethers.Contract(
    SOLVENCY_VAULT_ADDRESS,
    SOLVENCY_VAULT_ABI,
    signer
  );

  const borrowTx = await solvencyVault.borrowUSDC(
    positionId,
    ethers.parseUnits(amountUSDC, 6), // USDC has 6 decimals
    durationSeconds,
    numberOfInstallments
  );
  const receipt = await borrowTx.wait();

  // Step 5: Parse USDCBorrowed event
  const borrowedEvent = receipt.logs.find(
    log => log.topics[0] === ethers.id('USDCBorrowed(uint256,uint256,uint256)')
  );
  // Event listener will automatically sync MongoDB

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    amountBorrowed: amountUSDC,
    installments: numberOfInstallments,
    maturityDate: dueDate,
  };
}
```

**UI Flow**:
1. User enters borrow amount and installments
2. Show calculated payment schedule
3. Request borrow transaction (MetaMask popup)
4. Show loading state with progress
5. Wait for confirmation
6. Show success with loan details
7. Poll backend for updated position data (or use real-time updates)

**Expected State Changes**:
- MongoDB: `usdcBorrowed` updated, `loanDuration`, `numberOfInstallments`, `repaymentSchedule` populated
- Within 5-10 seconds via event listener

---

### Operation 3: Repay Loan

**When**: User wants to make a payment towards their loan

**Implementation**:
```typescript
async function repayLoan(
  positionId: number,
  amountUSDC: string, // In USDC (6 decimals)
  signer: ethers.Signer,
  jwtToken: string
) {
  // Step 1: Get position to find SeniorPool address
  const positionResponse = await fetch(
    `${BACKEND_URL}/solvency/position/${positionId}`,
    {
      headers: { 'Authorization': `Bearer ${jwtToken}` }
    }
  );
  const { position } = await positionResponse.json();

  // Step 2: Get SeniorPool address from SolvencyVault
  const solvencyVault = new ethers.Contract(
    SOLVENCY_VAULT_ADDRESS,
    SOLVENCY_VAULT_ABI,
    signer
  );
  const seniorPoolAddress = await solvencyVault.seniorPool();

  // Step 3: Approve SeniorPool to spend USDC
  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    ERC20_ABI,
    signer
  );

  const approvalTx = await usdcContract.approve(
    seniorPoolAddress,
    ethers.parseUnits(amountUSDC, 6)
  );
  await approvalTx.wait();

  // Step 4: Repay loan
  const seniorPool = new ethers.Contract(
    seniorPoolAddress,
    SENIOR_POOL_ABI,
    signer
  );

  const repayTx = await seniorPool.repayLoan(
    positionId,
    ethers.parseUnits(amountUSDC, 6)
  );
  const receipt = await repayTx.wait();

  // Event listener will automatically sync MongoDB

  return {
    txHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    amountPaid: amountUSDC,
  };
}
```

**UI Flow**:
1. Show current debt and payment schedule
2. User enters repayment amount
3. Request approval transaction (MetaMask popup)
4. Wait for approval
5. Request repayment transaction (MetaMask popup)
6. Show loading state
7. Wait for confirmation
8. Show success with updated debt
9. Poll for updated position (or use real-time updates)

**Expected State Changes**:
- MongoDB: `usdcBorrowed` decreased, `totalRepaid` increased, `installmentsPaid` incremented, schedule updated
- Within 5-10 seconds via event listener

---

## Admin Operations (Backend API)

### Operation 1: Mark Missed Payment

**When**: Admin detects a missed payment (usually automated cron job triggers this)

**Endpoint**: `POST /admin/solvency/position/:id/mark-missed-payment`

**Implementation**:
```typescript
async function markMissedPayment(
  positionId: number,
  adminJwtToken: string
) {
  const response = await fetch(
    `${BACKEND_URL}/admin/solvency/position/${positionId}/mark-missed-payment`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminJwtToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to mark missed payment');
  }

  const result = await response.json();
  return result;
}
```

**Response**:
```json
{
  "success": true,
  "message": "Missed payment marked successfully",
  "txHash": "0x68292e25603030e829f2da56c9dcf1e95abd45a2bab24d6358b37f4d2464afb0",
  "positionId": 1
}
```

**UI Flow** (Admin Dashboard):
1. Admin dashboard shows positions with overdue payments
2. Click "Mark as Missed" button
3. Show confirmation modal
4. Call API endpoint
5. Show loading state
6. Display success message
7. Position automatically updates (event listener syncs)

**Expected State Changes**:
- MongoDB: `missedPayments` incremented, `nextPaymentDueDate` advanced, schedule status changed to 'MISSED'
- Instant via API + Event sync

---

### Operation 2: Mark Defaulted

**When**: Position has 3+ missed payments

**Endpoint**: `POST /admin/solvency/position/:id/mark-defaulted`

**Implementation**:
```typescript
async function markDefaulted(
  positionId: number,
  adminJwtToken: string
) {
  const response = await fetch(
    `${BACKEND_URL}/admin/solvency/position/${positionId}/mark-defaulted`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminJwtToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to mark as defaulted');
  }

  const result = await response.json();
  return result;
}
```

**Response**:
```json
{
  "success": true,
  "message": "Position marked as defaulted",
  "txHash": "0x...",
  "positionId": 1
}
```

**UI Flow**:
1. Admin sees warning indicator on position (3+ missed payments)
2. Click "Mark as Defaulted" button
3. Show warning modal explaining implications
4. Confirm action
5. Call API endpoint
6. Show loading state
7. Display success message
8. Position status updates to show default

**Expected State Changes**:
- MongoDB: `isDefaulted: true`, `status` remains 'ACTIVE' (awaiting liquidation)
- Instant via API + Event sync

---

### Operation 3: Liquidate Position

**When**: Position is defaulted or health factor < 110%

**Endpoint**: `POST /admin/solvency/liquidate/:id`

**Implementation**:
```typescript
async function liquidatePosition(
  positionId: number,
  adminJwtToken: string
) {
  const response = await fetch(
    `${BACKEND_URL}/admin/solvency/liquidate/${positionId}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminJwtToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to liquidate position');
  }

  const result = await response.json();
  return result;
}
```

**Response**:
```json
{
  "success": true,
  "txHash": "0x...",
  "blockNumber": 33155749,
  "marketplaceAssetId": "0x1a2b3c4d...",
  "discountedPrice": "76500000",
  "position": { /* updated position object */ }
}
```

**UI Flow**:
1. Admin dashboard shows liquidatable positions (health < 110% OR defaulted)
2. Click "Liquidate" button on position
3. Show liquidation details modal:
   - Current collateral value
   - Outstanding debt
   - Liquidation discount (10%)
4. Confirm liquidation
5. Call API endpoint
6. Show loading state ("Transferring collateral to yield vault...")
7. Display success with marketplace listing ID
8. Position updates to 'LIQUIDATED' status

**Expected State Changes**:
- MongoDB: `status: 'LIQUIDATED'`, `liquidationTxHash`, `marketplaceListingId`, `collateralAmount: '0'` (moved to YieldVault)
- Instant via API + Event sync

---

### Operation 4: Settle Liquidation

**When**: Asset matures and issuer deposits settlement funds

**Endpoint**: `POST /admin/solvency/position/:id/settle-liquidation`

**Implementation**:
```typescript
async function settleLiquidation(
  positionId: number,
  adminJwtToken: string
) {
  const response = await fetch(
    `${BACKEND_URL}/admin/solvency/position/${positionId}/settle-liquidation`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminJwtToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to settle liquidation');
  }

  const result = await response.json();
  return result;
}
```

**Response**:
```json
{
  "success": true,
  "message": "Liquidation settled successfully",
  "txHash": "0x34b6782e16dab23be3385422a704c14922143e4ceab1993b4319672572677f73",
  "positionId": 1,
  "yieldReceived": "98500000",
  "debtRepaid": "33000000",
  "liquidationFee": "1500000",
  "userRefund": "64000000"
}
```

**UI Flow**:
1. After asset matures, admin sees liquidated positions ready for settlement
2. Click "Settle Liquidation" button
3. Show settlement breakdown modal:
   - Total yield received: $98.50
   - Debt repaid to pool: $33.00
   - Liquidation fee: $1.50
   - User refund: $64.00
4. Confirm settlement
5. Call API endpoint
6. Show loading state ("Burning tokens and claiming yield...")
7. Display success with settlement details
8. Position updates to 'SETTLED' status

**Expected State Changes**:
- MongoDB: `status: 'SETTLED'`, `settledAt`, `debtRecovered`, `usdcBorrowed: '0'`
- Instant via API + Event sync

---

## API Endpoints Reference

### User Endpoints (Requires JWT Token)

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/solvency/my-positions` | GET | Get all user's positions | JWT |
| `/solvency/position/:id` | GET | Get single position details | JWT |
| `/solvency/position/:id/stats` | GET | Get position statistics | JWT |
| `/solvency/oaid/credit-lines` | GET | Get OAID credit lines | JWT |
| `/assets/:id` | GET | Get asset details | JWT |
| `/assets/token/:address` | GET | Find asset by token address | JWT |

### Admin Endpoints (Requires Admin JWT Token)

| Endpoint | Method | Purpose | Request Body | Response |
|----------|--------|---------|--------------|----------|
| `/admin/solvency/positions` | GET | Get all positions | - | `{ positions: [...] }` |
| `/admin/solvency/liquidatable` | GET | Get liquidatable positions | - | `{ positions: [...] }` |
| `/admin/solvency/warnings` | GET | Get positions with warnings | - | `{ positions: [...] }` |
| `/admin/solvency/position/:id/sync` | POST | Manually sync position | - | `{ position: {...} }` |
| `/admin/solvency/position/:id/mark-missed-payment` | POST | Mark payment as missed | - | `{ txHash, positionId }` |
| `/admin/solvency/position/:id/mark-defaulted` | POST | Mark position defaulted | - | `{ txHash, positionId }` |
| `/admin/solvency/liquidate/:id` | POST | Liquidate position | - | `{ txHash, marketplaceAssetId, position }` |
| `/admin/solvency/position/:id/settle-liquidation` | POST | Settle liquidation | - | `{ txHash, yieldReceived, debtRepaid, userRefund }` |

### Authentication Endpoints

| Endpoint | Method | Purpose | Request Body | Response |
|----------|--------|---------|--------------|----------|
| `/auth/challenge` | GET | Get signing challenge | `?walletAddress=0x...&role=INVESTOR` | `{ message, nonce }` |
| `/auth/login` | POST | Login with signature | `{ walletAddress, message, signature }` | `{ tokens, user }` |

---

## Frontend Implementation Examples

### React Hook: usePosition

```typescript
import { useState, useEffect } from 'react';
import { ethers } from 'ethers';

interface Position {
  positionId: number;
  userAddress: string;
  collateralAmount: string;
  usdcBorrowed: string;
  status: string;
  missedPayments: number;
  healthStatus: string;
  // ... other fields
}

export function usePosition(positionId: number) {
  const [position, setPosition] = useState<Position | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPosition = async () => {
    try {
      setLoading(true);
      const jwtToken = localStorage.getItem('jwt_token');

      const response = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/solvency/position/${positionId}`,
        {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch position');
      }

      const data = await response.json();
      setPosition(data.position);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPosition();

    // Poll every 10 seconds for updates
    const interval = setInterval(fetchPosition, 10000);

    return () => clearInterval(interval);
  }, [positionId]);

  return { position, loading, error, refetch: fetchPosition };
}
```

### React Hook: useBorrow

```typescript
import { useState } from 'react';
import { ethers } from 'ethers';
import { useSigner } from 'wagmi'; // Or your Web3 library

export function useBorrow() {
  const { data: signer } = useSigner();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const borrowUSDC = async (
    positionId: number,
    amountUSDC: string,
    numberOfInstallments: number
  ) => {
    try {
      setLoading(true);
      setError(null);

      const jwtToken = localStorage.getItem('jwt_token');

      // Step 1: Get position details
      const positionResponse = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/solvency/position/${positionId}`,
        {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }
      );
      const { position } = await positionResponse.json();

      // Step 2: Get asset for maturity date
      const assetResponse = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/assets/token/${position.collateralTokenAddress}`,
        {
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }
      );
      const { asset } = await assetResponse.json();

      // Step 3: Calculate duration
      const dueDate = new Date(asset.metadata.dueDate);
      const now = new Date();
      const durationSeconds = Math.floor((dueDate.getTime() - now.getTime()) / 1000);

      if (durationSeconds <= 0) {
        throw new Error('Asset has already matured');
      }

      // Step 4: Borrow
      const solvencyVault = new ethers.Contract(
        process.env.REACT_APP_SOLVENCY_VAULT_ADDRESS!,
        SOLVENCY_VAULT_ABI,
        signer!
      );

      const tx = await solvencyVault.borrowUSDC(
        positionId,
        ethers.parseUnits(amountUSDC, 6),
        durationSeconds,
        numberOfInstallments
      );

      const receipt = await tx.wait();

      return {
        success: true,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
      };
    } catch (err: any) {
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { borrowUSDC, loading, error };
}
```

### React Component: PositionCard

```typescript
import React from 'react';
import { usePosition } from '../hooks/usePosition';
import { ethers } from 'ethers';

interface PositionCardProps {
  positionId: number;
}

export function PositionCard({ positionId }: PositionCardProps) {
  const { position, loading, error, refetch } = usePosition(positionId);

  if (loading) return <div>Loading position...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!position) return <div>Position not found</div>;

  const collateralAmount = ethers.formatEther(position.collateralAmount);
  const usdcBorrowed = ethers.formatUnits(position.usdcBorrowed, 6);
  const healthFactor = (position.currentHealthFactor / 100).toFixed(2);

  return (
    <div className="position-card">
      <div className="position-header">
        <h3>Position #{positionId}</h3>
        <span className={`status-badge status-${position.status.toLowerCase()}`}>
          {position.status}
        </span>
      </div>

      <div className="position-stats">
        <div className="stat">
          <label>Collateral</label>
          <value>{collateralAmount} tokens</value>
        </div>

        <div className="stat">
          <label>Borrowed</label>
          <value>${usdcBorrowed} USDC</value>
        </div>

        <div className="stat">
          <label>Health Factor</label>
          <value className={position.healthStatus.toLowerCase()}>
            {healthFactor}%
          </value>
        </div>

        <div className="stat">
          <label>Missed Payments</label>
          <value className={position.missedPayments > 0 ? 'warning' : ''}>
            {position.missedPayments} / 3
          </value>
        </div>
      </div>

      {position.isDefaulted && (
        <div className="alert alert-danger">
          ⚠️ Position is defaulted and may be liquidated
        </div>
      )}

      <button onClick={refetch}>Refresh</button>
    </div>
  );
}
```

### Admin Dashboard: LiquidatablePositions

```typescript
import React, { useState, useEffect } from 'react';

export function LiquidatablePositions() {
  const [positions, setPositions] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchLiquidatablePositions = async () => {
    const jwtToken = localStorage.getItem('admin_jwt_token');

    const response = await fetch(
      `${process.env.REACT_APP_BACKEND_URL}/admin/solvency/liquidatable`,
      {
        headers: { 'Authorization': `Bearer ${jwtToken}` }
      }
    );

    const data = await response.json();
    setPositions(data.positions);
  };

  const handleLiquidate = async (positionId: number) => {
    if (!confirm(`Liquidate position ${positionId}?`)) return;

    setLoading(true);
    try {
      const jwtToken = localStorage.getItem('admin_jwt_token');

      const response = await fetch(
        `${process.env.REACT_APP_BACKEND_URL}/admin/solvency/liquidate/${positionId}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${jwtToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const result = await response.json();

      if (result.success) {
        alert(`Liquidation successful!\nTX: ${result.txHash}`);
        fetchLiquidatablePositions(); // Refresh list
      } else {
        alert(`Liquidation failed: ${result.message}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiquidatablePositions();
  }, []);

  return (
    <div className="liquidatable-positions">
      <h2>Liquidatable Positions ({positions.length})</h2>

      <table>
        <thead>
          <tr>
            <th>Position ID</th>
            <th>User</th>
            <th>Collateral</th>
            <th>Debt</th>
            <th>Health Factor</th>
            <th>Missed Payments</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos: any) => (
            <tr key={pos.positionId}>
              <td>{pos.positionId}</td>
              <td>{pos.userAddress.slice(0, 6)}...{pos.userAddress.slice(-4)}</td>
              <td>{ethers.formatEther(pos.collateralAmount)}</td>
              <td>${ethers.formatUnits(pos.usdcBorrowed, 6)}</td>
              <td className={pos.healthStatus.toLowerCase()}>
                {(pos.currentHealthFactor / 100).toFixed(2)}%
              </td>
              <td>{pos.missedPayments}</td>
              <td>
                <button
                  onClick={() => handleLiquidate(pos.positionId)}
                  disabled={loading}
                  className="btn-danger"
                >
                  Liquidate
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

---

## State Management

### Recommended Approach: React Query

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Query: Fetch position
export function usePositionQuery(positionId: number) {
  return useQuery({
    queryKey: ['position', positionId],
    queryFn: async () => {
      const jwtToken = localStorage.getItem('jwt_token');
      const response = await fetch(
        `${API_URL}/solvency/position/${positionId}`,
        { headers: { 'Authorization': `Bearer ${jwtToken}` } }
      );
      const data = await response.json();
      return data.position;
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
  });
}

// Mutation: Mark missed payment (admin)
export function useMarkMissedPaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (positionId: number) => {
      const jwtToken = localStorage.getItem('admin_jwt_token');
      const response = await fetch(
        `${API_URL}/admin/solvency/position/${positionId}/mark-missed-payment`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${jwtToken}` }
        }
      );
      return response.json();
    },
    onSuccess: (data, positionId) => {
      // Invalidate and refetch position
      queryClient.invalidateQueries({ queryKey: ['position', positionId] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
  });
}

// Usage in component
function AdminPositionActions({ positionId }: { positionId: number }) {
  const { data: position } = usePositionQuery(positionId);
  const markMissedPayment = useMarkMissedPaymentMutation();

  const handleMarkMissed = async () => {
    try {
      await markMissedPayment.mutateAsync(positionId);
      toast.success('Missed payment marked successfully');
    } catch (error) {
      toast.error('Failed to mark missed payment');
    }
  };

  return (
    <button
      onClick={handleMarkMissed}
      disabled={markMissedPayment.isPending}
    >
      {markMissedPayment.isPending ? 'Marking...' : 'Mark Missed Payment'}
    </button>
  );
}
```

---

## Error Handling

### Common Errors and Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| `Unauthorized (401)` | JWT token expired or invalid | Re-authenticate user |
| `Position not found (404)` | Position ID doesn't exist | Check position ID, verify sync |
| `Position not active` | Position already closed/settled | Check position status first |
| `Insufficient collateral` | Trying to borrow too much | Check `maxBorrow` before borrowing |
| `User rejected transaction` | MetaMask popup rejected | Prompt user to try again |
| `Transaction reverted` | Blockchain validation failed | Parse revert reason, show to user |
| `Asset already matured` | Trying to borrow after due date | Check asset maturity date first |

### Error Handler Utility

```typescript
export function handleAPIError(error: any) {
  if (error.response) {
    // API returned error response
    const status = error.response.status;
    const message = error.response.data?.message || 'Unknown error';

    switch (status) {
      case 401:
        // Redirect to login
        window.location.href = '/login';
        return 'Session expired. Please login again.';

      case 403:
        return 'You do not have permission to perform this action.';

      case 404:
        return 'Resource not found.';

      case 500:
        return 'Server error. Please try again later.';

      default:
        return message;
    }
  } else if (error.code === 'ACTION_REJECTED') {
    return 'Transaction was rejected.';
  } else if (error.code === 'CALL_EXCEPTION') {
    return 'Transaction would fail. Please check your inputs.';
  } else {
    return error.message || 'An unexpected error occurred.';
  }
}
```

---

## Real-Time Updates

### Option 1: Polling (Simple)

```typescript
useEffect(() => {
  const interval = setInterval(() => {
    refetchPosition();
  }, 10000); // Every 10 seconds

  return () => clearInterval(interval);
}, []);
```

### Option 2: WebSocket (Advanced)

```typescript
import { useEffect } from 'react';
import io from 'socket.io-client';

export function usePositionUpdates(positionId: number, onUpdate: (position: any) => void) {
  useEffect(() => {
    const socket = io(process.env.REACT_APP_BACKEND_URL!);

    socket.emit('subscribe', { positionId });

    socket.on('position:updated', (data) => {
      if (data.positionId === positionId) {
        onUpdate(data.position);
      }
    });

    return () => {
      socket.emit('unsubscribe', { positionId });
      socket.disconnect();
    };
  }, [positionId, onUpdate]);
}

// Usage
function PositionDetail({ positionId }: { positionId: number }) {
  const { data: position, refetch } = usePositionQuery(positionId);

  usePositionUpdates(positionId, () => {
    refetch(); // Refetch when update received
  });

  return <PositionCard position={position} />;
}
```

---

## Summary

### Integration Checklist

**For User Operations** (Direct Wallet):
- ✅ Implement Web3 wallet connection (wagmi/ethers)
- ✅ Get contract ABIs and addresses
- ✅ Handle approval transactions before deposits/repayments
- ✅ Parse events from transaction receipts
- ✅ Poll backend for updated state after transactions

**For Admin Operations** (Backend API):
- ✅ Implement admin authentication flow
- ✅ Store admin JWT token securely
- ✅ Call backend endpoints for admin actions
- ✅ Handle API responses and errors
- ✅ Update UI immediately after API calls

**For All Operations**:
- ✅ Implement proper error handling
- ✅ Show loading states during transactions
- ✅ Display transaction hashes and explorer links
- ✅ Implement real-time updates (polling or WebSocket)
- ✅ Cache data with React Query or similar
- ✅ Handle edge cases (expired tokens, network errors, etc.)

### Key Principles

1. **User operations = Direct blockchain** (user owns assets)
2. **Admin operations = Backend API** (admin privileges required)
3. **MongoDB is source of truth** for frontend queries
4. **Events auto-sync** MongoDB with blockchain
5. **Always poll or use WebSocket** for real-time updates
6. **Error handling is critical** for good UX

---

**Last Updated**: 2026-01-08
**Version**: 1.0 (Backend API Integration)
