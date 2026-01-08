# Token Ownership & P2P Trading - Architecture Analysis

## 🎯 Current State Analysis

### Existing Token Tracking Systems:

1. **Purchase Schema** (`purchase.schema.ts`)
   - Tracks PRIMARY MARKET purchases only
   - Status: CONFIRMED (owns tokens) or CLAIMED (burned for yield)
   - Does NOT track P2P trades currently ❌

2. **LeveragePosition Schema** (`leverage-position.schema.ts`)
   - Tracks tokens bought with leverage
   - Tokens held in LeverageVault, NOT in user's wallet
   - rwaTokenAmount field shows amount

3. **P2PTrade Schema** (`p2p-trade.schema.ts`)
   - Tracks secondary market trades
   - Has buyer and seller addresses
   - Currently NOT integrated with portfolio calculations ❌

4. **YieldClaim Schema** (`yield-claim.schema.ts`)
   - Tracks when users burn tokens for yield
   - tokensBurned field

---

## 🔴 Critical Issues Identified

### Issue 1: No On-Chain Balance Verification
**Problem**: Backend doesn't fetch actual token balance from contract before allowing trades
**Impact**: Users could create sell orders for tokens they don't own
**Solution**: Create TokenBalanceService to query `balanceOf(address)` from RWAToken contract

### Issue 2: Purchase Tracker Doesn't Include P2P Trades
**Problem**: getInvestorPortfolio() only counts primary market purchases, ignoring P2P buys/sells
**Impact**: Portfolio shows incorrect token ownership
**Solution**: Update portfolio calculation to include P2PTrade records

### Issue 3: No Distinction Between Tradeable vs Non-Tradeable Tokens
**Problem**: Portfolio shows all tokens including those in LeverageVault
**Impact**: Users might try to trade tokens they don't actually control
**Solution**: Calculate "tradeable balance" by subtracting leveraged positions

### Issue 4: Escrow Tokens Not Tracked
**Problem**: When user creates sell order, tokens locked in SecondaryMarket contract aren't subtracted from available balance
**Impact**: User could lock same tokens in multiple orders
**Solution**: Track active P2P orders and subtract from tradeable balance

### Issue 5: Unclaimed Auction Tokens Not Handled
**Problem**: No explicit handling for auction wins that haven't claimed tokens yet
**Impact**: Should be minimal since tokens won't be in wallet until claimed
**Risk Level**: LOW (contract will reject trades naturally)

---

## ✅ Correct Token Ownership Flow

### Primary Market Purchase:
```
1. User buys from PrimaryMarketplace
2. TokensPurchased event emitted
3. Backend creates Purchase record (status: CONFIRMED)
4. Tokens transferred to user's wallet
5. User owns tokens ✅
```

### Leverage Purchase:
```
1. User deposits mETH + borrows USDC
2. LeverageVault buys RWA tokens
3. Backend creates LeveragePosition record
4. Tokens held in LeverageVault (NOT user's wallet)
5. User does NOT own tokens directly ❌
```

### Auction Win:
```
1. User wins auction
2. Admin calls endAuction()
3. Backend creates Purchase record (status: CONFIRMED)
4. Tokens transferred to user's wallet
5. User owns tokens ✅
```

### Yield Claim (Burning):
```
1. User burns tokens for USDC yield
2. TokensBurned event emitted
3. Backend updates Purchase status to CLAIMED
4. Backend creates YieldClaim record
5. User no longer owns those tokens ❌
```

### P2P Sell Order Creation:
```
1. User creates sell order
2. Tokens locked in SecondaryMarket contract (escrow)
3. Backend creates P2POrder record
4. Tokens temporarily not in user's wallet (in escrow)
5. Yield accrues to escrow during this time
6. User CANNOT trade these tokens again ❌
```

### P2P Order Fill:
```
1. Buyer fills sell order
2. OrderFilled event emitted
3. Backend creates P2PTrade record
4. Backend updates P2POrder (FILLED status)
5. Seller's Purchase record should be marked as SOLD ❌ (missing)
6. Buyer should get new Purchase record ❌ (missing)
7. Tokens transferred to buyer's wallet
8. Buyer now owns tokens ✅
```

---

## 🏗️ Required Architecture Changes

### 1. Create TokenBalanceService

**Purpose**: Fetch actual on-chain balance for RWA tokens

```typescript
@Injectable()
export class TokenBalanceService {
  /**
   * Get user's actual wallet balance from RWAToken contract
   */
  async getWalletBalance(userAddress: string, tokenAddress: string): Promise<string>
  
  /**
   * Get tradeable balance (wallet balance - locked in orders)
   */
  async getTradeableBalance(userAddress: string, assetId: string): Promise<{
    walletBalance: string;
    lockedInOrders: string;
    inLeverageVault: string;
    tradeableBalance: string;
  }>
}
```

