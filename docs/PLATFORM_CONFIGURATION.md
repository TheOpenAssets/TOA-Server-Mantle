# Platform Configuration Guide

## Overview

The RWA platform uses a **configurable threshold system** to manage risk and ensure platform sustainability. This document explains all configurable parameters and how to adjust them.

---

## Core Configuration Parameters

### 1. Raise Thresholds

#### **Minimum Raise Threshold** (Configurable)
```typescript
minRaiseThresholdPercent: 0.30  // Default: 30%
```

**What it does:**
- Sets minimum % of net distribution that must be raised for a listing to succeed
- If not met → investors refunded, invoice not funded

**Example** (₹50L invoice):
```
Net distribution: ₹49,25,000
Minimum raise (30%): ₹14,77,500

If only ₹10L raised → Listing fails, refunds issued
If ₹15L+ raised → Listing succeeds, settlement proceeds
```

**When to adjust:**

| Scenario | Recommended Setting | Reasoning |
|----------|-------------------|-----------|
| **High-quality invoices** | 20-30% | Lower risk, can accept partial raises |
| **Medium-quality invoices** | 30-40% | Balanced risk management |
| **High-risk invoices** | 50-60% | Need strong investor confidence |
| **Platform growth phase** | 20-25% | More listings = more variety |
| **Platform maturity phase** | 35-45% | Quality over quantity |

**Admin command:**
```typescript
POST /admin/platform-config
{
  "minRaiseThresholdPercent": 0.35,  // Change to 35%
  "reason": "Increasing quality threshold for H2 2025"
}
```

---

#### **Maximum Raise Threshold** (Fixed at 98.5%)
```typescript
maxRaiseThresholdPercent: 0.985  // Fixed: DO NOT CHANGE
```

**What it does:**
- Prevents over-raising that would eat into platform fee
- Ensures platform always earns 1.5% on settlement

**Why fixed?**
```
Invoice value: ₹50,00,000
Platform fee (1.5%): ₹75,000
Max raise (98.5%): ₹49,25,000

If we allowed 100% raise:
- Investors pay: ₹50,00,000
- Settlement: ₹50,00,000
- Platform fee: ₹75,000
- Net distribution: ₹49,25,000
- Investor LOSS: -₹75,000 ❌

By capping at 98.5%:
- Investors pay: ₹49,25,000
- Settlement: ₹50,00,000
- Platform fee: ₹75,000
- Net distribution: ₹49,25,000
- Investor BREAK-EVEN: ₹0 ✓
```

**Enforcement:**
- Marketplace automatically rejects purchases exceeding max
- Frontend shows "Only ₹X available" when near cap

---

### 2. Platform Fee

```typescript
platformFeeRate: 0.015  // 1.5% of settlement
```

**What it does:**
- Platform's revenue per settled invoice
- Deducted from settlement before investor distribution

**Example** (₹50L invoice):
```
Settlement: ₹50,00,000
Platform fee: ₹75,000 (1.5%)
Net to investors: ₹49,25,000
```

**When to adjust:**

| Volume | Suggested Fee | Revenue Model |
|--------|--------------|---------------|
| 0-50 invoices/month | 1.5-2.0% | Premium for boutique service |
| 50-200 invoices/month | 1.0-1.5% | Competitive market rate |
| 200+ invoices/month | 0.5-1.0% | Volume play |

**Note:** Changing this affects `maxRaiseThresholdPercent` calculation:
```
New fee = 2.0%
Max raise = 98.0% (instead of 98.5%)
```

---

### 3. Marketplace Settings

#### **Default Listing Duration**
```typescript
defaultListingDurationDays: 7  // Default: 7 days
```

**What it does:**
- How long a listing stays active before expiring
- After expiration, check if minimum raise met

**Recommended settings:**

| Invoice Type | Duration | Reasoning |
|--------------|----------|-----------|
| **High-quality (A-rated)** | 3-5 days | Fast liquidity |
| **Medium-quality (B-rated)** | 7-10 days | Standard timeline |
| **High-yield (C-rated)** | 14-21 days | Needs time to attract risk-takers |
| **Dutch auction** | 2-3 days | Price discovery window |

---

#### **Minimum Investment**
```typescript
minInvestmentTokens: 1000  // Default: 1000 tokens
```

**What it does:**
- Minimum tokens per purchase
- Prevents micro-transactions that waste gas

