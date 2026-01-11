# Partner Loan Repayment Integration Guide

**Version:** 1.0
**Date:** 2026-01-10
**Status:** Production Ready

---

## Overview

This guide explains how users can repay loans borrowed through partner platforms. We support two repayment flows to maximize flexibility:

1. **Transfer-Based Repayment** (Recommended for Partners) - User sends USDC, partner verifies
2. **Portfolio Repayment** - User repays directly through our platform (Coming Soon)

---

## 🎯 Repayment Flow Options

### Option 1: Transfer-Based Repayment (Recommended)

**How It Works:**
1. User sends USDC from their wallet to platform settlement address
2. User provides transaction hash to partner platform
3. Partner calls `/partners/repay-with-transfer` endpoint with transaction details
4. Backend verifies the USDC transfer on-chain
5. Backend executes repayment to SolvencyVault contract
6. Loan status updated in database

**Advantages:**
- ✅ Simple for users - just send USDC
- ✅ No approval mechanism needed
- ✅ Works with any wallet (MetaMask, WalletConnect, etc.)
- ✅ On-chain verification prevents fraud
- ✅ Partner doesn't need contract interaction capability

**Platform Settlement Address:**
```
0x... (Get from platform wallet configuration)
```

---

## 🔧 Implementation Guide

### Step 1: User Sends USDC

**Frontend Example (ethers.js v6):**

```javascript
import { ethers } from 'ethers';

// User initiates USDC transfer
async function sendUSDCForRepayment(amount, loanId) {
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();

  const USDC_ADDRESS = '0x...'; // Mantle Sepolia USDC
  const PLATFORM_WALLET = '0x...'; // Platform settlement address

  const usdcAbi = [
    'function transfer(address to, uint256 amount) returns (bool)'
  ];

  const usdcContract = new ethers.Contract(USDC_ADDRESS, usdcAbi, signer);

  // Amount in USDC (6 decimals)
  const amountWei = ethers.parseUnits(amount, 6);

  console.log(`Sending ${amount} USDC to platform wallet...`);

  const tx = await usdcContract.transfer(PLATFORM_WALLET, amountWei);

  console.log(`Transaction sent: ${tx.hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await tx.wait();

  console.log(`✓ Transfer confirmed in block ${receipt.blockNumber}`);

  return {
    txHash: tx.hash,
    amount: amountWei.toString(),
    userWallet: await signer.getAddress(),
  };
}

// Usage
const result = await sendUSDCForRepayment('100', 'partner_loan_123');

// Now call partner API to complete repayment
await callPartnerRepaymentAPI(
  'partner_loan_123',
  result.amount,
  result.txHash,
  result.userWallet
);
```

### Step 2: Partner Calls Repayment Endpoint

**API Endpoint:**
```
POST /partners/repay-with-transfer
```

**Headers:**
```
Authorization: Bearer pk_xyz_live_your_api_key_here
Content-Type: application/json
```

**Request Body:**
```json
{
  "partnerLoanId": "partner_loan_123",
  "repaymentAmount": "100000000",
  "transferTxHash": "0xabc123...",
  "userWallet": "0x580F5b09765E71D64613c8F4403234f8790DD7D3"
}
```

**Success Response (200 OK):**
```json
{
  "success": true,
  "remainingDebt": "0",
  "loanStatus": "REPAID",
  "userTransferTxHash": "0xabc123...",
  "contractRepayTxHash": "0xdef456...",
  "message": "Loan fully repaid"
}
```

**Error Responses:**

**Transfer Not Found (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "No USDC transfer found from 0x123... to platform wallet 0xPlatform... in transaction 0xabc...",
  "error": "Bad Request"
}
```

**Amount Mismatch (400 Bad Request):**
```json
{
  "statusCode": 400,
  "message": "Transfer amount mismatch. Expected: 100000000, Got: 50000000",
  "error": "Bad Request"
}
```

**Loan Not Found (404 Not Found):**
```json
{
  "statusCode": 404,
  "message": "Loan not found",
  "error": "Not Found"
}
```

---

## 📝 Complete Example Flow

### Backend API Call Example (Node.js)

```javascript
const axios = require('axios');

async function repayLoanWithTransfer(loanId, amount, transferTx, userWallet) {
  const PARTNER_API_KEY = process.env.PARTNER_API_KEY;
  const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

  try {
    const response = await axios.post(
      `${BACKEND_URL}/partners/repay-with-transfer`,
      {
        partnerLoanId: loanId,
        repaymentAmount: amount,
        transferTxHash: transferTx,
        userWallet: userWallet
      },
      {
        headers: {
          'Authorization': `Bearer ${PARTNER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Repayment successful!');
    console.log(`Remaining Debt: $${(Number(response.data.remainingDebt) / 1e6).toFixed(2)}`);
    console.log(`Loan Status: ${response.data.loanStatus}`);
    console.log(`User Transfer Tx: ${response.data.userTransferTxHash}`);
    console.log(`Contract Repay Tx: ${response.data.contractRepayTxHash}`);

    return response.data;

  } catch (error) {
    console.error('❌ Repayment failed:', error.response?.data || error.message);
    throw error;
  }
}

