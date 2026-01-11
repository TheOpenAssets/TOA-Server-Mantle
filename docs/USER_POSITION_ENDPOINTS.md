# User Position Endpoints - Quick Reference

**Version:** 1.0
**Date:** 2026-01-10

---

## 🎯 Overview

These endpoints allow users to view their solvency positions, including collateral, borrows, repayment schedules, and partner loans.

**Authentication:** All endpoints require user JWT token in Authorization header.

---

## 📍 Available Endpoints

### 1. Get All My Positions
```
GET /solvency/positions/my
```

**Returns:** All positions (active + closed) for authenticated user

**Authentication:** User JWT (INVESTOR role)

**Example:**
```bash
# Get token
USER_TOKEN=$(INVESTOR_KEY=0x4dd8f... node scripts/get-user-token.js)

# Get all positions
curl http://localhost:3000/solvency/positions/my \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "positions": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "positionId": 1,
      "userAddress": "0x580f5b09765e71d64613c8f4403234f8790dd7d3",
      "collateralTokenAddress": "0xabc123...",
      "collateralTokenType": "RWA",
      "collateralAmount": "1000000000000000000",
      "tokenValueUSD": "100000000000",
      "borrowed": "50000000000",
      "totalRepaid": "10000000000",
      "outstandingDebt": "40000000000",
      "status": "ACTIVE",
      "healthFactor": 2.5,
      "oaidIssued": true,
      "oaidTokenId": 1,
      "partnerLoans": [
        {
          "partnerId": "partner_xyz_001",
          "partnerLoanId": "uuid-123",
          "borrowedAmount": "10000000000",
          "active": true
        }
      ],
      "totalPartnerDebt": "10000000000",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "depositTxHash": "0xdef456...",
      "depositBlockNumber": 12345678
    }
  ]
}
```

---

### 2. Get My Active Positions Only
```
GET /solvency/positions/my/active
```

**Returns:** Only positions with status = "ACTIVE"

**Example:**
```bash
curl http://localhost:3000/solvency/positions/my/active \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "positions": [
    {
      "positionId": 1,
      "status": "ACTIVE",
      ...
    }
  ]
}
```

---

### 3. Get Specific Position Details
```
GET /solvency/position/:id
```

**Returns:** Detailed stats for a single position (includes on-chain data)

**Parameters:**
- `:id` - Position ID (number)

**Example:**
```bash
curl http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "position": {
    "positionId": 1,
    "userAddress": "0x580f5b...",
    "collateralTokenAddress": "0xabc123...",
    "collateralAmount": "1000000000000000000",
    "borrowed": "50000000000",
    "status": "ACTIVE",
    "healthFactor": 2.5,
    ...
  },
  "onChainData": {
    "user": "0x580f5b...",
    "collateralToken": "0xabc123...",
    "collateralAmount": "1000000000000000000",
    "usdcBorrowed": "50000000000",
    "tokenValueUSD": "100000000000",
    "createdAt": 1704067200,
    "active": true,
    "tokenType": 0
  },
  "healthFactor": 2.5,
  "maxBorrow": "70000000000",
  "outstandingDebt": "40000000000"
}
```

---

### 4. Get Position Repayment Schedule
```
GET /solvency/position/:id/schedule
```

**Returns:** Loan repayment plan and schedule details

**Parameters:**
- `:id` - Position ID (number)

**Example:**
```bash
curl http://localhost:3000/solvency/position/1/schedule \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "positionId": 1,
  "schedule": {
    "loanDuration": 2592000,
    "numberOfInstallments": 6,
    "installmentInterval": 432000,
    "nextPaymentDue": 1736553600,
    "installmentsPaid": 2,
    "missedPayments": 0,
    "isActive": true,
    "details": [
      {
        "installmentNumber": 1,
        "dueDate": "2026-01-15T00:00:00.000Z",
        "amount": "8333333333",
        "principal": "8000000000",
        "interest": "333333333",
        "status": "PAID",
        "paidAt": "2026-01-14T10:00:00.000Z"
      },
      {
        "installmentNumber": 2,
        "dueDate": "2026-01-20T00:00:00.000Z",
        "amount": "8333333333",
        "principal": "8000000000",
        "interest": "333333333",
        "status": "PENDING"
      }
    ]
  },
  "outstandingDebt": "40000000000"
}
```

