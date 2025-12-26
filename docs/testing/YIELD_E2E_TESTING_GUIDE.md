# Yield Settlement & Distribution - E2E Testing Guide

## Overview

This guide walks through end-to-end testing of the **time-weighted yield settlement and distribution system**. This flow occurs AFTER an asset has completed its lifecycle (originator has been paid out), and the originator has settled the invoice with the debtor.

## Prerequisites

### 1. Completed Asset Lifecycle
Before testing yield, ensure you have:
- ✅ Asset created, attested, and tokenized
- ✅ Asset listed on marketplace (STATIC or AUCTION)
- ✅ Investors purchased tokens
- ✅ Auction ended (if applicable) and bids settled
- ✅ **Originator payout completed** (funds from investors transferred to originator)

### 2. Required Setup
- Platform admin wallet with USDC balance
- Deployed contracts: YieldVault, USDC, RWAToken
- MongoDB running with proper schemas
- Backend server running
- Admin authentication token

### 3. Key Concepts

**Time-Weighted Yield Distribution:**
- Uses **token-days** calculation: `balance × days_held`
- Rewards holders based on how long they held tokens
- Fair distribution: early investors who held longer get more yield per token
- Example: Holder A with 100 tokens for 30 days = 3000 token-days
            Holder B with 100 tokens for 10 days = 1000 token-days
            → Holder A gets 75% of yield, Holder B gets 25%

**Dynamic Yield Model:**
- Yield is NOT fixed - it emerges from settlement amount vs amount raised
- `effectiveYield = (netDistribution - amountRaised) / amountRaised`
- Example: Raised ₹46.73L, Settlement ₹50L, Platform fee 1.5%
  - Platform fee: ₹75,000
  - Net distribution: ₹49,25,000
  - Effective yield: (49.25L - 46.73L) / 46.73L = 5.39%

---

## Step 1: Verify Asset State

### Get Asset Details
```bash
GET /assets/:assetId
Authorization: Bearer <admin-token>
```

**Expected Response:**
```json
{
  "assetId": "abc-123-def",
  "status": "PAYOUT_COMPLETE",
  "token": {
    "address": "0x...",
    "supply": "100000000000000000000000",
    "deployedAt": "2025-12-20T10:00:00.000Z"
  },
  "listing": {
    "amountRaised": "46730000",
    "type": "AUCTION",
    "clearingPrice": "467300"
  },
  "metadata": {
    "faceValue": "5000000",
    "currency": "INR"
  }
}
```

**Verify:**
- ✅ `status` is `PAYOUT_COMPLETE`
- ✅ `token.address` exists
- ✅ `listing.amountRaised` is populated
- ✅ `token.deployedAt` exists (used for token-days calculation)

---

## Step 2: Admin Receives Settlement

