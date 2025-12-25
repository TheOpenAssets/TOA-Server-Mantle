# Dynamic Yield Model - Competitive Invoice Financing

## Overview

This platform implements a **dynamic yield model** where investor returns depend on **how much capital is raised** during the primary sale. This creates competitive market dynamics and allows for variety in investment options.

---

## Core Concept

**Fixed Values:**
- Invoice face value: ₹50,00,000 (what debtor owes)
- Settlement amount: ₹50,00,000 (what platform receives when invoice is paid)
- Platform fee: 1.5% of settlement = **₹75,000**
- **Net distribution: ₹49,25,000** (what gets distributed to investors)

**Variable Value:**
- **Amount raised**: Whatever investors collectively pay during primary sale

**Dynamic Yield Formula:**
```
Yield = (netDistribution - amountRaised) / amountRaised × 100
```

---

## Example Scenarios

### Scenario 1: High Raise (Low Yield)

**Primary Sale:**
- Amount raised: ₹49,00,000
- Tokens sold: 50,000 tokens @ avg ₹98/token
- Capital utilization: 99.5%

**Settlement (90 days later):**
- Settlement received: ₹50,00,000
- Platform fee: ₹75,000
- Net distribution: ₹49,25,000

**Investor Returns:**
- Total return: ₹49,25,000
- Amount paid: ₹49,00,000
- **Profit: ₹25,000**
- **Yield: 0.51%** (in 90 days = 2.04% APR)

**Why low yield?**
Investors paid nearly face value, so little profit margin remains.

---

### Scenario 2: Medium Raise (Medium Yield)

**Primary Sale:**
- Amount raised: ₹40,00,000
- Tokens sold: 50,000 tokens @ avg ₹80/token
- Capital utilization: 81.2%

**Settlement (90 days later):**
- Settlement received: ₹50,00,000
- Platform fee: ₹75,000
- Net distribution: ₹49,25,000

**Investor Returns:**
- Total return: ₹49,25,000
- Amount paid: ₹40,00,000
- **Profit: ₹9,25,000**
- **Yield: 23.1%** (in 90 days = 92.4% APR!)

**Why medium yield?**
Investors paid 20% discount, creating significant profit margin.

---

### Scenario 3: Low Raise (High Yield)

**Primary Sale:**
- Amount raised: ₹32,00,000
- Tokens sold: 50,000 tokens @ avg ₹64/token
- Capital utilization: 65%

**Settlement (90 days later):**
- Settlement received: ₹50,00,000
- Platform fee: ₹75,000
- Net distribution: ₹49,25,000

**Investor Returns:**
- Total return: ₹49,25,000
- Amount paid: ₹32,00,000
- **Profit: ₹17,25,000**
- **Yield: 53.9%** (in 90 days = 215.6% APR!!)

**Why high yield?**
Investors paid steep 36% discount, creating massive profit margin.

---

## Market Dynamics

### For Investors

**Early Buyers (when less is raised):**
- ✅ Higher potential yield
- ⚠️ Higher risk (less capital = less confidence)
- ✅ Better entry price
- ⚠️ More execution risk for originator

**Late Buyers (when more is raised):**
- ⚠️ Lower yield
- ✅ Lower risk (more capital = more confidence)
- ⚠️ Worse entry price
- ✅ Less execution risk

**Decision:**
Investors must balance **risk vs reward** - buy early for higher yield or wait for more validation.

---

### For Platform

**Benefits:**
- ✅ Always earns 1.5% fee regardless of raise amount
- ✅ No need to set fixed pricing
- ✅ Market discovers fair price
- ✅ Creates urgency (better to buy early)
- ✅ Risk is transferred to investors (partial raise = higher yield to compensate)

**Risks:**
- ⚠️ Under-raise risk: If only ₹20L raised, platform must front ₹30L to pay originator
- ⚠️ Reputational risk: Failed raises hurt platform credibility

