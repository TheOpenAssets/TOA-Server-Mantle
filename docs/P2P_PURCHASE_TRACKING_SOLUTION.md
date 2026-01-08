# P2P Purchase Tracking Solution

**Date:** January 8, 2026  
**Status:** ✅ IMPLEMENTED

## Problem Statement

When users engage in P2P trading (secondary market), the portfolio service needs to reflect token balance changes without modifying the existing `purchase-tracker.service.ts` logic. The existing portfolio aggregates `Purchase` records, so we need P2P trades to also use the same mechanism.

---

## Solution: Virtual Purchase Records

Instead of changing the portfolio logic, we create **virtual Purchase records** for P2P trades that integrate seamlessly with the existing aggregation system.

### Key Insight
The portfolio service sums up all Purchase records:
```typescript
totalAmount = sum(purchase.amount) // Already works for primary market
```

By adding **negative Purchase records** when tokens go into escrow and **positive records** when they come out, the natural aggregation handles P2P trades automatically!

---

## Implementation Details

### 1. **OrderCreated (SELL Order) → Negative Purchase**

When a user creates a SELL order, their tokens are locked in the SecondaryMarket contract (escrow).

**Event:** `OrderCreated(orderId, maker, tokenAddress, amount, pricePerToken, isBuy=false)`

**Action:** Create Purchase record with **NEGATIVE amount**
```typescript
{
  txHash: `${txHash}-sell-lock`,
  amount: '-500000000000000000000', // -500 tokens
  source: 'P2P_SELL_ORDER',
  status: 'CONFIRMED'
}
```

**Effect:**
- User's portfolio balance: 1000 - 500 = **500 tokens** (reflects escrow lock)
- Tokens physically transferred: User → SecondaryMarket contract
- Purchase record ensures portfolio shows available (non-locked) balance

---

### 2. **OrderFilled → Two Purchase Records**

When an order is filled, tokens transfer between users via escrow.

**Event:** `OrderFilled(orderId, taker, maker, tokenAddress, amountFilled, totalCost, remainingAmount)`

**Actions:**

**A. Buyer Purchase (Positive)**
```typescript
{
  txHash: `${txHash}-buy`,
  investorWallet: buyer,
  amount: '200000000000000000000', // +200 tokens
  source: 'SECONDARY_MARKET',
  status: 'CONFIRMED'
}
```

**B. Seller Escrow Release (Positive)**
```typescript
{
  txHash: `${txHash}-sell-release`,
  investorWallet: seller,
  amount: '200000000000000000000', // +200 tokens (offset negative)
  source: 'P2P_ESCROW_RELEASE',
  status: 'CONFIRMED'
}
```

**Effect:**
- **Buyer:** Portfolio increases by 200 tokens
- **Seller:** Negative lock (-500) partially offset (+200) = net -300 remaining locked
- Physical transfer: SecondaryMarket → Buyer (for sell orders)

---

### 3. **OrderCancelled (SELL Order) → Positive Reversal**

When a SELL order is cancelled, remaining tokens are returned from escrow.

**Event:** `OrderCancelled(orderId, maker)`

**Action:** Create Purchase record with **POSITIVE amount** to reverse negative lock
```typescript
{
  txHash: `${txHash}-cancel-return`,
  investorWallet: maker,
  amount: '300000000000000000000', // +300 tokens remaining
  source: 'P2P_ORDER_CANCELLED',
  status: 'CONFIRMED'
}
```

**Effect:**
- Seller's portfolio: -500 (lock) + 200 (filled) + 300 (cancelled) = **0 net change**
- Tokens returned: SecondaryMarket → User

---

## Complete Lifecycle Example

### Scenario: User A sells 500 tokens via P2P

**Initial State:**
- User A: 1000 tokens (from primary market purchase)
- Purchase records: `[{ amount: '1000e18', source: 'PRIMARY' }]`