**Example** (₹50L invoice, 50k tokens):
```
1 token = ₹100 face value
Minimum: 1000 tokens = ₹1,00,000 purchase

If investor wants ₹50k worth → Rejected
If investor wants ₹1L+ worth → Accepted
```

**When to adjust:**

| Strategy | Setting | Effect |
|----------|---------|--------|
| **Retail accessibility** | 100-500 | More small investors |
| **Balanced** | 1000-2000 | Mixed investor base |
| **Institutional focus** | 5000-10000 | Fewer, larger investors |

---

### 4. Risk Management Flags

#### **Enforce Minimum Threshold**
```typescript
enforceMinRaiseThreshold: true
```

**What it does:**
- If `true`: Refund investors if minimum not met
- If `false`: Allow settlement even if below minimum

**Use cases:**
- `true` (default): Protect platform from under-raises
- `false`: Early stage testing, want all listings to close

---

#### **Enforce Maximum Threshold**
```typescript
enforceMaxRaiseThreshold: true
```

**What it does:**
- If `true`: Block purchases exceeding max raise
- If `false`: Allow over-subscription (NOT RECOMMENDED)

**Use cases:**
- `true` (default): Protect investors from overpaying
- `false`: NEVER - would cause investor losses

---

### 5. Distribution Model

```typescript
distributeFullSettlement: true
```

**What it does:**
- If `true`: Distribute `settlement - platformFee` (principal + yield together)
- If `false`: Distribute only yield portion (NOT RECOMMENDED for invoice factoring)

**Current model:**
```
true → Dynamic yield model ✓
  Investors get: (netDistribution / amountRaised) - 1 = yield%
  Single claim, clean lifecycle

false → Separate principal redemption ✗
  Investors need: Claim yield + Redeem principal
  Complex, confusing UX
```

---

## Configuration Management

### View Current Configuration

```bash
GET /admin/platform-config

Response:
{
  "configKey": "default",
  "minRaiseThresholdPercent": 0.30,
  "maxRaiseThresholdPercent": 0.985,
  "platformFeeRate": 0.015,
  "defaultListingDurationDays": 7,
  "minInvestmentTokens": 1000,
  "enforceMinRaiseThreshold": true,
  "enforceMaxRaiseThreshold": true,
  "distributeFullSettlement": true,
  "updatedBy": {
    "admin": "0x123...",
    "timestamp": "2025-12-25T10:00:00Z",
    "reason": "Q1 2025 adjustment"
  }
}
```

---

### Update Configuration

```bash
POST /admin/platform-config

Headers:
  Authorization: Bearer <ADMIN_JWT>

Body:
{
  "minRaiseThresholdPercent": 0.35,  // Change min threshold to 35%
  "defaultListingDurationDays": 10,  // Extend listings to 10 days
  "reason": "Market analysis shows higher quality threshold needed"
}

Response:
{
  "success": true,
  "message": "Platform configuration updated",
  "changes": {
    "minRaiseThresholdPercent": { "old": 0.30, "new": 0.35 },
    "defaultListingDurationDays": { "old": 7, "new": 10 }
  }
}
```

---

### Calculate Thresholds for Specific Invoice

```bash
GET /admin/platform-config/calculate-thresholds?invoiceValue=5000000

Response:
{
  "invoiceValue": 5000000,
  "platformFee": 75000,
  "netDistribution": 4925000,
  "minRaise": 1477500,        // 30% of netDistribution
  "maxRaise": 4925000,        // 98.5% of invoice value
  "raiseWindow": 3447500,     // maxRaise - minRaise
  "yieldRange": {
    "atMinRaise": "233.3%",   // If only ₹14.77L raised
    "atMaxRaise": "0.0%"      // If full ₹49.25L raised
  }
}
```

---

## Real-Time Threshold Validation

### During Token Purchase

**Purchase flow with threshold checks:**