---

### 5. Get My OAID Credit Lines
```
GET /solvency/oaid/my-credit
```

**Returns:** All OAID credit lines for the user

**Example:**
```bash
curl http://localhost:3000/solvency/oaid/my-credit \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "userAddress": "0x580f5b...",
  "totalCreditLimit": "100000000000",
  "totalCreditUsed": "50000000000",
  "totalAvailableCredit": "50000000000",
  "creditLines": [
    {
      "creditLineId": 1,
      "collateralToken": "0xabc123...",
      "collateralAmount": "1000000000000000000",
      "creditLimit": "70000000000",
      "creditUsed": "50000000000",
      "availableCredit": "20000000000",
      "solvencyPositionId": 1,
      "issuedAt": 1704067200,
      "active": true
    }
  ],
  "summary": {
    "activeCreditLines": 1,
    "totalCreditLines": 1,
    "utilizationRate": "50.00%"
  }
}
```

---

### 6. Get All My Partner Loans
```
GET /solvency/partner-loans/my
```

**Returns:** All loans borrowed through partner platforms

**Example:**
```bash
curl http://localhost:3000/solvency/partner-loans/my \
  -H "Authorization: Bearer $USER_TOKEN"
```

**Response:**
```json
{
  "success": true,
  "count": 2,
  "loans": [
    {
      "partnerLoanId": "xyz_loan_001",
      "internalLoanId": "uuid-123",
      "partnerId": "partner_xyz_001",
      "partnerName": "XYZ Lending",
      "userWallet": "0x580f5b...",
      "oaidTokenId": 1,
      "solvencyPositionId": 1,
      "principalAmount": "10000000000",
      "remainingDebt": "5000000000",
      "totalRepaid": "5000000000",
      "status": "ACTIVE",
      "borrowedAt": "2026-01-01T00:00:00.000Z",
      "repaymentHistory": [
        {
          "amount": "5000000000",
          "timestamp": "2026-01-05T00:00:00.000Z",
          "txHash": "0xdef456...",
          "repaidBy": "PARTNER"
        }
      ]
    }
  ]
}
```

---

## 🧪 Quick Testing

### Step 1: Get User Token

```bash
# Create token helper
INVESTOR_KEY=0x4dd8f6b570ebcabdb4c4b8d702b66c6efbaaff1f8f8ba9a79983115a02a38b04 \
node scripts/get-user-token.js

# Or save to variable
export USER_TOKEN=$(INVESTOR_KEY=0x4dd8f... node scripts/get-user-token.js)
```

### Step 2: Query Positions

```bash
# Get all positions
curl http://localhost:3000/solvency/positions/my \
  -H "Authorization: Bearer $USER_TOKEN"

# Get active positions only
curl http://localhost:3000/solvency/positions/my/active \
  -H "Authorization: Bearer $USER_TOKEN"

# Get specific position details
curl http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer $USER_TOKEN"

# Get repayment schedule
curl http://localhost:3000/solvency/position/1/schedule \
  -H "Authorization: Bearer $USER_TOKEN"

# Get OAID credit lines
curl http://localhost:3000/solvency/oaid/my-credit \
  -H "Authorization: Bearer $USER_TOKEN"

# Get partner loans
curl http://localhost:3000/solvency/partner-loans/my \
  -H "Authorization: Bearer $USER_TOKEN"
```

---

## 📊 Response Field Descriptions

### Position Object

