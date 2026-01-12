# Loan Sync Implementation Summary

**Date**: 2026-01-11
**Issue**: Backend database not syncing with on-chain loan transactions

---

## Problem

When users borrowed or repaid loans directly via smart contracts (using scripts), the backend database was not updated. This caused:

1. **Stale Data**: `usdcBorrowed` remained at "0" even after borrowing
2. **Missing Loan Details**: `loanDuration`, `numberOfInstallments`, `repaymentSchedule` were not populated
3. **No Repayment Tracking**: Repayments didn't update `totalRepaid` or mark installments as paid

**Example**: Position showing `usdcBorrowed: "0"` even though user borrowed and repaid on-chain.

---

## Solution

Created **loan notification endpoints** that frontend/scripts call after on-chain transactions to sync the backend database.

---

## Implementation

### 1. New DTOs

**`NotifyLoanBorrowDto`** ([notify-loan-borrow.dto.ts](packages/backend/src/modules/solvency/dto/notify-loan-borrow.dto.ts)):
```typescript
{
  txHash: string;           // Transaction hash
  positionId: string;       // Position ID
  borrowAmount: string;     // USDC borrowed (6 decimals)
  loanDuration: string;     // Duration in seconds
  numberOfInstallments: string;
  blockNumber?: string;
}
```

**`NotifyLoanRepaymentDto`** ([notify-loan-repayment.dto.ts](packages/backend/src/modules/solvency/dto/notify-loan-repayment.dto.ts)):
```typescript
{
  txHash: string;
  positionId: string;
  repaymentAmount: string;  // USDC repaid (6 decimals)
  blockNumber?: string;
}
```

### 2. Service Methods

**[solvency-position.service.ts](packages/backend/src/modules/solvency/services/solvency-position.service.ts:552-625)**

**`notifyLoanBorrow()`**:
- Verifies position belongs to user
- Calls `recordBorrow()` to update database
- Updates: `usdcBorrowed`, `loanDuration`, `numberOfInstallments`, `repaymentSchedule`
- Calculates and stores repayment schedule

**`notifyLoanRepayment()`**:
- Verifies position belongs to user
- Calls `recordRepayment()` to update database
- Updates: `usdcBorrowed`, `totalRepaid`, `installmentsPaid`, schedule status
- Marks position as REPAID if fully paid

### 3. Controller Endpoints

**[solvency.controller.ts](packages/backend/src/modules/solvency/controllers/solvency.controller.ts:527-559)**

**`POST /solvency/loan/borrow-notify`**
```typescript
@Post('loan/borrow-notify')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
async notifyLoanBorrow(@Request() req: any, @Body() dto: NotifyLoanBorrowDto)
```

**`POST /solvency/loan/repay-notify`**
```typescript
@Post('loan/repay-notify')
@HttpCode(HttpStatus.OK)
@UseGuards(JwtAuthGuard)
async notifyLoanRepayment(@Request() req: any, @Body() dto: NotifyLoanRepaymentDto)
```

### 4. Updated Scripts

**[borrow-solvency-loan.js](scripts/borrow-solvency-loan.js:262-296)**

Added `notifyBackendOfBorrow()` function:
- Called automatically after successful borrow transaction
- Sends loan details to backend
- Syncs database with on-chain state

**[repay-solvency-loan.js](scripts/repay-solvency-loan.js:237-270)**

Updated `syncRepaymentWithBackend()` function:
- Calls `/solvency/loan/repay-notify` endpoint
- Syncs repayment with backend database

---

## Usage

### Borrow Flow

1. **User borrows via contract**:
```bash
INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js 1 50 6
```

2. **Script automatically**:
   - Executes `borrowUSDC()` on-chain
   - Calls `POST /solvency/loan/borrow-notify`
   - Syncs loan details to database

3. **Backend updates**:
   - `usdcBorrowed`: "50000000" (50 USDC)
   - `loanDuration`: calculated from asset maturity
   - `numberOfInstallments`: 6
   - `repaymentSchedule`: array of 6 installments with due dates

### Repay Flow

1. **User repays via contract**:
```bash
INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js 1 10
```

2. **Script automatically**:
   - Executes `repayLoan()` on-chain
   - Calls `POST /solvency/loan/repay-notify`
   - Syncs repayment to database

3. **Backend updates**:
   - `usdcBorrowed`: reduced by principal amount
   - `totalRepaid`: increased by repayment amount
   - `installmentsPaid`: incremented
   - `repaymentSchedule[0].status`: marked as "PAID"
   - `status`: "REPAID" if fully paid

### Frontend Integration

```typescript
// After user borrows
const response = await fetch('/solvency/loan/borrow-notify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    txHash: borrowTxHash,
    positionId: "1",
    borrowAmount: "50000000",
    loanDuration: "2592000",
    numberOfInstallments: "6",
    blockNumber: receipt.blockNumber.toString()
  })
});

// After user repays
const response = await fetch('/solvency/loan/repay-notify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${userToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    txHash: repayTxHash,
    positionId: "1",
    repaymentAmount: "10000000",
    blockNumber: receipt.blockNumber.toString()
  })
});
```

---

## Security

- **Authentication**: Both endpoints require `JwtAuthGuard`
- **Authorization**: Verifies position belongs to authenticated user
- **Validation**: DTOs validate all input parameters
- **Optional TX Verification**: Comments indicate where on-chain verification can be added

---

## Benefits

1. **Real-time Sync**: Database immediately updated after transactions
2. **Accurate Data**: Frontend/backend show same state as blockchain
3. **Repayment Tracking**: Full schedule with installment status
4. **No Event Indexer Required**: Works without blockchain event listeners
5. **User-Friendly**: Automatic sync in scripts, easy frontend integration

---

## Testing

### Test Borrow Notification

```bash
# 1. Borrow loan (automatically syncs)
INVESTOR_KEY=0x... node scripts/borrow-solvency-loan.js 1 50 6

# 2. Check database - should show:
# - usdcBorrowed: "50000000"
# - loanDuration: set
# - numberOfInstallments: 6
# - repaymentSchedule: 6 installments
```

### Test Repayment Notification

```bash
# 1. Repay loan (automatically syncs)
INVESTOR_KEY=0x... node scripts/repay-solvency-loan.js 1 10

# 2. Check database - should show:
# - usdcBorrowed: reduced
# - totalRepaid: increased
# - installmentsPaid: incremented
# - repaymentSchedule[0].status: "PAID"
```

---

## Related Fixes

This implementation follows the same pattern as:
- `/marketplace/purchases/notify` - Purchase notifications
- `/marketplace/bids/notify` - Bid notifications
- `/marketplace/bids/settle-notify` - Settlement notifications
- `/solvency/sync-position` - Position sync (fixed to upsert instead of always creating)

---

## Files Changed

### Backend
- ✅ `dto/notify-loan-borrow.dto.ts` - New DTO
- ✅ `dto/notify-loan-repayment.dto.ts` - New DTO
- ✅ `services/solvency-position.service.ts` - Added notify methods
- ✅ `controllers/solvency.controller.ts` - Added endpoints

### Scripts
- ✅ `borrow-solvency-loan.js` - Added backend sync
- ✅ `repay-solvency-loan.js` - Added backend sync

---

## Future Enhancements

1. **On-Chain Verification**: Add transaction verification in notify methods
2. **Event Indexer**: Optional blockchain event listener as backup
3. **Webhooks**: Notify external systems of loan events
4. **Batch Sync**: Endpoint to sync multiple positions at once

---

**Status**: ✅ Complete and working
**Build**: ✅ Successful
**Ready for**: Testing and deployment