```typescript
// 1. Investor attempts purchase
POST /marketplace/listings/:assetId/buy
{
  "amount": 10000,  // tokens
  "payment": 800000 // USDC (₹8L)
}

// 2. Backend checks thresholds
const config = await platformConfigService.getConfig();
const invoice = asset.metadata.faceValue; // ₹50L
const currentRaised = asset.listing.amountRaised; // ₹45L
const newTotal = currentRaised + payment; // ₹53L

// 3. Validate against max threshold
const maxRaise = invoice * config.maxRaiseThresholdPercent; // ₹49.25L

if (newTotal > maxRaise) {
  const available = maxRaise - currentRaised; // ₹4.25L
  return {
    error: "EXCEEDS_MAX_RAISE",
    message: `Only ₹${available} available. You tried to invest ₹${payment}.`,
    available: available,
    currentRaised: currentRaised,
    maxRaise: maxRaise
  };
}

// 4. Purchase approved
```

---

### Before Settlement

**Settlement flow with minimum check:**

```typescript
// 1. Admin initiates settlement
POST /admin/yield/settle
{
  "assetId": "...",
  "settlementAmount": 5000000
}

// 2. Backend checks if minimum was met
const config = await platformConfigService.getConfig();
const invoice = 5000000;
const netDist = invoice * (1 - config.platformFeeRate); // ₹49.25L
const minRequired = netDist * config.minRaiseThresholdPercent; // ₹14.77L
const actualRaised = asset.listing.amountRaised; // ₹10L

if (actualRaised < minRequired && config.enforceMinRaiseThreshold) {
  return {
    error: "MINIMUM_NOT_MET",
    message: "Cannot settle - minimum raise threshold not met",
    required: minRequired,
    raised: actualRaised,
    shortfall: minRequired - actualRaised,
    action: "REFUND_INVESTORS"
  };
}

// 3. Settlement proceeds
```

---

## Best Practices

### 1. Conservative Defaults
✅ Start with conservative thresholds:
- Min: 30% (balanced risk)
- Max: 98.5% (fixed)
- Duration: 7 days (standard)

### 2. Gradual Adjustments
✅ Change thresholds gradually:
- Don't jump from 30% → 60% minimum
- Increment by 5-10% per adjustment
- Monitor impact before further changes

### 3. Market-Driven
✅ Adjust based on data:
```
Metric                    → Action
========================  → ================================
50%+ listings fail min    → Lower minRaiseThresholdPercent
90%+ listings hit max     → Market is healthy, no change needed
Avg 40% raise rate        → Consider lowering min to 25%
Many ₹49L+ raises         → Investors seeking low yield (quality signal)
Many ₹15-20L raises       → High-yield appetite (adjust accordingly)
```

### 4. Communicate Changes
✅ Announce threshold changes:
- Email investors 7 days before
- Update platform UI with new thresholds
- Explain reasoning (market conditions, risk management)

---

## Monitoring & Analytics

### Key Metrics to Track

```typescript
// Dashboard queries
GET /admin/analytics/raise-metrics

Response:
{
  "last30Days": {
    "totalListings": 45,
    "successfulRaises": 38,
    "failedRaises": 7,
    "avgRaisePercent": 67.3,
    "medianRaisePercent": 72.1,
    "distribution": {
      "0-30%": 5,   // Failed (below min)
      "30-50%": 8,  // Low raise (high yield)
      "50-75%": 15, // Medium raise
      "75-95%": 10, // High raise (low yield)
      "95-98.5%": 7 // Near max (break-even)
    }
  },
  "recommendations": {
    "suggestedMinThreshold": 0.28,  // Slight decrease recommended
    "reasoning": "Only 11% failure rate, can afford to be more aggressive"
  }
}
```

---

## Summary

The configuration system provides:

✅ **Flexibility**: Adjust thresholds based on market conditions
✅ **Safety**: Max threshold protects platform fees
✅ **Risk management**: Min threshold prevents under-capitalized offerings
✅ **Transparency**: All changes logged with admin + reason
✅ **Real-time validation**: Prevents invalid purchases
✅ **Analytics-driven**: Data informs threshold adjustments

**Default Configuration (Recommended):**
```typescript
{
  minRaiseThresholdPercent: 0.30,    // 30% minimum
  maxRaiseThresholdPercent: 0.985,   // 98.5% maximum (FIXED)
  platformFeeRate: 0.015,            // 1.5% fee
  defaultListingDurationDays: 7,     // 1 week
  minInvestmentTokens: 1000,         // ₹1L minimum purchase
  enforceMinRaiseThreshold: true,    // Protect platform
  enforceMaxRaiseThreshold: true,    // Protect investors
  distributeFullSettlement: true     // Dynamic yield model
}
```

This configuration balances **risk**, **variety**, and **platform sustainability**.
