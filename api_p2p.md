# P2P Secondary Market API Documentation

This document outlines the API endpoints for the Secondary Market (P2P) module. These endpoints facilitate trading assets between users, viewing market data, and managing orders.

**Base URL:** `/marketplace/secondary`

## 1. Get User Orders
Retrieves all active orders (both buy and sell) for the authenticated user.

- **Endpoint:** `GET /orders/user`
- **Authentication:** Required (JWT)
- **Description:** Fetches a list of orders created by the user that are currently in `OPEN` status.

**Response Structure:**
Returns an array of order objects.

```json
[
  {
    "_id": "60d5ec...",
    "orderId": "12345",
    "maker": "0xUserWalletAddress",
    "assetId": "asset-uuid",
    "tokenAddress": "0xTokenAddress",
    "isBuy": true, // true for Buy, false for Sell
    "initialAmount": "1000000000000000000", // in wei
    "remainingAmount": "500000000000000000", // in wei
    "pricePerToken": "1000000", // price in USDC (6 decimals)
    "status": "OPEN",
    "txHash": "0xTransactionHash",
    "blockNumber": 12345678,
    "blockTimestamp": "2023-01-01T00:00:00.000Z",
    "createdAt": "2023-01-01T00:00:00.000Z",
    "updatedAt": "2023-01-01T00:00:00.000Z"
  },
  ...
]
```

## 2. Get Order by ID
Retrieves detailed information about a specific order.

- **Endpoint:** `GET /orders/:orderId`
- **Authentication:** Public
- **Parameters:**
    - `orderId` (path): The unique identifier of the order.
- **Description:** Fetches details of a single order by its ID. Useful for order confirmation or detailed view.

**Response Structure:**
Returns a single order object.

```json
{
  "_id": "60d5ec...",
  "orderId": "12345",
  "maker": "0xUserWalletAddress",
  "assetId": "asset-uuid",
  "tokenAddress": "0xTokenAddress",
  "isBuy": false,
  "initialAmount": "1000000000000000000",
  "remainingAmount": "1000000000000000000",
  "pricePerToken": "1000000",
  "status": "OPEN", // OPEN, FILLED, CANCELLED
  "txHash": "0xTransactionHash",
  "blockNumber": 12345678,
  "blockTimestamp": "2023-01-01T00:00:00.000Z"
}
```

## 3. Get Cancel Order Transaction Data
Generates the transaction data required to cancel an active order on the blockchain.

- **Endpoint:** `POST /tx/cancel-order`
- **Authentication:** Required (JWT)
- **Body:**
    ```json
    {
      "orderId": "12345"
    }
    ```
- **Description:** Returns the raw transaction object (target address, ABI, function name, arguments) that the frontend wallet (e.g., MetaMask) uses to sign and send the transaction.

**Response Structure:**
```json
{
  "to": "0xSecondaryMarketContractAddress",
  "abi": [...], // Contract ABI fragment for cancelOrder
  "functionName": "cancelOrder",
  "args": [
    "12345" // orderId
  ]
}
```

---

## Other Endpoints

### 4. Get Order Book
Retrieves the order book (bids and asks) for a specific asset.

- **Endpoint:** `GET /:assetId/orderbook`
- **Authentication:** Public
- **Description:** Returns grouped and sorted bids and asks for an asset.
- **Response:**
    ```json
    {
      "assetId": "asset-uuid",
      "bids": [
        {
          "price": "1000000",
          "priceFormatted": "1.00",
          "amount": "500...",
          "amountFormatted": "500.0000",
          "orderCount": 2,
          "orders": [...] // List of individual orders at this price
        },
        ...
      ],
      "asks": [...], // Similar structure to bids
      "summary": {
        "bestBid": "1.00",
        "bestAsk": "1.05",
        "spread": "0.05",
        ...
      }
    }
    ```

### 5. Get Trade History
Retrieves recent trades for a specific asset.

- **Endpoint:** `GET /:assetId/trades`
- **Authentication:** Public
- **Query Params:** `limit` (optional, default 50)
- **Response:** Array of trade objects containing price, amount, type, timestamp, etc.

### 6. Get Chart Data (OHLCV)
Retrieves candlestick data for charting. Returns both order book based (speculative) and trade based (actual) candles.

- **Endpoint:** `GET /:assetId/chart`
- **Authentication:** Public
- **Query Params:** `interval` (e.g., '2m', '5m', '1h', default '2m')
- **Response:**
    ```json
    {
      "interval": "2m",
      "orderBookCandles": [...], // OHLCV based on orders
      "tradeCandles": [...] // OHLCV based on trades
    }
    ```

### 7. Get Market Stats
Retrieves 24-hour statistics for an asset.

- **Endpoint:** `GET /:assetId/stats`
- **Authentication:** Public
- **Response:**
    ```json
    {
      "lastPriceFormatted": "1.00",
      "priceChange24h": "...",
      "priceChangePercent": "...",
      "high24h": "...",
      "low24h": "...",
      "volume24hFormatted": "..."
    }
    ```

### 8. Create Order Transaction Data
Generates transaction data for creating a new buy or sell order.

- **Endpoint:** `POST /tx/create-order`
- **Authentication:** Required (JWT)
- **Body:**
    ```json
    {
      "tokenAddress": "0x...",
      "amount": "1000000000000000000", // wei
      "pricePerToken": "1000000", // USDC decimals (6)
      "isBuy": true // true=Buy, false=Sell
    }
    ```
- **Response:** Transaction object (`to`, `abi`, `functionName`, `args`).

### 9. Fill Order Transaction Data
Generates transaction data for filling (matching) an existing order.

- **Endpoint:** `POST /tx/fill-order`
- **Authentication:** Required (JWT)
- **Body:**
    ```json
    {
      "orderId": "12345",
      "amountToFill": "500000000000000000"
    }
    ```
- **Response:** Transaction object.

### 10. Get User Balance
Retrieves the user's wallet and tradeable balance for an asset.

- **Endpoint:** `GET /:assetId/my-balance`
- **Authentication:** Required (JWT)
- **Response:**
    ```json
    {
      "assetId": "...",
      "tokenAddress": "...",
      "walletBalanceFormatted": "1000.0000",
      "lockedInOrders": "...",
      "tradeableBalanceFormatted": "800.0000" // wallet - locked
    }
    ```

### 11. Validate Order
Checks if an order can be placed (e.g., sufficient balance).

- **Endpoint:** `POST /validate-order`
- **Authentication:** Required (JWT)
- **Body:** `{ "assetId": "...", "amount": "...", "isBuy": boolean }`
- **Response:** `{ "valid": boolean, "reason": "...", "balance": {...} }`