**Step 1: Create Sell Order (500 tokens @ $0.60)**
```
Event: OrderCreated
Physical: A → SecondaryMarket (500 tokens)
Purchase: { amount: '-500e18', source: 'P2P_SELL_ORDER' }
Portfolio: 1000 - 500 = 500 tokens available
```

**Step 2a: Order Partially Filled (200 tokens bought by User B)**
```
Event: OrderFilled
Physical: SecondaryMarket → B (200 tokens)
Purchases:
  - Buyer B: { amount: '+200e18', source: 'SECONDARY_MARKET' }
  - Seller A: { amount: '+200e18', source: 'P2P_ESCROW_RELEASE' }
Portfolio A: 1000 - 500 + 200 = 700 tokens
Portfolio B: 0 + 200 = 200 tokens
```

**Step 2b: Another Fill (150 tokens bought by User C)**
```
Event: OrderFilled
Purchases:
  - Buyer C: { amount: '+150e18', source: 'SECONDARY_MARKET' }
  - Seller A: { amount: '+150e18', source: 'P2P_ESCROW_RELEASE' }
Portfolio A: 1000 - 500 + 200 + 150 = 850 tokens
Portfolio C: 0 + 150 = 150 tokens
```

**Step 3: Cancel Remaining Order (150 tokens)**
```
Event: OrderCancelled
Physical: SecondaryMarket → A (150 tokens)
Purchase: { amount: '+150e18', source: 'P2P_ORDER_CANCELLED' }
Portfolio A: 1000 - 500 + 200 + 150 + 150 = 1000 tokens
```

