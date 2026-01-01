# Leverage System Testing Guide

## Overview

This guide covers testing the three remaining untested flows in the leverage system:
1. **Automated Harvest Flow** - Interest payment from mETH yield
2. **Health Monitoring & Liquidation Flow** - Position health tracking and liquidation
3. **Settlement Waterfall Flow** - Invoice settlement distribution

**Prerequisites:**
- ✅ Backend running with completed build
- ✅ MongoDB running and accessible
- ✅ At least one active leverage position created
- ✅ SeniorPool funded with USDC (via `fund-senior-pool.js`)
- ✅ MockFluxionDEX funded with USDC and mETH (via `fund-dex.js`)

---

## Test 1: Automated Harvest Flow

**What it tests:** Automatic harvesting of mETH appreciation to pay accrued interest on borrowed USDC.

### Configuration
- **Frequency:** Every 4 minutes in demo mode (see `packages/backend/.env`)
- **Time Multiplier:** 360x (1 day = 4 minutes)
- **Demo Mode:** Enabled by default

### Step-by-Step Testing

#### 1.1 Verify Cron Service is Running

```bash
# Check backend logs for harvest keeper initialization
tail -f packages/backend/logs/combined.log | grep "HarvestKeeperService"
```

**Expected output:**
```
[HarvestKeeperService] ⚡ Harvest Keeper initialized (Demo Mode: ENABLED)
[HarvestKeeperService] ⏰ Harvest interval: 4 minutes (360x time acceleration)
```

#### 1.2 Create a Leverage Position (if not already done)

```bash
# Via frontend or API
curl -X POST http://localhost:3000/leverage/initiate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "YOUR_ASSET_ID",
    "tokenAmount": "10000000000000000000",
    "pricePerToken": "1000000",
    "mETHCollateral": "3938000000000000"
  }'
```

**Record:**
- Position ID: `____`
- mETH Collateral: `____`
- USDC Borrowed: `____`

#### 1.3 Wait for First Harvest Cycle (4 minutes)

```bash
# Monitor harvest logs in real-time
tail -f packages/backend/logs/combined.log | grep -E "HarvestKeeper|harvestYield"
```

**Expected log sequence:**
```
[HarvestKeeperService] 🌾 Starting harvest cycle...
[HarvestKeeperService] Found 1 active position(s) to check
[HarvestKeeperService] 💰 Position 1: Interest accrued = 5.50 USDC
[HarvestKeeperService] 📊 mETH needed (with 5% buffer): 0.0019 mETH
[HarvestKeeperService] ✅ DEX liquidity check passed (10x buffer available)
[LeverageBlockchainService] 🌾 Harvesting yield for position 1...
[LeverageBlockchainService] ✅ Yield harvested: 0xTXHASH
[HarvestKeeperService] ✅ Harvest successful for position 1
[HarvestKeeperService] 💾 Recording harvest in database...
```

#### 1.4 Verify Harvest in Database

```javascript
// In mongosh
use rwa-platform

db.leveragepositions.findOne(
  { positionId: 1 },
  { harvestHistory: 1, totalInterestPaid: 1, totalMETHHarvested: 1, lastHarvestTime: 1 }
)
```

**Expected output:**
```javascript
{
  harvestHistory: [
    {
      timestamp: ISODate("2026-01-01T00:10:00.000Z"),
      mETHHarvested: "1900000000000000",  // 0.0019 mETH
      usdcGenerated: "5500000",           // 5.50 USDC
      interestPaid: "5500000",
      transactionHash: "0x..."
    }
  ],
  totalInterestPaid: "5500000",
  totalMETHHarvested: "1900000000000000",
  lastHarvestTime: ISODate("2026-01-01T00:10:00.000Z")
}
```

#### 1.5 Verify User Notification

```bash
# Check notifications for user
curl http://localhost:3000/notifications/my \
  -H "Authorization: Bearer USER_JWT_TOKEN"
```

