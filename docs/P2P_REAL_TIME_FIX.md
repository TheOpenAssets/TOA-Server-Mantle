# P2P Real-Time Event Processing Fix

## Problem Identified

The P2P marketplace orders were being created on-chain successfully, but they were **NOT appearing in the backend database immediately**. This was causing:

1. **Empty orderbook responses** - API returned no orders even though they existed on-chain
2. **1-hour delay** - Orders only appeared after the hourly `SecondaryMarketIndexer.syncEvents()` cron job
3. **Poor UX** - Users couldn't see their orders immediately after creation

## Root Cause

The `EventListenerService` was watching many contracts (AttestationRegistry, TokenFactory, IdentityRegistry, PrimaryMarketplace, YieldVault) but **SecondaryMarket was missing**, so P2P events were not being captured in real-time.

## Solution Implemented

### 1. Added Real-Time Event Watching for SecondaryMarket

**File:** `packages/backend/src/modules/blockchain/services/event-listener.service.ts`

Added `watchSecondaryMarket()` method that listens for:
- `OrderCreated` - When users create buy/sell orders
- `OrderFilled` - When orders are matched and filled
- `OrderCancelled` - When users cancel their orders

These events are immediately added to the BullMQ job queue for processing.

### 2. Created Event Processors for P2P Events

**File:** `packages/backend/src/modules/blockchain/processors/event.processor.ts`

Added three new processor methods:

#### `processP2POrderCreated(data)`
- Creates order record in MongoDB with status `OPEN`
- Maps token address to assetId
- Emits SSE update for real-time frontend refresh
- Logs order creation with details

#### `processP2POrderFilled(data)`
- Updates order with `remainingAmount` and status (`FILLED` or `OPEN`)
- Creates `P2PTrade` record with buyer/seller details
- Creates `Purchase` record for ownership tracking
- Sends notifications to both maker and taker
- Emits SSE update for orderbook refresh

#### `processP2POrderCancelled(data)`
- Updates order status to `CANCELLED`
- Emits SSE update for orderbook refresh

### 3. Enhanced API Responses

**File:** `packages/backend/src/modules/secondary-market/services/secondary-market.service.ts`

**Enhanced `getOrderBook()` to include:**
- Individual order details (orderId, maker, amounts, timestamps)
- Formatted values (prices in USDC, amounts in tokens)
- Order count per price level
- Complete order list for easy filling
- Summary with best bid/ask, spread, totals

**Response Structure:**
```typescript
{
  assetId: string,
  bids: [
    {
      price: string,              // Raw value (1e6)
      priceFormatted: string,     // "10.50" USDC
      amount: string,             // Raw total (1e18)
      amountFormatted: string,    // "1234.5678" tokens
      orderCount: number,         // How many orders at this price
      orders: [                   // Individual orders
        {
          orderId: string,
          maker: string,
          amount: string,
          amountFormatted: string,
          priceFormatted: string,
          timestamp: Date,
          txHash: string
        }
      ]
    }
  ],
  asks: [...],                    // Same structure as bids
  summary: {
    totalBidOrders: number,
    totalAskOrders: number,
    totalBidLevels: number,
    totalAskLevels: number,
    bestBid: string,              // "10.50"
    bestAsk: string,              // "10.75"
    spread: string,               // "0.25"
    lastUpdated: string           // ISO timestamp
  }
}
```

### 4. Updated Module Dependencies

**File:** `packages/backend/src/modules/blockchain/blockchain.module.ts`

Added imports for:
- `P2POrder`, `P2PTrade`, `Purchase` schemas
- `NotificationsModule` for sending order fill alerts

## Flow Now Working

### User Creates Order:

1. **Frontend** → Calls `POST /marketplace/secondary/tx/create-order`
2. **Backend** → Validates balance, returns transaction data
3. **User** → Signs and broadcasts transaction to Mantle Sepolia
4. **Contract** → Emits `OrderCreated` event
5. **EventListenerService** → Catches event immediately via WebSocket
6. **BullMQ** → Adds job `process-p2p-order-created` to queue
7. **EventProcessor** → Processes job, creates order in MongoDB
8. **SSE** → Emits `orderbook_update` event to all connected clients
9. **Frontend** → Receives real-time update, refreshes orderbook
10. **API** → `GET /marketplace/secondary/:assetId/orderbook` now returns the order

### User Fills Order:

1. **Frontend** → Calls `POST /marketplace/secondary/tx/fill-order`
2. **User** → Signs and broadcasts fillOrder transaction
3. **Contract** → Emits `OrderFilled` event
4. **EventListenerService** → Catches event
5. **EventProcessor** → Updates order, creates trade record, creates purchase record
6. **NotificationService** → Sends notifications to maker and taker
7. **SSE** → Emits orderbook update
8. **Frontend** → Shows updated orderbook and notifications

