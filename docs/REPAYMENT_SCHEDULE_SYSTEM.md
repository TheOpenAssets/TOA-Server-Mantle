# Repayment Schedule System

## Overview
When a user borrows USDC against collateral in SolvencyVault, they can choose from structured repayment plans with fixed installments and different interest rates based on the loan term.

## Repayment Terms

| Term | Monthly Installments | Annual Interest Rate | Monthly Interest Rate |
|------|---------------------|---------------------|----------------------|
| 3 months | 3 | 12% | 1.0% |
| 6 months | 6 | 15% | 1.25% |
| 12 months | 12 | 18% | 1.5% |
| 18 months | 18 | 24% | 2.0% |

**Note:** Lower terms = lower interest, Higher terms = higher interest

## Payment Schedule Calculation

### Example: $1000 USDC borrowed for 6 months at 15% APR

```
Principal: $1000
Total Interest: $1000 × 15% = $150
Total Amount: $1150
Monthly Payment: $1150 / 6 = $191.67
```

### Due Dates
- Payment 1: 30 days from borrow
- Payment 2: 60 days from borrow
- Payment 3: 90 days from borrow
- ... and so on

### Late Payment Penalty
- Grace period: 3 days after due date
- Late payment marked if paid after grace period
- Days late tracked in OAID payment history

## OAID Credit Score Impact

### Payment History Scoring (0-1000 points)
```
Base Score = (On-time Payments / Total Payments) × 800

Volume Bonus = min(Total Payments / 10, 20) × 10
  (Up to +200 points for 20+ payments)

Liquidation Penalty = Number of Liquidations × -200
  (Max -400 points)

Final Score = Base Score + Volume Bonus + Liquidation Penalty
```

### Score Breakdown
- **800-1000**: Excellent - Perfect or near-perfect payment history
- **600-799**: Good - Mostly on-time, few late payments
- **400-599**: Fair - Multiple late payments
- **200-399**: Poor - Frequent late payments or 1 liquidation
- **0-199**: Very Poor - Multiple liquidations

## Workflow

### 1. Borrowing with Repayment Plan
```typescript
POST /solvency/borrow
{
  "positionId": 1,
  "amount": "1000000000", // $1000 USDC (6 decimals)
  "repaymentTerm": 6      // 6 months
}

Response:
{
  "schedule": {
    "totalAmount": "1150000000",
    "monthlyPayment": "191666667",
    "numberOfPayments": 6,
    "interestRate": 1.25,
    "payments": [
      { "paymentNumber": 1, "dueDate": "2026-02-07", "amount": "191666667" },
      { "paymentNumber": 2, "dueDate": "2026-03-07", "amount": "191666667" },
      ...
    ]
  }
}
```

### 2. Making Payments
```typescript
POST /solvency/repay
{
  "positionId": 1,
  "amount": "191666667"  // Pay one installment
}

// Backend checks:
// - Is this payment on time?
// - How many days late (if any)?
// - Records in OAID via recordPayment()
```

### 3. Checking Payment Status
```typescript
GET /solvency/position/1/schedule

Response:
{
  "schedule": {
    "totalDue": "1150000000",
    "totalPaid": "383333334",
    "remaining": "766666666",
    "payments": [
      {
        "paymentNumber": 1,
        "amount": "191666667",
        "dueDate": "2026-02-07",
        "paidAt": "2026-02-05",
        "status": "PAID_ON_TIME"
      },
      {
        "paymentNumber": 2,
        "amount": "191666667",
        "dueDate": "2026-03-07",
        "paidAt": "2026-03-12",
        "status": "PAID_LATE",
        "daysLate": 5
      },
      {
        "paymentNumber": 3,
        "amount": "191666667",
        "dueDate": "2026-04-07",
        "status": "UPCOMING"
      },
      ...
    ]
  }
}
```

### 4. OAID Credit Report
```typescript
GET /solvency/oaid/my-credit

Response:
{
  "creditLines": [...],
  "creditScore": 750,
  "paymentHistory": {
    "totalPayments": 12,
    "onTimePayments": 10,
    "latePayments": 2,
    "averageDaysLate": 3.5,
    "liquidations": 0
  },
  "activeDebts": [
    {
      "positionId": 1,
      "principalBorrowed": "1000000000",
      "totalDue": "1150000000",
      "paid": "383333334",
      "remaining": "766666666",
      "nextPaymentDue": "2026-04-07",
      "nextPaymentAmount": "191666667"
    }
  ]
}
```

## Database Schema Updates

### RepaymentSchedule Schema
```typescript
{
  positionId: number,
  principalAmount: string,        // Original borrow amount
  interestAmount: string,         // Total interest
  totalAmount: string,            // Principal + Interest
  repaymentTerm: number,          // 3, 6, 12, or 18 months
  monthlyPayment: string,         // Amount per installment
  startDate: Date,                // Borrow date
  
  payments: [{
    paymentNumber: number,
    dueDate: Date,
    amount: string,
    paidAt?: Date,
    paidAmount?: string,
    status: 'PENDING' | 'PAID_ON_TIME' | 'PAID_LATE' | 'OVERDUE',
    daysLate: number
  }]
}
```

## Smart Contract Updates

### SolvencyVault - Track Repayment Schedule
```solidity
struct RepaymentPlan {
    uint256 totalAmount;        // Principal + Interest
    uint256 monthlyPayment;     // Payment per period
    uint256 paymentsRemaining;  // Installments left
    uint256 nextPaymentDue;     // Unix timestamp
    uint256 termMonths;         // 3, 6, 12, or 18
}

mapping(uint256 => RepaymentPlan) public repaymentPlans;
```

## Implementation Priority

1. ✅ OAID payment recording (Already implemented)
2. ✅ OAID credit score calculation (Already implemented)
3. 🔄 Backend: Repayment schedule schema
4. 🔄 Backend: Borrow endpoint updates (accept repaymentTerm)
5. 🔄 Backend: Calculate interest and installments
6. 🔄 Backend: Track payment status (on-time vs late)
7. 🔄 Backend: Update OAID endpoint to show active debts
8. 🔄 Smart Contract: Store repayment plan on-chain
9. 🔄 Smart Contract: Validate payments against schedule

## Benefits

1. **Predictable Payments**: Users know exactly how much to pay and when
2. **Credit Building**: Consistent on-time payments improve OAID score
3. **Flexible Terms**: Choose term based on cash flow needs
4. **Transparent Interest**: Clear interest rates, no surprises
5. **Automated Tracking**: Backend tracks everything, OAID records history