**Expected notification:**
```json
{
  "type": "LEVERAGE_HARVEST",
  "header": "Yield Harvested",
  "detail": "Harvested 0.0019 mETH → 5.50 USDC to pay interest on position #1",
  "severity": "SUCCESS"
}
```

#### 1.6 Test Edge Cases

**A. Insufficient DEX Liquidity**
```bash
# Temporarily drain DEX liquidity
# The harvest should skip with a warning log
```

**Expected log:**
```
[HarvestKeeperService] ⚠️ Insufficient DEX liquidity for position 1, skipping harvest
```

**B. No Interest Accrued (too soon)**
```bash
# Create a brand new position and check immediately
# Should skip with log: "No interest accrued yet"
```

---

## Test 2: Health Monitoring & Liquidation Flow

**What it tests:** Real-time health monitoring and automatic liquidation when health factor drops below 110%.

### Configuration
- **Frequency:** Every 1 minute in demo mode
- **Health Thresholds:**
  - HEALTHY: >140%
  - WARNING: 125-140%
  - CRITICAL: 110-125%
  - LIQUIDATABLE: <110%

### Step-by-Step Testing

#### 2.1 Verify Health Monitor is Running

```bash
tail -f packages/backend/logs/combined.log | grep "HealthMonitor"
```

**Expected output:**
```
[HealthMonitorService] 💊 Health Monitor initialized (Check interval: 1 minute)
[HealthMonitorService] 💊 Starting health check cycle...
[HealthMonitorService] Checking 3 active positions
```

#### 2.2 Monitor Healthy Position

```bash
# Watch health updates
tail -f packages/backend/logs/combined.log | grep "health updated"
```

**Expected output:**
```
[LeveragePositionService] 📊 Position 1 health updated: 150.3% (HEALTHY)
[LeveragePositionService] 📊 Position 2 health updated: 145.8% (HEALTHY)
```

#### 2.3 Simulate WARNING Threshold (125-140%)

To trigger WARNING status, you need to either:
- **Option A:** Simulate mETH price drop (requires contract modification)
- **Option B:** Create a position with minimal collateral (closer to 150%)

```bash
# Create position with exactly 160% LTV (close to threshold)
# mETH value should be 1.6x USDC borrowed
```

**Expected log:**
```
[HealthMonitorService] ⚠️ Position 5 entered WARNING status: 132.5%
[NotificationService] Sending WARNING notification to user
```

**Verify notification:**
```bash
curl http://localhost:3000/notifications/my \
  -H "Authorization: Bearer USER_JWT_TOKEN"
```

#### 2.4 Simulate CRITICAL Threshold (110-125%)

**Option 1: Manual Database Update (for testing only)**
```javascript
// In mongosh - TESTING ONLY
use rwa-platform

// Temporarily set health to 115%
db.leveragepositions.updateOne(
  { positionId: 1 },
  {
    $set: {
      currentHealthFactor: 11500,  // 115.00%
      healthStatus: "CRITICAL"
    }
  }
)
```

**Expected log:**
```
[HealthMonitorService] 🚨 Position 1 in CRITICAL state: 115.0%
[NotificationService] Sending CRITICAL alert to user
```

**Expected notification:**
```json
{
  "type": "LEVERAGE_HEALTH_CRITICAL",
  "header": "Position Critical",
  "detail": "Your leverage position #1 health is at 115% - add collateral or risk liquidation at 110%",
  "severity": "WARNING",
  "action": "ADD_COLLATERAL"
}
```

#### 2.5 Test Automatic Liquidation (<110%)

**⚠️ WARNING: This will liquidate the position!**

```javascript
// Option 1: Manual trigger (TESTING ONLY)
use rwa-platform

db.leveragepositions.updateOne(
  { positionId: 1 },
  {
    $set: {
      currentHealthFactor: 10500,  // 105.00% - below threshold
      healthStatus: "LIQUIDATABLE"
    }
  }
)
```