// Usage
repayLoanWithTransfer(
  'partner_loan_123',
  '100000000', // $100 USDC
  '0xabc123def456...',
  '0x580F5b09765E71D64613c8F4403234f8790DD7D3'
);
```

---

## 🔍 On-Chain Verification Process

The backend performs the following checks:

1. **Transaction Existence:** Verifies the transaction hash exists and is confirmed
2. **Transaction Status:** Ensures transaction was not reverted
3. **Transfer Event Parsing:** Extracts USDC Transfer event from transaction logs
4. **Sender Verification:** Confirms transfer came from the specified user wallet
5. **Recipient Verification:** Confirms transfer went to platform wallet
6. **Amount Verification:** Validates exact amount matches repayment request

**Security Features:**
- ✅ Prevents double-spending (transaction hash recorded)
- ✅ Prevents amount manipulation
- ✅ Prevents unauthorized wallet usage
- ✅ Blockchain-verified transfers only

---

## 🛠 Alternative: Legacy Repay Endpoint

For partners who want to handle USDC custody themselves:

**Endpoint:**
```
POST /partners/repay
```

**Request Body:**
```json
{
  "partnerLoanId": "partner_loan_123",
  "repaymentAmount": "100000000"
}
```

**Note:** This requires platform wallet to already have USDC. The platform will execute the contract repayment directly.

---

## 📊 User Portfolio View

Users can view their partner loans through our platform:

**Endpoint:**
```
GET /solvency/partner-loans/my
```

**Headers:**
```
Authorization: Bearer user_jwt_token
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
      "principalAmount": "5000000000",
      "remainingDebt": "2500000000",
      "totalRepaid": "2500000000",
      "status": "ACTIVE",
      "borrowedAt": "2026-01-01T00:00:00.000Z",
      "repaymentHistory": [
        {
          "amount": "2500000000",
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

## 🔄 Repayment Flow Diagram

```
┌─────────────┐
│    User     │
└─────┬───────┘
      │ 1. Send USDC to Platform Wallet
      ▼
┌─────────────────────┐
│  Blockchain (USDC)  │
│  Transfer Event     │
└─────────┬───────────┘
          │ 2. Get Tx Hash
          ▼
    ┌──────────────┐
    │   Partner    │
    │   Platform   │
    └──────┬───────┘
           │ 3. POST /partners/repay-with-transfer
           ▼
    ┌──────────────────┐
    │  RWA Backend     │
    │                  │
    │ ✓ Verify Transfer│
    │ ✓ Execute Repay  │
    │ ✓ Update DB      │
    └──────┬───────────┘
           │ 4. Call SolvencyVault.repayLoan()
           ▼
    ┌──────────────────┐
    │  Smart Contract  │
    │  (SolvencyVault) │
    │                  │
    │ ✓ Burn debt      │
    │ ✓ Update position│
    └──────────────────┘
```

---

## 📋 Testing Checklist

### Unit Tests
- [ ] Transfer verification with valid transaction
- [ ] Transfer verification with invalid transaction
- [ ] Amount mismatch detection
- [ ] Wallet mismatch detection
- [ ] Reverted transaction handling
- [ ] Loan not found handling
- [ ] Already repaid loan handling

### Integration Tests
- [ ] Full repayment flow (100% debt)
- [ ] Partial repayment flow (50% debt)
- [ ] Multiple repayments to same loan
- [ ] Concurrent repayment attempts

### Manual Tests
- [ ] User sends USDC via MetaMask
- [ ] Partner calls API with correct tx hash
- [ ] Verify on-chain repayment executed
- [ ] Check loan status updated in database
- [ ] Verify user can view loan in portfolio

---

## 🚨 Error Handling

### Common Errors and Solutions

**Error:** "Transfer transaction not found or not confirmed"
- **Solution:** Wait for transaction confirmation (1-2 blocks on Mantle Sepolia)

**Error:** "Transfer amount mismatch"
- **Solution:** Ensure user sent exact repayment amount (account for 6 decimals)

**Error:** "User wallet does not match loan owner"
- **Solution:** Verify user wallet address matches loan.userWallet

**Error:** "Repayment exceeds remaining debt"
- **Solution:** Query loan details first to get exact remaining debt

---

## 🎓 Best Practices

### For Partners

1. **Show Platform Wallet Clearly:** Display the platform settlement address prominently
2. **Pre-fill Transfer Amount:** Calculate and show exact USDC amount (6 decimals)
3. **Wait for Confirmation:** Don't call API until user's tx is confirmed (1-2 blocks)
4. **Handle Partial Repayments:** Allow users to repay any amount up to remaining debt
5. **Show Remaining Balance:** Query loan details before and after repayment

### For Users

1. **Double-check Amount:** Verify repayment amount before sending
2. **Use Correct Address:** Ensure sending to platform wallet, not partner wallet
3. **Save Transaction Hash:** Keep tx hash for your records
4. **Wait for Confirmation:** Transaction needs to be mined before partner can process

---

## 📞 Support

### Getting Platform Wallet Address

**For Sandbox:**
```bash
curl http://localhost:3000/partners/public/platform-info
```

**For Production:**
```bash
curl https://api.mantle-rwa.com/partners/public/platform-info
```

### Contact

- **Technical Support:** dev@mantle-rwa.com
- **Partner Portal:** https://partners.mantle-rwa.com
- **Documentation:** https://docs.mantle-rwa.com

---

## 🔐 Security Notes

1. **Never Expose API Keys:** Store partner API keys securely (environment variables)
2. **Validate User Input:** Always validate wallet addresses and amounts on frontend
3. **Monitor Failed Transactions:** Log and alert on repeated verification failures
4. **Rate Limiting:** Respect API rate limits (varies by partner tier)
5. **HTTPS Only:** Never send API requests over unencrypted connections

---

**Document Version:** 1.0
**Last Updated:** 2026-01-10
**Maintained By:** Engineering Team