---

### For Originators

**Benefits:**
- ✅ Faster liquidity than traditional factoring
- ✅ Competitive pricing (market-driven)
- ✅ Transparent process

**Considerations:**
- ⚠️ Amount raised may be less than expected
- ⚠️ Platform may require minimum raise threshold
- ⚠️ Invoice quality directly impacts investor interest

---

## Pricing Strategies

### Strategy 1: Dutch Auction (Recommended)

**How it works:**
- Start at high price (e.g., ₹100/token = ₹50L raise)
- Price decreases linearly over time
- Ends at low price (e.g., ₹60/token = ₹30L raise)
- First buyers pay more, last buyers pay less

**Example:**
- Day 1: ₹100/token → ₹10L raised (10k tokens sold)
- Day 3: ₹85/token → ₹25L raised (30k tokens sold total)
- Day 5: ₹70/token → ₹38L raised (45k tokens sold total)
- **Final: ₹38L raised @ avg price ₹84.4/token**

**Benefits:**
- Fast price discovery
- Creates urgency
- Fair (everyone gets market price or better)
- Optimizes capital raising

---

### Strategy 2: Fixed Price with Bonuses

**How it works:**
- Set fixed price (e.g., ₹80/token)
- Early buyers get bonus tokens
- Late buyers pay same price but get fewer bonus tokens

**Example:**
- Week 1: Buy 1000 tokens @ ₹80, get 10% bonus = 1100 tokens
- Week 2: Buy 1000 tokens @ ₹80, get 5% bonus = 1050 tokens
- Week 3+: Buy 1000 tokens @ ₹80, get 0% bonus = 1000 tokens

**Effective pricing:**
- Week 1 buyers: ₹72.7/token (due to bonus)
- Week 2 buyers: ₹76.2/token
- Week 3 buyers: ₹80/token

---

### Strategy 3: Tiered Pricing

**How it works:**
- Set price tiers based on amount raised
- Price increases as more is raised

**Example:**
- First ₹10L: ₹70/token
- Next ₹15L: ₹80/token
- Next ₹15L: ₹90/token
- Final ₹9.25L: ₹100/token

**Results:**
- Early buyers: Best price
- Late buyers: Worst price
- Incentivizes early participation

---

## Risk Management

### Minimum Raise Threshold (Configurable)

**Default Configuration: 30% of Net Distribution**

For a ₹50L invoice:
- Net distribution: ₹49.25L
- Minimum raise: 30% × ₹49.25L = **₹14.77L**

**If minimum not met:**
- Listing expires or closes early
- All investors refunded (Option A: Minimum or Refund)
- Invoice not funded
- Platform takes no risk

**Why 30%?**
- Balances risk vs opportunity
- Too low (10%) = extreme platform risk
- Too high (80%) = limits high-yield opportunities
- 30% = reasonable floor for liquidity

**Configuration:**
```typescript
// Admin can adjust via platform-config
minRaiseThresholdPercent: 0.30  // 30%

// Can be changed to:
// 0.20 = 20% (more risk, more variety)
// 0.50 = 50% (less risk, fewer offerings)
```

---

### Maximum Raise Threshold (Fixed at 98.5%)

**Why 98.5%?**
Platform fee is 1.5%, so maximum raise must leave room for the fee.

For a ₹50L invoice:
- Invoice value: ₹50,00,000
- Maximum raise: 98.5% × ₹50L = **₹49,25,000**
- Platform fee: 1.5% × ₹50L = **₹75,000**
- Net distribution: ₹50L - ₹75K = ₹49.25L

**Enforcement:**
- Marketplace rejects purchases that would exceed max
- Example: ₹49L already raised, investor tries to buy ₹1L worth
- System blocks purchase (would total ₹50L > ₹49.25L max)
- Available for purchase: ₹49.25L - ₹49L = **₹25,000**

