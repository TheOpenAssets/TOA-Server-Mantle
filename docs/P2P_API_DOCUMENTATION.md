# P2P Secondary Market API Documentation

**Base URL**: `/api/marketplace/secondary`

This document provides comprehensive API documentation for the P2P (Peer-to-Peer) Secondary Market trading system. The secondary market allows investors to trade tokenized invoice assets with each other.

---

## Table of Contents

1. [Authentication](#authentication)
2. [Market Data Endpoints](#market-data-endpoints)
3. [Order Management Endpoints](#order-management-endpoints)
4. [Transaction Preparation Endpoints](#transaction-preparation-endpoints)
5. [User Balance Endpoints](#user-balance-endpoints)
6. [Real-Time Updates (SSE)](#real-time-updates-sse)
7. [Complete Trading Flow](#complete-trading-flow)
8. [Error Handling](#error-handling)
9. [Data Models](#data-models)

---

## Authentication

Most endpoints require JWT authentication obtained through wallet signature verification.

**Required Header**:
```
Authorization: Bearer <JWT_TOKEN>
```

**Public Endpoints** (No Auth Required):
- Get Orderbook
- Get Trade History
- Get Chart Data
- Get Market Stats
- Get Order by ID

**Protected Endpoints** (Auth Required):
- Get User Orders
- Get User Balance
- Validate Order
- Create Order Transaction
- Fill Order Transaction
- Cancel Order Transaction

---

## Market Data Endpoints

### 1. Get Orderbook

Retrieve the current order book (bids and asks) for a specific asset.

**Endpoint**: `GET /:assetId/orderbook`

**Parameters**:
- `assetId` (path): UUID of the asset

**Response**:
```json
{
  "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
  "bids": [
    {
      "pricePerToken": "10000000",
      "priceFormatted": "10.00",
      "totalAmount": "500000000000000000000",
      "totalAmountFormatted": "500.00",
      "orderCount": 2,
      "orders": [
        {
          "orderId": "1",
          "maker": "0x1234...",
          "remainingAmount": "300000000000000000000",
          "remainingAmountFormatted": "300.00"
        }
      ]
    }
  ],
  "asks": [
    {
      "pricePerToken": "11000000",
      "priceFormatted": "11.00",
      "totalAmount": "1000000000000000000000",
      "totalAmountFormatted": "1000.00",
      "orderCount": 3,
      "orders": [...]
    }
  ],
  "summary": {
    "totalBidOrders": 5,
    "totalAskOrders": 8,
    "totalBidLevels": 3,
    "totalAskLevels": 4,
    "bestBid": "10.00",
    "bestAsk": "11.00",
    "spread": "1.00",
    "lastUpdated": "2026-01-08T14:30:00.000Z"
  }
}
```

**Use Case**: Display order book in trading interface

---

### 2. Get Trade History

Retrieve recent trades for a specific asset.

**Endpoint**: `GET /:assetId/trades`

**Parameters**:
- `assetId` (path): UUID of the asset
- `limit` (query, optional): Number of trades to return (default: 50)

**Response**:
```json
[
  {
    "tradeId": "0x56cfcc...d210-2",
    "orderId": "2",
    "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
    "tokenAddress": "0xdacde3...",
    "buyer": "0x9d02df...",
    "seller": "0xd617a3...",
    "amount": "100000000000000000000",
    "pricePerToken": "10000000",
    "totalValue": "1000000000",
    "txHash": "0x56cfcc...",
    "blockNumber": 33158267,
    "blockTimestamp": "2026-01-08T08:33:27.000Z"
  }
]
```

**Use Case**: Display trade history/recent trades table

---

### 3. Get Chart Data (OHLCV)

Retrieve OHLCV (Open, High, Low, Close, Volume) chart data for an asset.

**Endpoint**: `GET /:assetId/chart`

**Parameters**:
- `assetId` (path): UUID of the asset
- `interval` (query, optional): Time interval - `1h`, `4h`, `1d` (default: `1h`)

**Response**:
```json
[
  {
    "time": 1704715200,
    "open": 10.50,
    "high": 11.00,
    "low": 10.25,
    "close": 10.75,
    "volume": 1250.50
  }
]
```

**Use Case**: Display price charts (TradingView compatible format)

---

### 4. Get Market Stats

Retrieve 24-hour market statistics for an asset.

**Endpoint**: `GET /:assetId/stats`

**Parameters**:
- `assetId` (path): UUID of the asset

**Response**:
```json
{
  "lastPrice": "10000000",
  "lastPriceFormatted": "10.00",
  "priceChange24h": "500000",
  "priceChange24hFormatted": "0.50",
  "priceChangePercent24h": 5.26,
  "high24h": "11000000",
  "high24hFormatted": "11.00",
  "low24h": "9500000",
  "low24hFormatted": "9.50",
  "volume24h": "15000000000000000000000",
  "volume24hFormatted": "15000.00"
}
```

**Use Case**: Display market summary panel

---

## Order Management Endpoints

### 5. Get User Orders

Retrieve all active orders for the authenticated user.

**Endpoint**: `GET /orders/user`

**Authentication**: Required

**Response**:
```json
[
  {
    "orderId": "3",
    "maker": "0xd617a372...",
    "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
    "tokenAddress": "0xdacde3...",
    "isBuy": false,
    "initialAmount": "100000000000000000000",
    "remainingAmount": "100000000000000000000",
    "pricePerToken": "1000000",
    "status": "OPEN",
    "txHash": "0x263777...",
    "blockNumber": 33158935,
    "blockTimestamp": "2026-01-08T14:25:35.000Z",
    "createdAt": "2026-01-08T14:25:56.000Z"
  }
]
```

**Use Case**: Display user's active orders in "My Orders" panel

---

### 6. Get Order by ID

Retrieve details of a specific order.

**Endpoint**: `GET /orders/:orderId`

**Parameters**:
- `orderId` (path): Order ID

**Response**:
```json
{
  "orderId": "3",
  "maker": "0xd617a372...",
  "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
  "tokenAddress": "0xdacde3...",
  "isBuy": false,
  "initialAmount": "100000000000000000000",
  "remainingAmount": "50000000000000000000",
  "pricePerToken": "1000000",
  "status": "OPEN",
  "txHash": "0x263777...",
  "blockNumber": 33158935,
  "blockTimestamp": "2026-01-08T14:25:35.000Z"
}
```

**Use Case**: Display order details modal/page

---

## Transaction Preparation Endpoints

These endpoints prepare transaction data for the frontend to execute with the user's wallet.

### 7. Create Order Transaction

Prepare transaction data for creating a new buy or sell order.

**Endpoint**: `POST /tx/create-order`

**Authentication**: Required

**Request Body**:
```json
{
  "tokenAddress": "0xdACDE38885c0d3471fd4635B407410856556405A",
  "amount": "100000000000000000000",
  "pricePerToken": "10000000",
  "isBuy": false
}
```

**Validation**:
- For SELL orders: Validates user has sufficient tradeable balance
- For BUY orders: USDC balance validated by smart contract
- Blocks trading of tokens from assets with `PAYOUT_COMPLETE` status

**Response**:
```json
{
  "to": "0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A",
  "abi": [...],
  "functionName": "createOrder",
  "args": [
    "0xdACDE38885c0d3471fd4635B407410856556405A",
    "100000000000000000000",
    "10000000",
    false
  ]
}
```

**Use Case**: User wants to create a new order

**Frontend Flow**:
1. Call this endpoint to get transaction data
2. Execute transaction using Web3/Wagmi: `writeContract(txData)`
3. Wait for transaction confirmation
4. Backend automatically indexes the order via event listeners

---

### 8. Fill Order Transaction

Prepare transaction data for filling (taking) an existing order.

**Endpoint**: `POST /tx/fill-order`

**Authentication**: Required

**Request Body**:
```json
{
  "orderId": "3",
  "amountToFill": "50000000000000000000"
}
```

**Response**:
```json
{
  "to": "0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A",
  "abi": [...],
  "functionName": "fillOrder",
  "args": [
    "3",
    "50000000000000000000"
  ]
}
```

**Use Case**: User wants to buy from an ask order or sell to a bid order

**Frontend Flow**:
1. Call this endpoint with order ID and amount
2. Execute transaction: `writeContract(txData)`
3. Backend automatically creates trade record and updates balances

---

### 9. Cancel Order Transaction

Prepare transaction data for cancelling a user's own order.

**Endpoint**: `POST /tx/cancel-order`

**Authentication**: Required

**Request Body**:
```json
{
  "orderId": "3"
}
```

**Response**:
```json
{
  "to": "0x69d2e2B05eDdB11774A132e2b61B9D10486bd33A",
  "abi": [...],
  "functionName": "cancelOrder",
  "args": ["3"]
}
```

**Use Case**: User wants to cancel their open order

**Frontend Flow**:
1. Call this endpoint with order ID
2. Execute transaction: `writeContract(txData)`
3. For SELL orders: Backend automatically releases locked tokens back to user

---

## User Balance Endpoints

### 10. Get User Tradeable Balance

Retrieve the user's tradeable balance for a specific asset.

**Endpoint**: `GET /:assetId/my-balance`

**Authentication**: Required

**Parameters**:
- `assetId` (path): UUID of the asset

**Response**:
```json
{
  "walletAddress": "0xd617a372...",
  "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
  "walletBalance": "800000000000000000000",
  "walletBalanceFormatted": "800.00",
  "lockedInOrders": "200000000000000000000",
  "lockedInOrdersFormatted": "200.00",
  "lockedInLeverage": "0",
  "lockedInLeverageFormatted": "0.00",
  "tradeableBalance": "600000000000000000000",
  "tradeableBalanceFormatted": "600.00"
}
```

**Balance Calculation**:
```
tradeableBalance = walletBalance - lockedInOrders - lockedInLeverage
```

**Use Case**: Display available balance when creating sell orders

---

### 11. Validate Order Creation

Validate if a user can create an order before preparing the transaction.

**Endpoint**: `POST /validate-order`

**Authentication**: Required

**Request Body**:
```json
{
  "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
  "amount": "100000000000000000000",
  "isBuy": false
}
```

**Response (Success)**:
```json
{
  "valid": true,
  "message": "Sell order validation passed",
  "balance": {
    "walletBalance": "800000000000000000000",
    "tradeableBalance": "700000000000000000000"
  }
}
```

**Response (Failure)**:
```json
{
  "valid": false,
  "reason": "Insufficient tradeable balance. Required: 100.00, Available: 50.00",
  "balance": {
    "walletBalance": "100000000000000000000",
    "tradeableBalance": "50000000000000000000"
  }
}
```

**Response (Settled Asset)**:
```json
{
  "valid": false,
  "reason": "Cannot trade tokens from settled assets. This invoice has been paid out."
}
```

**Use Case**: Pre-validate order before showing transaction confirmation

---

## Real-Time Updates (SSE)

The backend emits Server-Sent Events for real-time orderbook updates.

**Endpoint**: `/api/sse/events` (from main SSE module)

**Authentication**: Required (via query param: `?wallet=0x...`)

**Event Types**:

### Orderbook Update Event
```json
{
  "event": "orderbook_update",
  "data": {
    "assetId": "0950a194-fa8a-4875-ae62-38a5ce5cc34b",
    "type": "create",
    "orderId": "3"
  }
}
```

**Update Types**:
- `create`: New order added to orderbook
- `fill`: Order partially or fully filled
- `cancel`: Order cancelled by maker

**Frontend Implementation**:
```javascript
const eventSource = new EventSource(
  `${API_BASE}/sse/events?wallet=${userWalletAddress}`,
  { withCredentials: true }
);

eventSource.addEventListener('orderbook_update', (event) => {
  const data = JSON.parse(event.data);
  
  if (data.assetId === currentAssetId) {
    // Refresh orderbook
    fetchOrderbook(data.assetId);
  }
});
```

---

## Complete Trading Flow

### Scenario 1: Creating a SELL Order

**Step 1**: Validate Balance
```
GET /marketplace/secondary/:assetId/my-balance
```

**Step 2**: Validate Order Creation (Optional)
```
POST /marketplace/secondary/validate-order
{
  "assetId": "...",
  "amount": "100000000000000000000",
  "isBuy": false
}
```

**Step 3**: Approve Token (If needed)
```
// Frontend calls ERC20.approve() on token contract
const tx = await tokenContract.approve(
  SECONDARY_MARKET_ADDRESS,
  amount
);
await tx.wait();
```

**Step 4**: Get Transaction Data
```
POST /marketplace/secondary/tx/create-order
{
  "tokenAddress": "0x...",
  "amount": "100000000000000000000",
  "pricePerToken": "10000000",
  "isBuy": false
}
```

**Step 5**: Execute Transaction
```javascript
const { to, abi, functionName, args } = txData;
const tx = await writeContract({
  address: to,
  abi,
  functionName,
  args
});
await waitForTransaction({ hash: tx.hash });
```

**Step 6**: Backend Processing (Automatic)
- Event listener detects `OrderCreated` event
- Creates order in database
- Creates negative Purchase record (tokens locked)
- Emits SSE update

**Step 7**: Frontend Updates
- Receives SSE `orderbook_update` event
- Refreshes orderbook
- Updates user's active orders

---

### Scenario 2: Filling a BUY Order (Selling Tokens)

**Step 1**: Get Orderbook
```
GET /marketplace/secondary/:assetId/orderbook
```

**Step 2**: Select Order to Fill
```javascript
const bestBid = orderbook.bids[0];
const orderToFill = bestBid.orders[0];
```

**Step 3**: Get Fill Transaction Data
```
POST /marketplace/secondary/tx/fill-order
{
  "orderId": "1",
  "amountToFill": "50000000000000000000"
}
```

**Step 4**: Execute Transaction
```javascript
const tx = await writeContract(txData);
await waitForTransaction({ hash: tx.hash });
```

**Step 5**: Backend Processing (Automatic)
- Event listener detects `OrderFilled` event
- Updates order status (OPEN → FILLED/PARTIAL)
- Creates trade record
- Creates Purchase records:
  - Positive for buyer (receives tokens)
  - Negative for seller (sends tokens)
- Emits SSE update

---

### Scenario 3: Cancelling an Order

**Step 1**: Get User Orders
```
GET /marketplace/secondary/orders/user
```

**Step 2**: Get Cancel Transaction Data
```
POST /marketplace/secondary/tx/cancel-order
{
  "orderId": "3"
}
```

**Step 3**: Execute Transaction
```javascript
const tx = await writeContract(txData);
await waitForTransaction({ hash: tx.hash });
```

**Step 4**: Backend Processing (Automatic)
- Event listener detects `OrderCancelled` event
- Updates order status (OPEN → CANCELLED)
- For SELL orders: Creates positive Purchase record to release locked tokens
- Emits SSE update

---

## Error Handling

### Common Error Responses

**400 Bad Request**:
```json
{
  "statusCode": 400,
  "message": "Insufficient tradeable balance. Required: 100.00, Available: 50.00",
  "error": "Bad Request"
}
```

**401 Unauthorized**:
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**404 Not Found**:
```json
{
  "statusCode": 404,
  "message": "Order not found",
  "error": "Not Found"
}
```

**Validation Errors**:
- `Asset not found for this token address`
- `Cannot trade tokens from settled assets. This invoice has been paid out.`
- `Insufficient tradeable balance`
- `Order not found`

---

## Data Models

### Order Model
```typescript
{
  orderId: string;           // On-chain order ID
  maker: string;             // Creator's wallet address
  assetId: string;           // Asset UUID
  tokenAddress: string;      // Token contract address
  isBuy: boolean;            // true = buy order, false = sell order
  initialAmount: string;     // Initial token amount (wei)
  remainingAmount: string;   // Remaining unfilled amount (wei)
  pricePerToken: string;     // Price per token in USDC (6 decimals)
  status: OrderStatus;       // OPEN | FILLED | CANCELLED
  txHash: string;            // Creation transaction hash
  blockNumber: number;       // Creation block number
  blockTimestamp: Date;      // Creation timestamp
  createdAt: Date;           // Database creation time
  updatedAt: Date;           // Last update time
}
```

### Trade Model
```typescript
{
  tradeId: string;           // Unique trade identifier
  orderId: string;           // Related order ID
  assetId: string;           // Asset UUID
  tokenAddress: string;      // Token contract address
  buyer: string;             // Buyer wallet address
  seller: string;            // Seller wallet address
  amount: string;            // Tokens traded (wei)
  pricePerToken: string;     // Execution price (USDC, 6 decimals)
  totalValue: string;        // Total USDC value (6 decimals)
  txHash: string;            // Transaction hash
  blockNumber: number;       // Block number
  blockTimestamp: Date;      // Trade timestamp
}
```

### Purchase Model (Balance Tracking)
```typescript
{
  txHash: string;            // Transaction hash
  assetId: string;           // Asset UUID
  investorWallet: string;    // Investor wallet address
  tokenAddress: string;      // Token contract address
  amount: string;            // Token amount (can be negative!)
  price: string;             // Price per token
  totalPayment: string;      // Total payment
  blockNumber: number;       // Block number
  blockTimestamp: Date;      // Transaction timestamp
  status: string;            // CONFIRMED | CLAIMED
  source: string;            // PRIMARY_MARKET | SECONDARY_MARKET | 
                             // P2P_SELL_ORDER | P2P_ORDER_CANCELLED
  p2pTradeId?: string;       // Reference to trade/order
  metadata: {
    assetName: string;
    industry: string;
    riskTier: string;
  };
}
```

**Purchase Amount Logic**:
- **Positive values**: User receives tokens
  - Primary market purchase
  - P2P buyer receives tokens
  - Cancelled sell order refund
- **Negative values**: User sends tokens / locks in escrow
  - Creating a sell order (tokens locked)
  - P2P seller sends tokens

**Portfolio Balance Calculation**:
```
totalBalance = SUM(Purchase.amount) for user's address
```

---

## Security Considerations

### Token Approval
Before creating orders, users must approve the SecondaryMarket contract to transfer their tokens:

```javascript
// Check current allowance
const allowance = await tokenContract.allowance(
  userAddress,
  SECONDARY_MARKET_ADDRESS
);

// If insufficient, approve
if (allowance < amount) {
  const tx = await tokenContract.approve(
    SECONDARY_MARKET_ADDRESS,
    ethers.MaxUint256 // Or specific amount
  );
  await tx.wait();
}
```

### Transaction Safety
1. Always validate orders before execution
2. Use `waitForTransaction` to confirm before updating UI
3. Handle transaction failures gracefully
4. Display clear error messages to users

### Settled Assets Protection
The backend prevents trading of tokens from assets with `PAYOUT_COMPLETE` status. These tokens should have been burned for yield claims.

---

## Rate Limits

Currently, no rate limits are enforced, but consider implementing:
- Transaction preparation endpoints: 10 requests/minute per user
- Market data endpoints: 60 requests/minute per IP
- SSE connections: 1 per user

---

## Testing Endpoints

### Development Environment
```
Base URL: http://localhost:3000/api
```

### Production Environment
```
Base URL: https://api.theopenassets.com/api
```

---

## Support

For issues or questions, contact the development team or create an issue in the repository.

---

**Last Updated**: January 8, 2026  
**API Version**: 1.0  
**Smart Contract Version**: SecondaryMarket v1.0