### 2. Update SecondaryMarketService

**Add balance validation before creating orders:**

```typescript
async validateCreateOrder(userAddress: string, assetId: string, amount: string, isBuy: boolean) {
  if (!isBuy) {
    // Selling - must own tokens
    const balance = await this.tokenBalanceService.getTradeableBalance(userAddress, assetId);
    if (BigInt(balance.tradeableBalance) < BigInt(amount)) {
      throw new BadRequestException('Insufficient balance');
    }
  } else {
    // Buying - must have USDC (already handled by contract)
  }
}
```

### 3. Create P2P Trade Tracking in Purchase Model

**Option A**: Add a new "source" field to Purchase schema
```typescript
{
  source: 'PRIMARY_MARKET' | 'SECONDARY_MARKET' | 'LEVERAGE_SETTLEMENT',
  p2pTradeId?: string, // Reference to P2PTrade if applicable
}
```

**Option B**: Create separate TransferRecord schema to track all token movements
```typescript
{
  from: string;
  to: string;
  assetId: string;
  amount: string;
  type: 'MINT' | 'PRIMARY_PURCHASE' | 'P2P_TRADE' | 'LEVERAGE' | 'BURN';
  txHash: string;
  timestamp: Date;
}
```

### 4. Update SecondaryMarketIndexer

**On OrderFilled event, create ownership records:**

```typescript
private async handleOrderFilled(args: any, txHash: string, ...) {
  // ... existing code ...
  
  // Update ownership tracking
  if (order.isBuy) {
    // Maker was buyer, taker was seller
    await this.updateOwnership({
      from: taker,
      to: maker,
      assetId: order.assetId,
      amount: amountFilled,
      txHash,
      type: 'P2P_TRADE'
    });
  } else {
    // Maker was seller, taker was buyer
    await this.updateOwnership({
      from: maker,
      to: taker,
      assetId: order.assetId,
      amount: amountFilled,
      txHash,
      type: 'P2P_TRADE'
    });
  }
}
```

### 5. Create Unified Portfolio Service

**Consolidate all token ownership sources:**

```typescript
@Injectable()
export class UnifiedPortfolioService {
  async getCompletePortfolio(userAddress: string) {
    // 1. Fetch on-chain balances for all tokens
    const walletBalances = await this.getWalletBalances(userAddress);
    
    // 2. Fetch leverage positions (tokens in vault)
    const leveragePositions = await this.getLeveragePositions(userAddress);
    
    // 3. Fetch active P2P orders (tokens locked in escrow)
    const activeOrders = await this.getActiveP2POrders(userAddress);
    
    // 4. Calculate tradeable vs non-tradeable
    return {
      assets: [
        {
          assetId: '...',
          tokenAddress: '...',
          walletBalance: '1000', // From contract
          lockedInOrders: '200', // Active P2P sell orders
          inLeverageVault: '500', // From LeveragePosition
          tradeableBalance: '300', // walletBalance - lockedInOrders
          totalOwned: '800', // walletBalance + inLeverageVault (but vault not accessible)
        }
      ]
    };
  }
}
```

---

## 📊 Data Flow Diagrams

### Current Flow (❌ Incomplete):
```
Primary Purchase → Purchase DB → Portfolio
Leverage Purchase → LeveragePosition DB → Portfolio
P2P Trade → P2PTrade DB → ❌ NOT in Portfolio
```

### Correct Flow (✅):
```
Primary Purchase → Purchase DB + On-chain → Portfolio
Leverage Purchase → LeveragePosition DB + LeverageVault → Portfolio (non-tradeable)
P2P Trade → P2PTrade DB + On-chain → Portfolio (ownership transfer)
Active P2P Order → P2POrder DB + SecondaryMarket → Reduce tradeable balance
```

---

## 🔐 Security Considerations

### 1. Balance Check Timing
**Problem**: User's balance could change between frontend check and transaction execution
**Solution**: 
- Frontend checks balance for UX
- Smart contract enforces balance in transaction (already done ✅)
- Backend validates balance when providing tx data

### 2. Double-Spending Prevention
**Problem**: User creates multiple sell orders for same tokens
**Solution**:
- Calculate locked balance from active P2P orders
- Subtract locked balance from tradeable balance
- Reject order creation if insufficient tradeable balance

### 3. Leverage Vault Tokens
**Problem**: Tokens in LeverageVault shouldn't be tradeable
**Solution**:
- Fetch on-chain balance (will be 0 if tokens in vault)
- LeveragePosition shows "in leverage" status
- Frontend shows as "Non-Tradeable (Leveraged)"

---