**Wait for next health check cycle (1 minute)**

**Expected log sequence:**
```
[HealthMonitorService] 🚨🚨 LIQUIDATION TRIGGERED for position 1 (Health: 105.0%)
[LeverageBlockchainService] 🔨 Liquidating position 1...
[LeverageBlockchainService] Seizing mETH collateral...
[FluxionIntegration] Swapping mETH for USDC...
[SeniorPool] Receiving liquidation repayment...
[LeverageBlockchainService] ✅ Position liquidated: 0xTXHASH
[LeveragePositionService] 💀 Position 1 marked as LIQUIDATED
[NotificationService] Sending liquidation notification
```

#### 2.6 Verify Liquidation in Database

```javascript
use rwa-platform

db.leveragepositions.findOne(
  { positionId: 1 },
  {
    status: 1,
    liquidationData: 1,
    currentHealthFactor: 1
  }
)
```

**Expected output:**
```javascript
{
  status: "LIQUIDATED",
  currentHealthFactor: 10500,
  liquidationData: {
    liquidatedAt: ISODate("2026-01-01T00:15:00.000Z"),
    mETHSeized: "3938000000000000",
    usdcRecovered: "11250000",
    debtRepaid: "10000000",
    shortfall: "0",
    transactionHash: "0x..."
  }
}
```

#### 2.7 Verify Liquidation Notification

```json
{
  "type": "LEVERAGE_LIQUIDATION",
  "header": "Position Liquidated",
  "detail": "Your position #1 was liquidated due to health factor falling below 110%. mETH collateral was seized.",
  "severity": "ERROR"
}
```

## Test 3: Settlement Waterfall Flow

**Objective:** Verify that when the underlying asset settles, the leverage position is unwound correctly (Waterfall: Senior Debt -> Interest -> User Yield).

1.  **Trigger Settlement:**
    *   Admin deposits yield/settlement for the asset using `scripts/admin-settle-yield.sh` (or API).
    *   This triggers `YieldDistributionService.distributeYield`.

2.  **Verify Backend Logs:**
    *   [ ] "Checking for leverage positions holding this asset..."
    *   [ ] "Claiming yield for position X: burning tokens..."
    *   [ ] "Processing settlement waterfall..."
    *   [ ] **Detailed settlement breakdown:**
        *   [ ] "Principal Repaid: ... USDC"
        *   [ ] "Interest Deducted: ... USDC"
        *   [ ] "User Yield (Net): ... USDC"
        *   [ ] "mETH Returned: ... mETH"
    *   [ ] "Position X settled successfully!"

3.  **Verify Database State:**
    *   Check `LeveragePositions` collection.
    *   [ ] Status should be `SETTLED`.
    *   [ ] `settlementTimestamp` is set.
    *   [ ] `seniorRepayment`, `interestRepayment`, `userYieldDistributed`, and `mETHReturnedToUser` are recorded.
    *   [ ] `rwaTokenAmount` should be 0 (burned).

4.  **Verify Blockchain State:**
    *   [ ] LeverageVault RWA balance is 0.
    *   [ ] SeniorPool received principal + interest.
    *   [ ] User received net yield (USDC).
    *   [ ] User received mETH collateral back.

5.  **Verify Notification:**
    *   [ ] User receives `PAYOUT_SETTLED` notification.
    *   [ ] Notification details include Net Yield amount and mETH collateral returned.

**Command:**
```bash
# Settle asset (Admin)
./scripts/admin-settle-yield.sh <ASSET_ID> <AMOUNT>
```
---

## Monitoring Tools

### Real-Time Position Dashboard

```bash
# Watch all positions in real-time
watch -n 5 'curl -s http://localhost:3000/leverage/positions/my \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq'
```

### Database Queries