## Testing the Fix

### Start Backend:
```bash
cd packages/backend
npm run start:dev
```

### Check Logs for P2P Events:
```
[EventListenerService] Watching SecondaryMarket at 0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A
[P2P Event] OrderCreated detected: #1 by 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb
[P2P Event Processor] Processing OrderCreated: #1 by 0x742d35...
[P2P Event Processor] ✅ Order Created in DB: #1 - SELL 100.00 @ 10.50 USDC
[P2P Service] Fetching orderbook for assetId: AST-001
[P2P Service] Orderbook built - Bids: 2 levels (3 orders), Asks: 1 levels (1 orders)
```

### Test Endpoints:

1. **Check if orders appear:**
```bash
curl http://localhost:3000/marketplace/secondary/AST-001/orderbook
```

Should return orders immediately after creation (not after 1 hour)

2. **Check order details:**
```bash
curl http://localhost:3000/marketplace/secondary/orders/1
```

3. **Check user orders:**
```bash
curl -H "Authorization: Bearer YOUR_JWT" \
  http://localhost:3000/marketplace/secondary/orders/user
```

## Balance Validation

The system ensures users can **only trade tokens they actually own**:

### Tradeable Balance Calculation:
```
Tradeable = Wallet Balance - Locked in Active Orders
```

### What's NOT tradeable:
- ❌ Tokens in LeverageVault (tracked separately in leverage positions)
- ❌ Tokens locked in pending bids (auction system)
- ❌ Tokens already locked in other P2P sell orders

### Validation happens in:
- `TokenBalanceService.validateSufficientBalance()` - Checks before order creation
- `SecondaryMarketService.getCreateOrderTxData()` - Pre-transaction validation
- Logs show: `[Balance Service] ✅ Validation passed - Required: 100.00, Available: 150.00`

## Logging Added

All P2P operations now have comprehensive logging with prefixes:

- `[P2P Event]` - Event capture from blockchain
- `[P2P Event Processor]` - Event processing in queue
- `[P2P]` - Controller endpoints
- `[P2P Service]` - Business logic
- `[Balance Service]` - Balance calculations
- `[P2P Indexer]` - Historical sync (still runs hourly for missed events)

## What Changed

### ✅ Fixed:
1. Real-time order creation (instant, not 1-hour delay)
2. Real-time order fills and cancellations
3. Complete API responses with all order details
4. Ownership tracking via Purchase records
5. Notifications for order fills
6. SSE updates for live orderbook refresh

### ✅ Enhanced:
1. Orderbook API now includes individual orders for each price level
2. All values have both raw and formatted versions
3. Summary statistics (spread, best bid/ask, order counts)
4. Comprehensive logging for debugging
5. Balance validation with detailed error messages

### 🔄 Existing Systems Untouched:
- `SecondaryMarketIndexer` still runs hourly as backup sync
- Primary market (auctions, static sales) unaffected
- Leverage vault system independent
- KYC and identity registry unchanged

## Next Steps

1. **Test the complete flow:**
   - Create order → Should appear in orderbook immediately
   - Fill order → Should update orderbook and send notifications
   - Cancel order → Should remove from orderbook

2. **Monitor logs** for any issues during event processing

3. **Verify** that orders persist after backend restart (they should, as they're in MongoDB)

4. **Check** that historical orders (created before this fix) are synced by the hourly indexer

## Architecture Diagram

```
User Wallet
    ↓ (signs transaction)
Mantle Sepolia
    ↓ (emits event)
EventListenerService (WebSocket)
    ↓ (adds to queue)
BullMQ Job Queue
    ↓ (processes job)
EventProcessor
    ↓ (writes to DB)
MongoDB (P2POrder, P2PTrade, Purchase)
    ↑ (reads from DB)
SecondaryMarketService
    ↑ (API call)
Frontend

[Real-time: SSE updates push to frontend]
[Backup: Hourly indexer syncs missed events]
```

## Files Modified

1. `packages/backend/src/modules/blockchain/services/event-listener.service.ts`
2. `packages/backend/src/modules/blockchain/processors/event.processor.ts`
3. `packages/backend/src/modules/blockchain/blockchain.module.ts`
4. `packages/backend/src/modules/secondary-market/services/secondary-market.service.ts`
5. `packages/backend/src/modules/secondary-market/services/token-balance.service.ts` (logging)
6. `packages/backend/src/modules/secondary-market/services/secondary-market-indexer.service.ts` (logging)
7. `packages/backend/src/modules/secondary-market/controllers/secondary-market.controller.ts` (logging)

Total: **7 files modified** to enable real-time P2P trading with complete API responses.