| Field | Type | Description |
|-------|------|-------------|
| `positionId` | number | Unique position ID |
| `userAddress` | string | Owner's wallet address |
| `collateralTokenAddress` | string | Collateral token contract address |
| `collateralTokenType` | string | "RWA" or "PRIVATE_ASSET" |
| `collateralAmount` | string | Amount of collateral deposited (wei) |
| `tokenValueUSD` | string | USD value of collateral (6 decimals) |
| `borrowed` | string | Total USDC borrowed (6 decimals) |
| `totalRepaid` | string | Total USDC repaid (6 decimals) |
| `outstandingDebt` | string | Current debt including interest (6 decimals) |
| `status` | string | "ACTIVE", "LIQUIDATED", "CLOSED" |
| `healthFactor` | number | Collateralization ratio (> 1.5 is healthy) |
| `oaidIssued` | boolean | Whether OAID credit line was issued |
| `oaidTokenId` | number | OAID NFT token ID (if issued) |
| `partnerLoans` | array | Array of partner loan references |
| `totalPartnerDebt` | string | Total debt from partner loans |

### Repayment Schedule Object

| Field | Type | Description |
|-------|------|-------------|
| `loanDuration` | number | Total loan duration in seconds |
| `numberOfInstallments` | number | Number of installment payments |
| `installmentInterval` | number | Time between installments (seconds) |
| `nextPaymentDue` | number | Unix timestamp of next payment |
| `installmentsPaid` | number | Number of installments paid |
| `missedPayments` | number | Number of missed payments |
| `isActive` | boolean | Whether repayment plan is active |
| `details` | array | Array of installment details |

---

## 🔍 Common Use Cases

### Dashboard: Show User Portfolio

```bash
# Get all positions and partner loans
curl http://localhost:3000/solvency/positions/my/active \
  -H "Authorization: Bearer $USER_TOKEN"

curl http://localhost:3000/solvency/partner-loans/my \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Position Details Page

```bash
# Get comprehensive position data
curl http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer $USER_TOKEN"

curl http://localhost:3000/solvency/position/1/schedule \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Credit Available Widget

```bash
# Get OAID credit lines
curl http://localhost:3000/solvency/oaid/my-credit \
  -H "Authorization: Bearer $USER_TOKEN"
```

### Loan Repayment Tracker

```bash
# Get schedule with upcoming payments
curl http://localhost:3000/solvency/position/1/schedule \
  -H "Authorization: Bearer $USER_TOKEN"
```

---

## ⚠️ Error Responses

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```
**Cause:** Invalid or expired JWT token
**Fix:** Get a new token with `get-user-token.js`

### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Not authorized to view this position"
}
```
**Cause:** Trying to access another user's position
**Fix:** Only query positions that belong to the authenticated user

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Position not found"
}
```
**Cause:** Position ID doesn't exist
**Fix:** Check position ID, query `/solvency/positions/my` to get valid IDs

---

## 📝 Related Endpoints

### Solvency Operations

- `POST /solvency/deposit` - Deposit collateral
- `POST /solvency/borrow` - Borrow USDC
- `POST /solvency/repay` - Repay loan
- `POST /solvency/withdraw` - Withdraw collateral

### Partner Loans

- `POST /solvency/partner-loan/repay` - Repay partner loan (coming soon)
- `GET /solvency/partner-loans/my` - Get all partner loans

---

## 🛠 Helper Scripts

### Get User Token
```bash
INVESTOR_KEY=0x... node scripts/get-user-token.js
```

### Test All Endpoints
```bash
#!/bin/bash
# save as test-user-positions.sh

TOKEN=$(INVESTOR_KEY=0x4dd8f... node scripts/get-user-token.js)

echo "=== All Positions ==="
curl -s http://localhost:3000/solvency/positions/my \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n=== Active Positions ==="
curl -s http://localhost:3000/solvency/positions/my/active \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n=== Position 1 Details ==="
curl -s http://localhost:3000/solvency/position/1 \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n=== Position 1 Schedule ==="
curl -s http://localhost:3000/solvency/position/1/schedule \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n=== OAID Credit Lines ==="
curl -s http://localhost:3000/solvency/oaid/my-credit \
  -H "Authorization: Bearer $TOKEN" | jq

echo -e "\n=== Partner Loans ==="
curl -s http://localhost:3000/solvency/partner-loans/my \
  -H "Authorization: Bearer $TOKEN" | jq
```

---

**Document Version:** 1.0
**Last Updated:** 2026-01-10
**Related:** [Solvency Vault Testing Guide](../testing/SOLVENCY_VAULT_TESTING_GUIDE.md)