```javascript
// Get all positions with health status
db.leveragepositions.find(
  {},
  {
    positionId: 1,
    userAddress: 1,
    status: 1,
    currentHealthFactor: 1,
    healthStatus: 1,
    totalInterestPaid: 1
  }
).pretty()

// Get harvest history for a position
db.leveragepositions.findOne(
  { positionId: 1 },
  { harvestHistory: 1 }
)

// Count positions by status
db.leveragepositions.aggregate([
  { $group: { _id: "$status", count: { $sum: 1 } } }
])
```

### Check Cron Jobs Status

```bash
# Check if cron services are running
curl http://localhost:3000/health | jq '.cronJobs'
```

---

## Troubleshooting

### Harvest Not Running

**Symptom:** No harvest logs after 4 minutes

**Checks:**
1. Verify cron service is enabled:
   ```bash
   grep "ENABLE_CRON" packages/backend/.env
   # Should be: ENABLE_CRON=true
   ```

2. Check for errors:
   ```bash
   tail -f packages/backend/logs/error.log
   ```

3. Verify DEX has liquidity:
   ```bash
   # Check DEX balances
   curl http://localhost:3000/dex/liquidity
   ```

### Health Monitor Not Detecting Changes

**Symptom:** Health factor not updating

**Checks:**
1. Verify position is ACTIVE:
   ```javascript
   db.leveragepositions.find({ status: "ACTIVE" }).count()
   ```

2. Check mETH price service:
   ```bash
   curl http://localhost:3000/leverage/meth-price
   ```

3. Manually trigger health check (if endpoint exists):
   ```bash
   curl -X POST http://localhost:3000/admin/leverage/check-health
   ```

### Settlement Waterfall Not Executing

**Symptom:** Settlement doesn't distribute to leverage positions

**Checks:**
1. Verify LeverageVault holds the tokens:
   ```bash
   # Check token balance of LeverageVault contract
   ```

2. Check YieldDistribution service logs:
   ```bash
   tail -f packages/backend/logs/combined.log | grep "YieldDistribution"
   ```

3. Verify settlement amount is sufficient:
   ```bash
   # Settlement must be > 0 to trigger waterfall
   ```

---

## Expected Timeline (Demo Mode)

| Time | Event |
|------|-------|
| T+0 min | Position created |
| T+1 min | First health check |
| T+4 min | First harvest attempt (may skip if no interest yet) |
| T+5 min | Second health check |
| T+8 min | Second harvest (should succeed with accrued interest) |
| T+10 min | Third health check |
| ... | Continues every 1 min (health) / 4 min (harvest) |

---

## Success Criteria

### ✅ Automated Harvest Flow
- [ ] Harvest runs every 4 minutes
- [ ] Interest accrued is calculated correctly
- [ ] mETH is swapped for USDC successfully
- [ ] SeniorPool debt is reduced
- [ ] Harvest history is recorded in DB
- [ ] User receives notification

### ✅ Health Monitoring & Liquidation Flow
- [ ] Health checks run every 1 minute
- [ ] Health factor calculated accurately
- [ ] WARNING notification at 125-140%
- [ ] CRITICAL notification at 110-125%
- [ ] Automatic liquidation at <110%
- [ ] Liquidation properly repays SeniorPool
- [ ] Position marked as LIQUIDATED in DB

### ✅ Settlement Waterfall Flow
- [ ] Settlement amount distributed pro-rata
- [ ] Principal repaid first (highest priority)
- [ ] Interest repaid second
- [ ] Surplus returned to user third
- [ ] mETH collateral returned after full repayment
- [ ] Position marked as SETTLED
- [ ] Waterfall stops correctly if funds insufficient

---

## Next Steps

After completing all tests:
1. Document any bugs or issues found
2. Test with multiple concurrent positions
3. Test with extreme values (very large/small positions)
4. Load testing (100+ positions)
5. Integration testing with frontend UI

---

**Questions or Issues?**
- Check logs: `packages/backend/logs/`
- MongoDB queries above
- Backend health endpoint: `http://localhost:3000/health`