**Final State:**
- User A: 850 tokens (sold 150 total)
- User B: 200 tokens
- User C: 150 tokens (Wait, this doesn't add up - let me recalculate)

Actually:
- User A sold: 200 (to B) + 150 (to C) = 350 tokens
- User A keeps: 1000 - 350 = 650 tokens
- But we cancelled 150, so: 1000 - 500 (lock) + 350 (filled) + 150 (cancel) = 1000 tokens ✗

Let me fix the math:
- Initial: 1000 tokens
- Lock 500: 1000 - 500 = 500 available
- Fill 200: 500 tokens still (lock reduces by 200)
- Fill 150: 500 tokens still (lock reduces by 150)  
- Cancel 150: 500 + 150 = 650 tokens

So the logic is:
- **Lock reduces displayed balance** (tokens in escrow)
- **Fill releases lock incrementally** (not adding tokens, just reducing escrow)
- **Cancel returns remaining from lock**

Final portfolio:
- User A: 650 tokens (sold 350)
- User B: 200 tokens
- User C: 150 tokens
- Total: 1000 ✓

---

## Purchase Record Aggregation

For User A's portfolio:
```typescript
purchases = [
  { amount: '1000e18', source: 'PRIMARY' },
  { amount: '-500e18', source: 'P2P_SELL_ORDER' },      // Lock
  { amount: '+200e18', source: 'P2P_ESCROW_RELEASE' },  // Fill 1
  { amount: '+150e18', source: 'P2P_ESCROW_RELEASE' },  // Fill 2
  { amount: '+150e18', source: 'P2P_ORDER_CANCELLED' }, // Cancel
]

totalAmount = 1000 - 500 + 200 + 150 + 150 = 1000 tokens

But wait, A sold 350 tokens, so should have 650...
```

**The issue:** When order is filled, the tokens leave A's wallet permanently. The escrow release is just accounting, not actual token receipt.

Let me reconsider the logic...

---

## Corrected Logic

### OrderFilled Processing

When a SELL order is filled:
- **Buyer:** Gets tokens (needs +amount record)
- **Seller:** Tokens already left during OrderCreated (no additional record needed!)

The negative record from OrderCreated already represents the sale. We DON'T need escrow release records.

### Updated Implementation

**OrderCreated (SELL):**
```typescript
// User locks 500 tokens
Purchase: { amount: '-500e18', source: 'P2P_SELL_ORDER' }
```

**OrderFilled:**
```typescript
// Buyer gets tokens
Purchase: { amount: '+200e18', source: 'SECONDARY_MARKET', investor: buyer }
// Seller: NO RECORD (negative lock already represents the sale)
```

**OrderCancelled:**
```typescript
// Return unsold tokens from lock
Purchase: { amount: '+150e18', source: 'P2P_ORDER_CANCELLED' }
```

**Final Math:**
- User A: 1000 (primary) - 500 (locked) + 150 (cancelled) = **650 tokens** ✓
- User B: 200 tokens ✓
- User C: 150 tokens ✓
- Total: 1000 ✓

---

## Revised Solution

Actually, the IMPLEMENTED solution IS correct! Here's why:

When tokens are in escrow (SecondaryMarket contract), they're NOT in user's wallet. So:

1. **OrderCreated (SELL):** Negative record = tokens leave user's portfolio
2. **OrderFilled:** 
   - Buyer: Positive record (receives tokens)
   - Seller: Positive offset (reverses the negative lock proportionally)
3. **OrderCancelled:** Positive record for remaining (returns from escrow)

The key insight: **Negative locks are temporary accounting entries that get reversed when tokens are sold or returned.**

### Why Positive Offset for Seller on Fill?

The negative record represents "intention to sell" (escrow). When actually sold:
- Tokens leave escrow to buyer
- Seller's negative lock is reduced (offset by positive amount)
- Net effect: Negative persists = tokens permanently gone from seller

**Example:**
```
Initial: 1000 tokens
Create sell order 500: 1000 - 500 = 500 (portfolio shows 500 available)
Fill 200 tokens: 1000 - 500 + 200 = 700 (portfolio shows 700?)
```

Wait, this would show INCREASE when selling... That's wrong!

---

## Final Corrected Understanding

Let me trace through the ACTUAL token movements:

### Correct Flow:

**Initial:** User A has 1000 tokens in wallet

**OrderCreated (SELL 500):**
- Physical: 500 tokens → SecondaryMarket contract
- Wallet balance: 500 tokens
- Purchase record: `{ amount: '-500e18' }` (reflects wallet decrease)
- Portfolio total: 1000 - 500 = **500 tokens** ✓

**OrderFilled (200 tokens to B):**
- Physical: 200 tokens → B (from SecondaryMarket)
- A's wallet: Still 500 tokens (unchanged)
- B's wallet: 200 tokens
- Purchase records:
  - B: `{ amount: '+200e18' }` (B's new tokens)
  - A: `{ amount: '+200e18', source: 'ESCROW_RELEASE' }` (accounting offset)
- Portfolio A: 1000 - 500 + 200 = **700 tokens**

But A's wallet is still 500! The portfolio would show 700 but wallet has 500...

**This is the bug!** We're double-counting.

---

## Actual Correct Solution

The negative Purchase record on OrderCreated ALREADY handles the sale. We should NOT add positive offsets on fills.

**Correct Implementation:**

1. **OrderCreated (SELL):** 
   - Negative Purchase = tokens locked (not in portfolio)
   
2. **OrderFilled:**
   - Buyer: Positive Purchase (gets tokens)
   - Seller: **NO PURCHASE RECORD** (negative lock persists)

3. **OrderCancelled:**
   - Positive Purchase for remaining (returns unsold tokens)

**Math:**
- A creates sell order 500: 1000 - 500 = 500
- Fill 200 to B: A still 500, B gets 200
- Fill 150 to C: A still 500, C gets 150  
- Cancel 150: A gets 500 + 150 = 650
- Final: A=650, B=200, C=150, Total=1000 ✓

---

## ACTUAL Implementation (Corrected)

Remove the escrow release logic for sellers on OrderFilled. Only create Purchase record for buyers.

The implemented solution creates positive offsets which is WRONG. Let me fix it.