## 🚀 Implementation Priority

### Phase 1: Critical (Implement Immediately)
1. ✅ Create TokenBalanceService
2. ✅ Add balance validation to SecondaryMarketService
3. ✅ Update SecondaryMarketIndexer to track ownership changes
4. ✅ Add "locked in orders" calculation

### Phase 2: Important (This Week)
5. ✅ Create UnifiedPortfolioService
6. ✅ Update frontend to use new portfolio endpoint
7. ✅ Add "tradeable vs non-tradeable" display in UI
8. ✅ Update getInvestorPortfolio to include P2P trades

### Phase 3: Enhancement (Next Week)
9. ⭕ Add TransferRecord schema for complete audit trail
10. ⭕ Add ownership history endpoint
11. ⭕ Add analytics for P2P trading volume
12. ⭕ Add "avg purchase price" calculations including P2P

---

## 📝 Database Schema Updates

### Purchase Schema - Add P2P Support
```typescript
{
  // ... existing fields ...
  source: {
    type: String,
    enum: ['PRIMARY_MARKET', 'AUCTION', 'SECONDARY_MARKET'],
    default: 'PRIMARY_MARKET'
  },
  p2pTradeId: {
    type: String, // Reference to P2PTrade._id
    required: false
  },
  // Track if tokens were sold on secondary market
  soldOnSecondaryMarket: {
    type: Boolean,
    default: false
  },
  soldP2PTradeId: {
    type: String,
    required: false
  }
}
```

### P2POrder Schema - Add Lock Tracking
```typescript
{
  // ... existing fields ...
  // Tokens are locked in SecondaryMarket contract while order is active
  tokensLocked: {
    type: Boolean,
    default: true // For sell orders
  },
  // Track if user canceled (to unlock balance)
  cancelledAt: Date,
  cancelTxHash: String
}
```

---

## 🧪 Testing Scenarios

### Test 1: Basic P2P Trade
1. User A has 100 tokens (verify on-chain)
2. User A creates sell order for 50 tokens
3. Check tradeable balance = 50 (100 - 50 locked)
4. User B fills order
5. Check User A balance = 50 on-chain
6. Check User B balance = 50 on-chain
7. Check portfolio shows correct amounts for both

### Test 2: Leverage Tokens Not Tradeable
1. User A has 100 tokens in wallet + 200 in LeverageVault
2. Check tradeable balance = 100 (not 300)
3. User A tries to create sell order for 150 tokens
4. Should FAIL (insufficient tradeable balance)

### Test 3: Double-Spend Prevention
1. User A has 100 tokens
2. User A creates sell order for 80 tokens
3. User A tries to create another sell order for 40 tokens
4. Should FAIL (only 20 tradeable remaining)

### Test 4: Order Cancellation
1. User A creates sell order for 50 tokens (locked)
2. Tradeable balance = wallet - 50
3. User A cancels order
4. Tradeable balance = wallet (tokens unlocked)

### Test 5: Yield Claim After P2P
1. User B buys 50 tokens via P2P
2. Asset settles, yield distributed
3. User B burns 50 tokens for yield
4. Check Purchase status updated to CLAIMED
5. Check YieldClaim record created

---

## 📚 API Endpoints Needed

### Token Balance Endpoints
```http
GET /tokens/:tokenAddress/balance/:userAddress
# Returns: { walletBalance, lockedInOrders, inLeverageVault, tradeableBalance }

GET /portfolio/:userAddress/complete
# Returns unified portfolio with tradeable status for each asset

GET /marketplace/secondary/:assetId/my-balance
# Returns user's tradeable balance for specific asset
```

### P2P Order Validation
```http
POST /marketplace/secondary/validate-order
Body: { userAddress, assetId, amount, isBuy }
# Returns: { valid: boolean, reason?: string, tradeableBalance?: string }
```

---

## ✅ Summary

The current implementation has the foundation but is **missing critical ownership tracking for P2P trades**. The main gaps are:

1. ❌ No on-chain balance verification
2. ❌ P2P trades not reflected in portfolio
3. ❌ No distinction between tradeable vs locked/leveraged tokens
4. ❌ No prevention of double-spending via multiple orders

The solution requires:
1. ✅ TokenBalanceService for on-chain queries
2. ✅ Balance validation in SecondaryMarketService
3. ✅ Ownership tracking in SecondaryMarketIndexer
4. ✅ UnifiedPortfolioService to consolidate all sources
5. ✅ Update Purchase schema to track P2P trades

**Implementation order**: TokenBalanceService → Validation → Indexer Updates → Portfolio Service

This ensures that the system maintains consistency between on-chain state and backend database, preventing trades of tokens users don't actually own while properly tracking ownership changes through P2P trades.
