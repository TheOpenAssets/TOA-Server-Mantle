# SolvencyVault Integration Guide
**Complete End-to-End Lifecycle Documentation**

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [State Management](#state-management)
3. [Complete Lifecycle Flow](#complete-lifecycle-flow)
4. [Script Reference](#script-reference)
5. [MongoDB State Expectations](#mongodb-state-expectations)
6. [Event Flow](#event-flow)
7. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### Components
```
┌─────────────────────────────────────────────────────────────────┐
│                         USER SCRIPTS                             │
│  (deposit, borrow, repay, admin-mark-*, admin-liquidate, etc.)  │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER                              │
│  • SolvencyVault Contract (positions, collateral, loans)        │
│  • SeniorPool Contract (debt tracking, interest)                │
│  • YieldVault Contract (settlement for liquidations)            │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ (Emits Events)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT LISTENER SERVICE                        │
│  Watches: USDCBorrowed, LoanRepaid, MissedPaymentMarked,       │
│           PositionDefaulted, PositionLiquidated, etc.           │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ (Queues Jobs)
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EVENT PROCESSOR                               │
│  Processes events and updates MongoDB state                     │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MONGODB DATABASE                              │
│  Collection: solvencypositions                                   │
│  • Position metadata                                             │
│  • Loan details                                                  │
│  • Repayment schedule                                            │
│  • Health metrics                                                │
└─────────────────────────────────────────────────────────────────┘
```

### Sync Strategy

**Before Fix (❌ Broken)**:
- User scripts → Blockchain ✅
- Some scripts → Backend API (deposit, borrow, repay) ✅
- Admin scripts → Blockchain ONLY ❌ (MongoDB not updated)

**After Fix (✅ Working)**:
- All scripts → Blockchain ✅
- Blockchain → Events ✅
- Events → Event Listener ✅
- Event Listener → Event Processor ✅
- Event Processor → MongoDB ✅
- **Result**: MongoDB always synced automatically, regardless of which script is used

---

## State Management

### Blockchain State (Source of Truth)
**Contract**: `SolvencyVault.sol`

**Position Struct**:
```solidity
struct Position {
    address user;
    address collateralToken;
    uint256 collateralAmount;
    uint256 usdcBorrowed;
    uint256 tokenValueUSD;
    uint256 createdAt;
    bool active;
    TokenType tokenType;
}
```

**RepaymentPlan Struct**:
```solidity
struct RepaymentPlan {
    bool isActive;
    uint256 numberOfInstallments;
    uint256 installmentsPaid;
    uint256 installmentInterval;
    uint256 missedPayments;
    uint256 nextPaymentDue;
}
```

### MongoDB State (Synced Copy)
**Collection**: `solvencypositions`

**Key Fields**:
```typescript
{
  positionId: number,                    // Matches blockchain position ID
  userAddress: string,                   // Owner of position
  collateralTokenAddress: string,        // ERC20 token used as collateral
  collateralTokenType: 'RWA' | 'PRIVATE_ASSET' | 'INVOICE',
  collateralAmount: string,              // Wei amount
  tokenValueUSD: string,                 // USD value (6 decimals)
  usdcBorrowed: string,                  // Outstanding debt (6 decimals)
  initialLTV: number,                    // Basis points (e.g., 7000 = 70%)
  currentHealthFactor: number,           // Basis points (e.g., 15000 = 150%)
  healthStatus: 'HEALTHY' | 'WARNING' | 'LIQUIDATABLE',
  status: 'ACTIVE' | 'REPAID' | 'LIQUIDATED' | 'SETTLED' | 'CLOSED',

  // Loan details
  loanDuration: number,                  // Seconds
  numberOfInstallments: number,
  installmentInterval: number,           // Seconds
  installmentsPaid: number,
  missedPayments: number,
  nextPaymentDueDate: Date,

  // Repayment schedule
  repaymentSchedule: [{
    installmentNumber: number,
    dueDate: Date,
    amount: string,                      // USDC amount (6 decimals)
    status: 'PENDING' | 'PAID' | 'MISSED'
  }],

  // Flags
  isDefaulted: boolean,
  oaidCreditIssued: boolean,

  // Audit trail
  depositTxHash: string,
  depositBlockNumber: number,
  liquidationTxHash?: string,
  createdAt: Date,
  updatedAt: Date
}
```

---

## Complete Lifecycle Flow

### Phase 1: Deposit Collateral

**Script**: `scripts/deposit-to-solvency-vault.js`

**Command**:
```bash
INVESTOR_KEY=0x... node scripts/deposit-to-solvency-vault.js <asset_id> <amount>
```

**Example**:
```bash
INVESTOR_KEY=0x4dd8f6b5... node scripts/deposit-to-solvency-vault.js \
  aff1072c-24d6-463f-97de-2717557d3afd 100
```

**What Happens**:
1. ✅ Script authenticates with backend
2. ✅ Fetches asset details (token address, price)
3. ✅ Approves SolvencyVault to spend tokens
4. ✅ Calls `SolvencyVault.depositCollateral(amount, issueOAID)`
5. ✅ Blockchain emits `PositionCreated` event
6. ✅ Script syncs with backend `/solvency/position/sync`
7. ✅ MongoDB record created

**Blockchain State After**:
```solidity
Position {
  user: 0x580F5b09765E71D64613c8F4403234f8790DD7D3,
  collateralToken: 0xbC30793128bE54521cA80550D717382e9469e4ba,
  collateralAmount: 100000000000000000000,  // 100 tokens
  usdcBorrowed: 0,
  tokenValueUSD: 85000000,                  // $85.00 (6 decimals)
  createdAt: 1736318735,
  active: true,
  tokenType: INVOICE (2)
}

RepaymentPlan {
  isActive: false,
  numberOfInstallments: 0,
  installmentsPaid: 0,
  installmentInterval: 0,
  missedPayments: 0,
  nextPaymentDue: 0
}
```

**MongoDB Document After**:
```json
{
  "positionId": 1,
  "userAddress": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
  "collateralTokenAddress": "0xbC30793128bE54521cA80550D717382e9469e4ba",
  "collateralTokenType": "INVOICE",
  "collateralAmount": "100000000000000000000",
  "tokenValueUSD": "85000000",
  "usdcBorrowed": "0",
  "initialLTV": 6000,
  "currentHealthFactor": 2147483647,
  "healthStatus": "HEALTHY",
  "status": "ACTIVE",
  "totalRepaid": "0",
  "loanDuration": 0,
  "numberOfInstallments": 0,
  "installmentInterval": 0,
  "installmentsPaid": 0,
  "missedPayments": 0,
  "repaymentSchedule": [],
  "isDefaulted": false,
  "oaidCreditIssued": true,
  "depositTxHash": "0xa7f773f30df011d91b21f9578b19be2b4911746e986d86b186fc60211fcc5ea9",
  "depositBlockNumber": 33153741,
  "createdAt": "2026-01-08T07:05:35.542Z",
  "updatedAt": "2026-01-08T07:05:35.542Z"
}
```

---

### Phase 2: Borrow Against Collateral

**Script**: `scripts/borrow-solvency-loan.js`

**Command**:
```bash
INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js <position_id> <amount_usdc> <installments>
```

**Example**:
```bash
INVESTOR_KEY=0x4dd8f6b5... node scripts/borrow-solvency-loan.js 1 50 6
```

**What Happens**:
1. ✅ Script authenticates with backend
2. ✅ Fetches position details
3. ✅ Finds linked asset to determine maturity date
4. ✅ Calculates loan duration (asset.dueDate - now)
5. ✅ Calls `SolvencyVault.borrowUSDC(positionId, amount, duration, installments)`
6. ✅ Blockchain emits:
   - `USDCBorrowed(positionId, amount, totalDebt)`
   - `RepaymentPlanCreated(positionId, duration, installments, interval)`
7. ✅ **Event Listener** catches events
8. ✅ **Event Processor** updates MongoDB automatically

**Blockchain State After**:
```solidity
Position {
  user: 0x580F5b09765E71D64613c8F4403234f8790DD7D3,
  collateralToken: 0xbC30793128bE54521cA80550D717382e9469e4ba,
  collateralAmount: 100000000000000000000,
  usdcBorrowed: 50000000,                   // $50.00 borrowed ✅
  tokenValueUSD: 85000000,
  createdAt: 1736318735,
  active: true,
  tokenType: INVOICE (2)
}

RepaymentPlan {
  isActive: true,                           // ✅ Plan activated
  numberOfInstallments: 6,                  // ✅ 6 payments
  installmentsPaid: 0,
  installmentInterval: 356335,              // ✅ ~4.1 days
  missedPayments: 0,
  nextPaymentDue: 1736675070                // ✅ First payment due
}
```

**SeniorPool State**:
```solidity
outstandingDebt[1] = 50000000  // $50.00 principal
```

**MongoDB Document After** (🎉 **AUTO-SYNCED via Events**):
```json
{
  "positionId": 1,
  "userAddress": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
  "collateralTokenAddress": "0xbC30793128bE54521cA80550D717382e9469e4ba",
  "collateralTokenType": "INVOICE",
  "collateralAmount": "100000000000000000000",
  "tokenValueUSD": "85000000",
  "usdcBorrowed": "50000000",                    // ✅ UPDATED
  "initialLTV": 6000,
  "currentHealthFactor": 17000,                  // ✅ UPDATED (170%)
  "healthStatus": "HEALTHY",
  "status": "ACTIVE",
  "totalRepaid": "0",
  "loanDuration": 2138010,                       // ✅ UPDATED (~24.75 days)
  "numberOfInstallments": 6,                     // ✅ UPDATED
  "installmentInterval": 356335,                 // ✅ UPDATED (~4.1 days)
  "installmentsPaid": 0,
  "missedPayments": 0,
  "nextPaymentDueDate": "2026-01-12T18:11:10Z",  // ✅ UPDATED
  "repaymentSchedule": [                         // ✅ UPDATED
    {
      "installmentNumber": 1,
      "dueDate": "2026-01-12T18:11:10Z",
      "amount": "8333333",
      "status": "PENDING"
    },
    {
      "installmentNumber": 2,
      "dueDate": "2026-01-16T22:16:45Z",
      "amount": "8333333",
      "status": "PENDING"
    },
    // ... 4 more installments
  ],
  "isDefaulted": false,
  "oaidCreditIssued": true,
  "depositTxHash": "0xa7f773...",
  "depositBlockNumber": 33153741,
  "createdAt": "2026-01-08T07:05:35.542Z",
  "updatedAt": "2026-01-08T14:06:28.000Z"        // ✅ UPDATED
}
```

**Event Processing Logs**:
```
[EventListenerService] Watching SolvencyVault at 0x3b3d70...
[EventProcessor] Processing SolvencyVault borrow for position 1: borrowed 50000000, total debt 50000000
[SolvencyPositionService] Position 1 synced with blockchain
[EventProcessor] ✅ Position 1 synced after borrow event
[EventProcessor] Processing repayment plan for position 1: 6 installments, interval 356335s
[EventProcessor] ✅ Position 1 repayment plan updated
```

---

### Phase 3: Repay Installment

**Script**: `scripts/repay-solvency-loan.js`

**Command**:
```bash
INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js <position_id> <amount_usdc>
```

**Example**:
```bash
INVESTOR_KEY=0x4dd8f6b5... node scripts/repay-solvency-loan.js 1 17
```

**What Happens**:
1. ✅ Script authenticates with backend
2. ✅ Checks outstanding debt
3. ✅ Approves SeniorPool to spend USDC
4. ✅ Calls `SeniorPool.repayLoan(positionId, amount)`
5. ✅ Blockchain emits:
   - `LoanRepaid(positionId, amountPaid, principal, interest, remainingDebt)`
6. ✅ **Event Listener** catches event
7. ✅ **Event Processor** updates MongoDB

**Blockchain State After**:
```solidity
Position {
  usdcBorrowed: 33000000,  // $50 - $17 = $33 remaining ✅
  // ... other fields unchanged
}

RepaymentPlan {
  isActive: true,
  numberOfInstallments: 6,
  installmentsPaid: 1,      // ✅ Incremented
  installmentInterval: 356335,
  missedPayments: 0,
  nextPaymentDue: 1737031405  // ✅ Advanced to next installment
}
```

**SeniorPool State**:
```solidity
outstandingDebt[1] = 33000000  // $33.00 remaining
```

**MongoDB Document After** (🎉 **AUTO-SYNCED**):
```json
{
  "positionId": 1,
  "usdcBorrowed": "33000000",                    // ✅ UPDATED
  "totalRepaid": "17000000",                     // ✅ UPDATED
  "installmentsPaid": 1,                         // ✅ UPDATED
  "lastRepaymentTime": "2026-01-08T15:30:00Z",   // ✅ UPDATED
  "currentHealthFactor": 25757,                  // ✅ UPDATED (257%)
  "repaymentSchedule": [
    {
      "installmentNumber": 1,
      "dueDate": "2026-01-12T18:11:10Z",
      "amount": "8333333",
      "status": "PAID",                          // ✅ UPDATED
      "paidAt": "2026-01-08T15:30:00Z"           // ✅ ADDED
    },
    {
      "installmentNumber": 2,
      "dueDate": "2026-01-16T22:16:45Z",
      "amount": "8333333",
      "status": "PENDING"
    },
    // ... remaining installments
  ],
  "updatedAt": "2026-01-08T15:30:05.000Z"
}
```

**Event Processing Logs**:
```
[EventProcessor] Processing SolvencyVault repayment for position 1: paid 17000000, principal 16000000, interest 1000000
[SolvencyPositionService] Position 1 repaid 17000000, remaining debt: 33000000
[EventProcessor] ✅ Position 1 updated after repayment
```

---

### Phase 4: Admin Marks Missed Payment

**Script**: `scripts/admin-mark-missed-payment.js`

**Command** (Admin only):
```bash
ADMIN_KEY=0x... node scripts/admin-mark-missed-payment.js <position_id>
```

**Example**:
```bash
ADMIN_KEY=0x1d12932a... node scripts/admin-mark-missed-payment.js 1
```

**What Happens**:
1. ✅ Admin calls `SolvencyVault.markMissedPayment(positionId)` directly
2. ✅ Blockchain emits:
   - `MissedPaymentMarked(positionId, missedPayments)`
3. ✅ **Event Listener** catches event (🎉 **THIS IS THE FIX!**)
4. ✅ **Event Processor** updates MongoDB automatically

**Blockchain State After**:
```solidity
RepaymentPlan {
  isActive: true,
  numberOfInstallments: 6,
  installmentsPaid: 1,
  installmentInterval: 356335,
  missedPayments: 1,        // ✅ Incremented
  nextPaymentDue: 1737387740  // ✅ Advanced forward
}
```

**MongoDB Document After** (🎉 **AUTO-SYNCED - Previously Broken!**):
```json
{
  "positionId": 1,
  "missedPayments": 1,                           // ✅ UPDATED AUTOMATICALLY!
  "nextPaymentDueDate": "2026-01-20T23:22:20Z",  // ✅ UPDATED
  "repaymentSchedule": [
    {
      "installmentNumber": 1,
      "status": "PAID"
    },
    {
      "installmentNumber": 2,
      "dueDate": "2026-01-16T22:16:45Z",
      "amount": "8333333",
      "status": "MISSED"                         // ✅ UPDATED
    },
    {
      "installmentNumber": 3,
      "dueDate": "2026-01-20T23:22:20Z",
      "amount": "8333333",
      "status": "PENDING"
    },
    // ... remaining installments
  ],
  "updatedAt": "2026-01-08T16:45:00.000Z"
}
```

**Event Processing Logs**:
```
[EventProcessor] Processing missed payment for position 1: total missed = 1
[EventProcessor] ✅ Position 1 marked with 1 missed payments
```

**⚠️ Important**: This script does NOT call backend API. Before the fix, MongoDB was never updated. Now it's synced via events!

---

### Phase 5: Admin Marks Defaulted (3+ Missed)

**Script**: `scripts/admin-mark-defaulted.js`

**Command** (Admin only):
```bash
ADMIN_KEY=0x... node scripts/admin-mark-defaulted.js <position_id>
```

**Prerequisite**: Position must have 3+ missed payments

**What Happens**:
1. ✅ Admin calls `SolvencyVault.markDefaulted(positionId)`
2. ✅ Contract verifies `missedPayments >= 3`
3. ✅ Blockchain emits:
   - `PositionDefaulted(positionId)`
4. ✅ **Event Listener** catches event
5. ✅ **Event Processor** updates MongoDB

**Blockchain State After**:
```solidity
Position {
  active: true,  // Still active, but marked for liquidation
  // ... other fields
}

RepaymentPlan {
  isActive: false,     // ✅ Plan deactivated after default
  missedPayments: 3,
  // ... other fields
}
```

**MongoDB Document After** (🎉 **AUTO-SYNCED**):
```json
{
  "positionId": 1,
  "status": "ACTIVE",                            // Still ACTIVE (not liquidated yet)
  "isDefaulted": true,                           // ✅ UPDATED
  "missedPayments": 3,
  "healthStatus": "LIQUIDATABLE",
  "updatedAt": "2026-01-08T17:00:00.000Z"
}
```

**Event Processing Logs**:
```
[EventProcessor] Processing default for position 1
[EventProcessor] ✅ Position 1 marked as defaulted
```

---

### Phase 6: Admin Liquidates Position

**Script**: `scripts/admin-liquidate-position.js`

**Command** (Admin only):
```bash
ADMIN_KEY=0x... node scripts/admin-liquidate-position.js <position_id>
```

**What Happens**:
1. ✅ Script authenticates with backend
2. ✅ Generates unique marketplace listing ID
3. ✅ Calls `SolvencyVault.liquidatePosition(positionId, marketplaceListingId)`
4. ✅ Blockchain transfers collateral to YieldVault
5. ✅ Blockchain emits:
   - `PositionLiquidated(positionId, marketplaceListingId)`
6. ✅ **Event Listener** catches event
7. ✅ **Event Processor** updates MongoDB
8. ✅ Script also calls backend API `/admin/solvency/liquidate/:id`

**Blockchain State After**:
```solidity
Position {
  collateralAmount: 0,        // ✅ Collateral moved to YieldVault
  active: false,              // ✅ Position closed
  // ... other fields
}

// Collateral now held in YieldVault awaiting settlement
```

**MongoDB Document After** (🎉 **AUTO-SYNCED**):
```json
{
  "positionId": 1,
  "status": "LIQUIDATED",                        // ✅ UPDATED
  "collateralAmount": "0",                       // ✅ UPDATED
  "liquidationTimestamp": "2026-01-08T17:15:00Z", // ✅ ADDED
  "liquidationTxHash": "0x68292e25...",          // ✅ ADDED
  "marketplaceListingId": "0x1a2b3c...",         // ✅ ADDED
  "healthStatus": "LIQUIDATABLE",
  "updatedAt": "2026-01-08T17:15:05.000Z"
}
```

**Event Processing Logs**:
```
[EventProcessor] Processing liquidation for position 1
[SolvencyPositionService] Position 1 marked as liquidated
[EventProcessor] ✅ Position 1 marked as liquidated
```

---

### Phase 7: Settlement (Asset Maturity)

**Automatic Process** triggered by YieldDistributionService when asset matures.

**Manual Trigger** (Admin):
```bash
ADMIN_KEY=0x... node scripts/admin-settle-liquidation.js <position_id>
```

**What Happens**:
1. ✅ YieldVault receives settlement funds from issuer
2. ✅ Admin (or automated service) calls `SolvencyVault.settleLiquidation(positionId)`
3. ✅ Contract burns collateral tokens via YieldVault
4. ✅ Contract claims USDC yield
5. ✅ Contract repays debt to SeniorPool
6. ✅ Contract returns excess to user
7. ✅ Blockchain emits:
   - `LiquidationSettled(positionId, yieldReceived, debtRepaid, userRefund)`
8. ✅ **Event Listener** catches event
9. ✅ **Event Processor** updates MongoDB

**Blockchain State After**:
```solidity
Position {
  collateralAmount: 0,
  active: false,
  // Position fully closed
}

// SeniorPool debt = 0
// User receives refund if yield > debt
```

**MongoDB Document After** (🎉 **AUTO-SYNCED**):
```json
{
  "positionId": 1,
  "status": "SETTLED",                           // ✅ UPDATED
  "settledAt": "2026-02-02T14:18:00Z",           // ✅ ADDED
  "debtRecovered": "33000000",                   // ✅ ADDED (amount repaid to pool)
  "collateralAmount": "0",
  "usdcBorrowed": "0",                           // ✅ Debt cleared
  "updatedAt": "2026-02-02T14:18:05.000Z"
}
```

**Event Processing Logs**:
```
[EventProcessor] Processing liquidation settlement for position 1: yield 98500000, debt repaid 33000000, refund 65500000
[EventProcessor] ✅ Position 1 marked as settled
```

---

## Script Reference

### User Scripts (Investor Operations)

| Script | Purpose | Backend API Called? | Events Emitted | MongoDB Update |
|--------|---------|---------------------|----------------|----------------|
| `deposit-to-solvency-vault.js` | Deposit collateral, create position | ✅ Yes<br>`/solvency/position/sync` | `PositionCreated` | ✅ Via API + Events |
| `borrow-solvency-loan.js` | Borrow USDC against collateral | ❌ No | `USDCBorrowed`<br>`RepaymentPlanCreated` | ✅ Via Events |
| `repay-solvency-loan.js` | Make loan repayment | ❌ No | `LoanRepaid` | ✅ Via Events |

### Admin Scripts (Administrative Operations)

| Script | Purpose | Backend API Called? | Events Emitted | MongoDB Update |
|--------|---------|---------------------|----------------|----------------|
| `admin-mark-missed-payment.js` | Mark payment as missed | ❌ No<br>⚠️ **Use API Instead** | `MissedPaymentMarked` | ✅ Via Events ⭐ |
| `admin-mark-defaulted.js` | Mark position as defaulted | ❌ No<br>⚠️ **Use API Instead** | `PositionDefaulted` | ✅ Via Events ⭐ |
| `admin-liquidate-position.js` | Start liquidation process | ✅ Yes<br>`/admin/solvency/liquidate/:id` | `PositionLiquidated` | ✅ Via API + Events |
| `admin-settle-liquidation.js` | Settle liquidation | ❌ No<br>⚠️ **Use API Instead** | `LiquidationSettled` | ✅ Via Events ⭐ |
| `admin-purchase-liquidation.js` | Purchase liquidated private asset | ✅ Yes<br>`/admin/solvency/position/:id/purchase-liquidation` | `PrivateAssetLiquidationSettled` | ✅ Via API |

⭐ = **Previously broken**, now fixed with event listeners!

### NEW: Backend API Endpoints for Frontend Integration

For frontend integration, **use these backend endpoints instead of direct blockchain scripts**:

| Backend API Endpoint | Replaces Script | Method | Auth Required |
|---------------------|-----------------|--------|---------------|
| `POST /admin/solvency/position/:id/mark-missed-payment` | `admin-mark-missed-payment.js` | Backend API | Admin JWT |
| `POST /admin/solvency/position/:id/mark-defaulted` | `admin-mark-defaulted.js` | Backend API | Admin JWT |
| `POST /admin/solvency/liquidate/:id` | `admin-liquidate-position.js` | Backend API | Admin JWT |
| `POST /admin/solvency/position/:id/settle-liquidation` | `admin-settle-liquidation.js` | Backend API | Admin JWT |

**Why use backend endpoints?**
- ✅ No need to expose admin private keys in frontend
- ✅ Centralized admin operations with proper auth
- ✅ Automatic MongoDB sync via events
- ✅ Better error handling and logging
- ✅ Transaction signing handled server-side securely

See **[Frontend Integration Guide](./FRONTEND_INTEGRATION_GUIDE.md)** for complete implementation details.

---

## MongoDB State Expectations

### Quick Reference Table

| Operation | `status` | `usdcBorrowed` | `missedPayments` | `isDefaulted` | `loanDuration` | `numberOfInstallments` |
|-----------|----------|----------------|------------------|---------------|----------------|------------------------|
| **After Deposit** | `ACTIVE` | `"0"` | `0` | `false` | `0` | `0` |
| **After Borrow** | `ACTIVE` | `> 0` ✅ | `0` | `false` | `> 0` ✅ | `> 0` ✅ |
| **After Repayment** | `ACTIVE` | decreased ✅ | unchanged | `false` | unchanged | unchanged |
| **Full Repayment** | `REPAID` | `"0"` ✅ | any | `false` | unchanged | unchanged |
| **Missed Payment** | `ACTIVE` | unchanged | `+1` ✅ | `false` | unchanged | unchanged |
| **Marked Default** | `ACTIVE` | unchanged | `>= 3` | `true` ✅ | unchanged | unchanged |
| **Liquidated** | `LIQUIDATED` ✅ | unchanged | any | `true` | unchanged | unchanged |
| **Settled** | `SETTLED` ✅ | `"0"` ✅ | any | `true` | unchanged | unchanged |

### Position Status Flow

```
ACTIVE (deposit)
   │
   ├──[borrow]──→ ACTIVE (with debt)
   │                 │
   │                 ├──[repay partially]──→ ACTIVE (reduced debt)
   │                 │
   │                 ├──[repay fully]──→ REPAID
   │                 │
   │                 ├──[miss payment × 1-2]──→ ACTIVE (missedPayments++)
   │                 │
   │                 └──[miss payment × 3+]──→ ACTIVE (isDefaulted=true)
   │                                              │
   │                                              └──[liquidate]──→ LIQUIDATED
   │                                                                    │
   │                                                                    └──[settle]──→ SETTLED
   │
   └──[withdraw all]──→ CLOSED (no debt)
```

### Health Status Flow

```
HEALTHY (healthFactor > 125%)
   │
   └──[price drop/borrow more]──→ WARNING (110% < healthFactor <= 125%)
                                      │
                                      └──[price drop more]──→ LIQUIDATABLE (healthFactor < 110%)
```

---

## Event Flow

### Event-Driven Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   BLOCKCHAIN TRANSACTION                     │
│  (User Script or Admin Script calls contract function)      │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Transaction Confirmed
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                   SMART CONTRACT EMITS EVENT                 │
│  Example: MissedPaymentMarked(positionId=1, missedPayments=2)│
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ WebSocket/RPC Connection
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              EVENT LISTENER SERVICE (Backend)                │
│  File: event-listener.service.ts                            │
│  Method: watchSolvencyVault()                               │
│                                                              │
│  publicClient.watchContractEvent({                          │
│    eventName: 'MissedPaymentMarked',                        │
│    onLogs: async (logs) => {                                │
│      eventQueue.add('process-solvency-missed-payment', data)│
│    }                                                         │
│  })                                                          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Job Queued (BullMQ)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                EVENT PROCESSOR WORKER                        │
│  File: event.processor.ts                                   │
│  Method: processSolvencyMissedPayment(data)                 │
│                                                              │
│  1. Fetch position from MongoDB                             │
│  2. Update missedPayments counter                           │
│  3. Mark installment as MISSED in schedule                  │
│  4. Advance nextPaymentDueDate                              │
│  5. Save to MongoDB                                         │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ Database Write
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    MONGODB DATABASE                          │
│  Collection: solvencypositions                               │
│  Document updated: { positionId: 1, missedPayments: 2 }     │
└─────────────────────────────────────────────────────────────┘
```

### Events Mapped to Processors

| Blockchain Event | Event Processor | MongoDB Updates |
|------------------|-----------------|-----------------|
| `USDCBorrowed` | `processSolvencyBorrow()` | Full position sync via `syncPositionWithBlockchain()` |
| `LoanRepaid` | `processSolvencyRepayment()` | `usdcBorrowed`, `totalRepaid`, `installmentsPaid`, schedule status |
| `MissedPaymentMarked` | `processSolvencyMissedPayment()` | `missedPayments`, `nextPaymentDueDate`, schedule status |
| `PositionDefaulted` | `processSolvencyDefaulted()` | `isDefaulted`, `status` |
| `PositionLiquidated` | `processSolvencyLiquidated()` | `status`, `liquidationTxHash`, `marketplaceListingId` |
| `LiquidationSettled` | `processSolvencyLiquidationSettled()` | `status`, `settledAt`, `debtRecovered` |
| `CollateralWithdrawn` | `processSolvencyWithdrawal()` | `collateralAmount`, `status` (if fully withdrawn) |
| `RepaymentPlanCreated` | `processSolvencyRepaymentPlan()` | `loanDuration`, `numberOfInstallments`, `installmentInterval` |

---

## Troubleshooting

### Issue 1: MongoDB Not Updating After Admin Operations

**Symptoms**:
- Run `admin-mark-missed-payment.js` ✅ Transaction succeeds
- Check blockchain ✅ `missedPayments` = 1
- Check MongoDB ❌ `missedPayments` = 0

**Root Cause**: Event listener not running or not watching SolvencyVault

**Fix**:
1. Check backend logs for: `[EventListenerService] Watching SolvencyVault at 0x...`
2. If missing, restart backend
3. Verify `.env` has `SOLVENCY_VAULT_ADDRESS` set
4. Check that files were updated:
   - `event-listener.service.ts` (has `watchSolvencyVault()`)
   - `event.processor.ts` (has `processSolvency*` methods)
   - `blockchain.module.ts` (imports SolvencyModule)

---

### Issue 2: Events Processing But MongoDB Not Updating

**Symptoms**:
- Backend logs show: `[EventProcessor] Processing missed payment...`
- Backend logs show: `[EventProcessor] ✅ Position 1 marked...`
- MongoDB still not updated

**Root Cause**: Processor error (silently caught)

**Debug Steps**:
1. Check for error logs: `[EventProcessor] Failed to process...`
2. Verify MongoDB connection is healthy
3. Check that position exists: `db.solvencypositions.findOne({positionId: 1})`
4. Check BullMQ dashboard for failed jobs

---

### Issue 3: Wrong Contract Address

**Symptoms**:
- Deposit shows one SolvencyVault address
- Admin script uses different address
- Backend watching third address

**Root Cause**: Multiple contract deployments, `deployed_contracts.json` out of sync

**Fix**:
1. Check transaction receipt to find actual contract used:
   ```bash
   node scripts/check-vault-address.js
   ```
2. Update `.env` with correct address
3. Redeploy if needed for consistency

---

### Issue 4: Missing Loan Details After Borrow

**Symptoms**:
- After borrow, MongoDB shows:
  - `usdcBorrowed`: "0" (should be > 0)
  - `numberOfInstallments`: 0 (should be 6)

**Root Cause**: `RepaymentPlanCreated` event not processed

**Debug Steps**:
1. Check backend logs for `RepaymentPlanCreated` processing
2. Verify event signature matches contract:
   ```solidity
   event RepaymentPlanCreated(
     uint256 indexed positionId,
     uint256 loanDuration,
     uint256 numberOfInstallments,
     uint256 installmentInterval
   )
   ```
3. Manually sync: Call `/admin/solvency/position/:id/sync`

---

### Issue 5: Blockchain and MongoDB Out of Sync

**Symptoms**:
- Blockchain shows `missedPayments = 3`
- MongoDB shows `missedPayments = 0`

**Cause**: Events missed before listener was active

**Fix - Manual Sync**:

**Option A**: Use Admin Sync Endpoint
```bash
# Get admin JWT token first (authenticate as admin)
curl -X POST "http://localhost:3000/admin/solvency/position/1/sync" \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json"
```

**Option B**: Query Blockchain and Update Manually
```javascript
// Read from blockchain
const repaymentPlan = await solvencyVault.getRepaymentPlan(positionId);

// Update MongoDB
db.solvencypositions.updateOne(
  { positionId: 1 },
  {
    $set: {
      missedPayments: repaymentPlan.missedPayments,
      numberOfInstallments: repaymentPlan.numberOfInstallments,
      // ... other fields
    }
  }
);
```

**Option C**: Redeploy Position (Fresh Start)
```bash
# Withdraw, close position, start fresh
# New deposits will auto-sync correctly
```

---

## Frontend Integration

### For Frontend Developers

This document describes the backend integration and event flow. For **frontend implementation details**, see:

👉 **[Frontend Integration Guide](./FRONTEND_INTEGRATION_GUIDE.md)**

The frontend guide includes:
- ✅ Complete authentication flow (wallet signing)
- ✅ User operations (direct blockchain with Web3)
- ✅ Admin operations (backend API endpoints)
- ✅ React hooks and components examples
- ✅ Error handling and real-time updates
- ✅ Full API reference with request/response examples

### Integration Pattern

```
┌─────────────────────────────────────────────────────────┐
│                  FRONTEND APPLICATION                    │
└─────┬──────────────────────────────────────┬────────────┘
      │                                      │
      │ USER OPERATIONS                      │ ADMIN OPERATIONS
      │ (Direct Wallet)                      │ (Backend API)
      │                                      │
      ▼                                      ▼
┌────────────────┐                    ┌────────────────┐
│  Web3 Wallet   │                    │  Backend API   │
│  (MetaMask)    │                    │  (Admin JWT)   │
└────────┬───────┘                    └────────┬───────┘
         │                                     │
         │ Sign & Send TX                     │ Server-Side TX
         ▼                                     ▼
┌─────────────────────────────────────────────────────────┐
│                    BLOCKCHAIN LAYER                      │
│  • SolvencyVault    • SeniorPool    • YieldVault       │
└────────────────────────┬────────────────────────────────┘
                         │
                         │ Events Emitted
                         ▼
┌─────────────────────────────────────────────────────────┐
│              BACKEND EVENT LISTENERS                     │
│  (Automatic MongoDB Sync)                               │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  MONGODB DATABASE                        │
│  (Source of truth for frontend queries)                 │
└─────────────────────────────────────────────────────────┘
```

### Decision Matrix: Direct Wallet vs Backend API

| Operation | Integration Method | Reason |
|-----------|-------------------|--------|
| **Deposit Collateral** | 🟢 Direct Wallet (MetaMask) | User owns collateral tokens |
| **Borrow USDC** | 🟢 Direct Wallet (MetaMask) | User initiating loan |
| **Repay Loan** | 🟢 Direct Wallet (MetaMask) | User repaying their debt |
| **Withdraw Collateral** | 🟢 Direct Wallet (MetaMask) | User owns collateral |
| **Mark Missed Payment** | 🔵 Backend API (Admin JWT) | Admin-only operation |
| **Mark Defaulted** | 🔵 Backend API (Admin JWT) | Admin-only operation |
| **Liquidate Position** | 🔵 Backend API (Admin JWT) | Admin-only operation |
| **Settle Liquidation** | 🔵 Backend API (Admin JWT) | Admin-only operation |
| **Query Position** | 🔵 Backend API (JWT) | Read from MongoDB |

**Why this split?**
- **User operations** → Users must sign with their own wallet (they own the assets)
- **Admin operations** → Require admin private key (handled securely on backend, never exposed to frontend)
- **Queries** → Always use backend API (MongoDB is faster and has indexed data)

---

## Best Practices

### 1. Always Monitor Backend Logs
When testing, keep backend logs visible:
```bash
cd packages/backend
npm run start:dev

# Watch for:
# [EventListenerService] Watching SolvencyVault at 0x...
# [EventProcessor] Processing SolvencyVault borrow...
# [EventProcessor] ✅ Position 1 synced...
```

### 2. Verify Event Sync After Each Operation
```bash
# After any operation:
# 1. Check transaction succeeded on blockchain explorer
# 2. Wait 5-10 seconds for event processing
# 3. Query MongoDB to verify update
db.solvencypositions.findOne({positionId: 1}, {
  missedPayments: 1,
  usdcBorrowed: 1,
  status: 1,
  updatedAt: 1
})
```

### 3. Use Consistent Contract Addresses
Before any operation, verify contract addresses match:
```bash
# Check deployed contracts
cat packages/contracts/deployed_contracts.json | grep SolvencyVault

# Check .env
grep SOLVENCY_VAULT_ADDRESS packages/backend/.env

# They should match!
```

### 4. Test Event Flow in Development
```bash
# Minimal test flow
1. Restart backend (fresh event listeners)
2. Create new position (deposit)
3. Borrow against it
4. Check MongoDB - loan details should appear within 10 seconds
5. Mark missed payment (admin)
6. Check MongoDB - missedPayments should increment within 10 seconds
```

---

## Summary

### Key Takeaways

1. **Event-Driven Sync**: MongoDB updates happen automatically via blockchain events
2. **No Manual Sync Needed**: Admin scripts don't need to call backend APIs
3. **Real-Time Updates**: Events processed within seconds of blockchain confirmation
4. **Audit Trail**: All events logged with transaction hashes
5. **Self-Healing**: System stays in sync even if backend restarts (events still fire)

### What Changed

**Before Fix**:
- ❌ Admin scripts → Blockchain ONLY
- ❌ MongoDB manually updated (or not at all)
- ❌ Frequent desync issues

**After Fix**:
- ✅ All scripts → Blockchain
- ✅ Blockchain → Events → MongoDB (automatic)
- ✅ Always in sync

### Critical Files

| File | Purpose | What It Does |
|------|---------|--------------|
| `event-listener.service.ts` | Event Detection | Watches blockchain for SolvencyVault events |
| `event.processor.ts` | Event Processing | Updates MongoDB when events fire |
| `blockchain.module.ts` | Module Wiring | Connects EventProcessor to SolvencyPositionService |

---

**Last Updated**: 2026-01-08
**Version**: 1.0 (Event-Driven Architecture)