In the real world, the **originator pays back the face value** (on-chain or off-chain) to the admin. For testing, we assume:
- Originator settled invoice and received ₹50,00,000 from debtor
- Originator pays admin (off-chain or on-chain - doesn't matter)
- Admin now has USDC equivalent in platform custody wallet

### Ensure Admin Wallet Has USDC

**Check Platform Wallet Balance:**
```bash
# Get platform wallet address from .env
PLATFORM_WALLET_ADDRESS=<from .env>

# Check USDC balance on-chain
curl -X POST https://rpc.sepolia.mantle.xyz \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_call",
    "params": [{
      "to": "<USDC_CONTRACT_ADDRESS>",
      "data": "0x70a08231000000000000000000000000<PLATFORM_WALLET_ADDRESS>"
    }, "latest"],
    "id": 1
  }'
```

**If balance is low, use Faucet to get USDC:**
```bash
POST /faucet/request-usdc
Content-Type: application/json

{
  "recipientAddress": "<PLATFORM_WALLET_ADDRESS>",
  "amount": "100000000000"
}
```

---

## Step 3: Record Settlement

Admin records that originator has paid back the face value.

### API Call: Record Settlement
```bash
POST /admin/yield/settlement
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "assetId": "abc-123-def",
  "settlementAmount": 5000000,
  "settlementDate": "2025-12-26T00:00:00.000Z"
}
```

**Expected Response:**
```json
{
  "_id": "settlement-xyz",
  "assetId": "abc-123-def",
  "tokenAddress": "0x...",
  "settlementAmount": 5000000,
  "amountRaised": 4673000,
  "platformFeeRate": 0.015,
  "platformFee": 75000,
  "netDistribution": 4925000,
  "status": "PENDING_CONVERSION",
  "settlementDate": "2025-12-26T00:00:00.000Z"
}
```

**What Happened:**
- Settlement record created with `PENDING_CONVERSION` status
- Platform fee calculated: 1.5% of ₹50L = ₹75,000
- Net distribution: ₹50L - ₹75K = ₹49.25L (this goes to investors)
- Effective yield logged: (₹49.25L - ₹46.73L) / ₹46.73L = 5.39%

---

## Step 4: Confirm USDC Conversion

Admin confirms they have converted INR to USDC and have the equivalent amount ready.

**Conversion Calculation:**
```
Net Distribution (INR): ₹49,25,000
Exchange Rate: ~₹85/USDC (example)
USDC Amount: 49,25,000 / 85 = 57,941 USDC
USDC in wei (6 decimals): 57,941 × 10^6 = 57,941,000,000
```

### API Call: Confirm USDC Conversion
```bash
POST /admin/yield/confirm-usdc
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "settlementId": "settlement-xyz",
  "usdcAmount": "57941000000"
}
```

**Expected Response:**
```json
{
  "_id": "settlement-xyz",
  "assetId": "abc-123-def",
  "usdcAmount": "57941000000",
  "status": "READY_FOR_DISTRIBUTION",
  "conversionTimestamp": "2025-12-26T10:30:00.000Z"
}
```

**What Happened:**
- Settlement status updated to `READY_FOR_DISTRIBUTION`
- USDC amount recorded
- System ready to distribute yield

---

## Step 5: Distribute Yield (Time-Weighted)

Admin triggers the actual on-chain distribution. This uses **time-weighted token-days** calculation.

### API Call: Distribute Yield
```bash
POST /admin/yield/distribute
Authorization: Bearer <admin-token>
Content-Type: application/json

{
  "settlementId": "settlement-xyz"
}
```

**Expected Backend Logs:**
```
[YieldDistributionService] Calculating time-weighted yield distribution for 0x...
  from 2025-12-20T10:00:00.000Z to 2025-12-26T12:00:00.000Z
[TokenHolderTrackingService] Calculated token-days for 0x...: 5 holders, total token-days: 450000000000000000000000
[YieldDistributionService] Starting time-weighted distribution for 0x...
  Total holders: 5
  Total token-days: 450000000000000000000000
  Distributing: 57941000000 USDC
  Amount originally raised: 4673000
[BlockchainService] Approving YieldVault to spend 57941000000 USDC...
[BlockchainService] USDC approved in tx: 0xabc...
[BlockchainService] Depositing 57941000000 USDC to YieldVault for token 0x...
[BlockchainService] Yield deposited in tx: 0xdef...
[YieldDistributionService] Batch distribution succeeded
```

**Expected Response:**
```json
{
  "message": "Time-weighted distribution completed",
  "totalDistributed": "57941000000",
  "holders": 5,
  "totalTokenDays": "450000000000000000000000",
  "effectiveYield": "5.39%"
}
```

**What Happened:**
1. **Token-Days Calculation:**
   - System queries all `TokenTransferEvent` records from token deployment to now
   - For each holder, calculates: `Σ(balance × time_held_in_days)`
   - Example calculation:
     - Holder A: 100 tokens × 6 days = 600 token-days
     - Holder B: 150 tokens × 4 days = 600 token-days
     - Holder C: 50 tokens × 6 days = 300 token-days
     - Total: 1500 token-days

2. **Distribution Calculation:**
   - Each holder's share: `(holder_token_days / total_token_days) × total_USDC`
   - Holder A: (600/1500) × 57,941 = 23,176 USDC
   - Holder B: (600/1500) × 57,941 = 23,176 USDC
   - Holder C: (300/1500) × 57,941 = 11,588 USDC

3. **On-Chain Execution:**
   - Platform wallet approves YieldVault to spend USDC
   - Platform wallet calls `depositYield(tokenAddress, 57941000000)` on YieldVault
   - Platform wallet calls `distributeYieldBatch(tokenAddress, [holders], [amounts])` in batches of 50
   - YieldVault updates each holder's `userYields[holder].totalClaimable`

4. **MongoDB Updates:**
   - `DistributionHistory` records created for each holder with tx hash
   - `Settlement` status updated to `DISTRIBUTED`
   - `distributedAt` timestamp recorded

---

## Step 6: Verify Distribution

### Check YieldVault State (On-Chain)
```bash
# Get claimable amount for a holder
curl -X POST https://rpc.sepolia.mantle.xyz \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_call",
    "params": [{
      "to": "<YIELD_VAULT_ADDRESS>",
      "data": "0x4d5ce038000000000000000000000000<HOLDER_ADDRESS>"
    }, "latest"],
    "id": 1
  }'
```

### Check Distribution History (MongoDB)
```bash
GET /admin/yield/distribution-history/:settlementId
Authorization: Bearer <admin-token>
```

**Expected Response:**
```json
[
  {
    "settlementId": "settlement-xyz",
    "tokenAddress": "0x...",
    "recipient": "0xHolder1...",
    "amount": "23176000000",
    "txHash": "0xabc...",
    "status": "SUCCESS",
    "distributedAt": "2025-12-26T12:00:00.000Z"
  },
  {
    "settlementId": "settlement-xyz",
    "tokenAddress": "0x...",
    "recipient": "0xHolder2...",
    "amount": "23176000000",
    "txHash": "0xabc...",
    "status": "SUCCESS",
    "distributedAt": "2025-12-26T12:00:00.000Z"
  }
]
```

---

## Step 7: Investor Claims Yield

Investors can now claim their USDC yield from the YieldVault.

### Smart Contract Call: claimAllYield()
```javascript
// Frontend / Web3 wallet interaction
const yieldVault = new ethers.Contract(YIELD_VAULT_ADDRESS, YIELD_VAULT_ABI, signer);
const tx = await yieldVault.claimAllYield();
await tx.wait();
console.log('Claimed yield in tx:', tx.hash);
```

**Expected Events:**
```
YieldClaimed(user=0xHolder1..., amount=23176000000, timestamp=1735214400)
```

**Verify:**
- Investor's USDC balance increases by claimed amount
- `userYields[investor].totalClaimable` becomes 0
- `userYields[investor].lastClaimTime` updated

---

## Testing Scenarios

### Scenario 1: Single Holder (100% Ownership)
- 1 investor buys all tokens at deployment
- Holds for 7 days
- Should receive 100% of yield

**Expected:**
- Token-days: 100,000 × 7 = 700,000
- Distribution: 100% of 57,941 USDC = 57,941 USDC

---

### Scenario 2: Equal Split with Different Hold Times
- Holder A: Buys 50,000 tokens at day 0, holds for 7 days
- Holder B: Buys 50,000 tokens at day 4, holds for 3 days

**Expected Token-Days:**
- Holder A: 50,000 × 7 = 350,000 token-days
- Holder B: 50,000 × 3 = 150,000 token-days
- Total: 500,000 token-days

**Expected Distribution:**
- Holder A: (350,000 / 500,000) × 57,941 = 40,559 USDC (70%)
- Holder B: (150,000 / 500,000) × 57,941 = 17,382 USDC (30%)

---

### Scenario 3: Secondary Market Trading
- Holder A: Buys 100,000 tokens at day 0
- Day 3: Holder A sells 50,000 tokens to Holder B
- Day 7: Distribution

**Expected Token-Days:**
- Holder A: (100,000 × 3) + (50,000 × 4) = 500,000 token-days
- Holder B: 50,000 × 4 = 200,000 token-days
- Total: 700,000 token-days

**Expected Distribution:**
- Holder A: (500,000 / 700,000) × 57,941 = 41,386 USDC (71.4%)
- Holder B: (200,000 / 700,000) × 57,941 = 16,555 USDC (28.6%)

---

## Common Issues & Debugging

### Issue 1: "No holders with token-days found"
**Cause:** No transfer events recorded in `TokenTransferEvent` collection

**Fix:**
- Verify transfer events are being tracked during token purchases
- Check that `TokenHolderTrackingService.updateHolderFromTransferEvent()` is called with block number and tx hash
- Manually insert test events if needed for testing

### Issue 2: "USDC approval failed"
**Cause:** Platform wallet doesn't have enough USDC or gas

**Fix:**
- Check platform wallet ETH balance for gas
- Use faucet to get more USDC: `POST /faucet/request-usdc`
- Verify USDC contract address in deployed_contracts.json

### Issue 3: "Total token-days is zero"
**Cause:** Token deployment date is in the future OR no transfer events

**Fix:**
- Verify `asset.token.deployedAt` is correct
- Check transfer events exist: `db.tokentransferevents.find({ tokenAddress: "0x..." })`
- Ensure time period (fromDate to toDate) includes transfer events

### Issue 4: Distribution amounts don't sum to total
**Cause:** BigInt division rounding

**Expected:** Small rounding differences (< 1 USDC) are normal due to integer division

**Fix:** Verify total distributed is within 1 USDC of expected amount

---

## Monitoring & Analytics

### Query Time-Weighted Distributions
```javascript
// Check token-days for a specific asset
db.tokentransferevents.aggregate([
  { $match: { tokenAddress: "0x..." } },
  { $group: {
    _id: "$to",
    totalReceived: { $sum: { $toLong: "$amount" } },
    firstTransfer: { $min: "$timestamp" },
    lastTransfer: { $max: "$timestamp" }
  }}
]);
```

### Query Distribution History
```javascript
// Check all distributions for a settlement
db.distributionhistories.find({ settlementId: "settlement-xyz" });
```

### Verify Settlement Flow
```javascript
// Check settlement progression
db.settlements.find({ assetId: "abc-123-def" });
// Expected status progression:
// PENDING_CONVERSION → READY_FOR_DISTRIBUTION → DISTRIBUTED
```

---

## Success Criteria

✅ Settlement recorded with correct platform fee calculation
✅ USDC conversion confirmed with correct amount
✅ Time-weighted distribution calculates token-days correctly
✅ USDC approval transaction succeeds
✅ Yield deposit to vault succeeds
✅ Batch distribution succeeds for all holders
✅ Distribution amounts sum to total USDC (within rounding)
✅ MongoDB records match on-chain state
✅ Investors can claim their yield successfully
✅ Effective yield matches expected return

---

## Next Steps After Testing

1. **Implement Recurring Distributions:**
   - Track last distribution date per asset
   - Use last distribution date as `fromDate` for next calculation
   - Prevent double-counting token-days

2. **Add Distribution UI:**
   - Admin dashboard to trigger distributions
   - Investor dashboard to view claimable yield
   - Transaction history and yield analytics

3. **Optimize Gas Costs:**
   - Batch size tuning (current: 50 holders/batch)
   - Consider merkle tree distributions for large holder counts

4. **Add Notifications:**
   - Email/push notifications when yield is claimable
   - Alert originator when settlement is due

---

## Summary

This E2E flow demonstrates:
- ✅ **Dynamic yield model** based on settlement vs amount raised
- ✅ **Time-weighted distributions** using token-days calculation
- ✅ **Fair yield allocation** rewarding long-term holders
- ✅ **Automated on-chain execution** with USDC approval and batch distribution
- ✅ **Full audit trail** in MongoDB with transaction hashes

The system is production-ready for yield settlement and distribution testing.