**Configuration:**
```typescript
// Fixed in platform-config (shouldn't change)
maxRaiseThresholdPercent: 0.985  // 98.5%

// This ensures platform always gets 1.5% fee
// If raised = ₹49.25L, settlement = ₹50L
// Platform profit = ₹75,000 guaranteed
```

**Important:** This is a **hard cap**. First-come-first-served once max is reached.

---

## Implementation Status

### ✅ Completed

1. **Settlement Schema Updated**
   - Tracks `amountRaised` during primary sale
   - Calculates `netDistribution` (settlement - platform fee)
   - Stores `platformFeeRate` (1.5%)
   - Records effective yield for analytics

2. **Yield Distribution Service Updated**
   - Reads `amountRaised` from asset listing
   - Distributes full `netDistribution` amount
   - Logs effective yield on settlement
   - Validates distribution >= amount raised

3. **Asset Schema Updated**
   - Added `listing.amountRaised` field
   - Tracks total capital raised during primary sales

### ⚠️ Pending

1. **Primary Market Purchase Tracking**
   - Need to update `listing.amountRaised` on every token purchase
   - Track in PrimaryMarketplace or via backend webhook
   - Real-time updates for investors to see current raise amount

2. **Frontend Display**
   - Show current `amountRaised` vs target
   - Calculate and display projected yield based on current raise
   - "If you buy now at current price, you'll get X% yield"

3. **Risk Management Rules**
   - Implement minimum raise threshold
   - Implement maximum raise cap
   - Handle failed raises (refund logic)

---

## Next Steps

### 1. Track Amount Raised During Sales

Update marketplace contract or backend to increment `asset.listing.amountRaised` on every purchase:

```typescript
// In marketplace purchase handler
async function onTokenPurchase(assetId: string, buyer: string, amount: bigint, payment: bigint) {
  await assetModel.updateOne(
    { assetId },
    {
      $inc: {
        'listing.sold': amount.toString(),
        'listing.amountRaised': payment.toString(), // Add this!
      }
    }
  );
}
```

### 2. Add Projected Yield API

```typescript
GET /marketplace/listings/:assetId/projected-yield

Response:
{
  "assetId": "...",
  "faceValue": 5000000,
  "currentRaised": 3200000,
  "netDistribution": 4925000,
  "projectedYield": 53.9,  // (4925000 - 3200000) / 3200000 * 100
  "raiseProgress": 65.0,    // 3200000 / 4925000 * 100
  "daysRemaining": 5
}
```

### 3. Frontend Competitive Display

```
Current Offerings:

Invoice A: Flipkart (₹50L)
  ├─ Raised: ₹32L / ₹49.25L (65%)
  ├─ Current Yield: 53.9%
  ├─ Risk: Medium (partial raise)
  └─ Buy Now @ ₹64/token

Invoice B: Amazon (₹100L)
  ├─ Raised: ₹95L / ₹98.5L (96%)
  ├─ Current Yield: 3.7%
  ├─ Risk: Low (almost full raise)
  └─ Buy Now @ ₹95/token

Invoice C: Myntra (₹25L)
  ├─ Raised: ₹15L / ₹24.63L (61%)
  ├─ Current Yield: 64.2%
  ├─ Risk: High (low raise)
  └─ Buy Now @ ₹60/token
```

Investors can compare risk/reward across multiple invoices!

---

## Summary

This **dynamic yield model** creates:

✅ **Market efficiency** - Price discovery through competitive buying
✅ **Risk-adjusted returns** - Higher yield compensates for lower raise
✅ **Investor choice** - Variety of risk/reward profiles
✅ **Platform protection** - Always earns 1.5% fee
✅ **Fair pricing** - Market determines value, not platform

**Key Formula:**
```
Yield = (settlementAmount × 0.985 - amountRaised) / amountRaised
```

The less investors raise collectively, the higher the yield. This is the essence of competitive, market-driven invoice financing!
