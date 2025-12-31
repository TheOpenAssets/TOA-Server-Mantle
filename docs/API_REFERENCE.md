# RWA Platform - API Reference

Complete API documentation for testing and integration.

## Base URL
```
http://localhost:3000
```

## Authentication

All endpoints (except health check) require JWT authentication:

```bash
Authorization: Bearer <JWT_TOKEN>
```

### Get JWT Token
```bash
POST /auth/login
Content-Type: application/json

{
  "wallet": "0x...",
  "signature": "0x..."
}

Response:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "user": {...}
}
```

---

## Leverage Endpoints

### 1. Initiate Leveraged Purchase

Create a new leveraged position using mETH as collateral.

```bash
POST /leverage/initiate
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json

{
  "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
  "tokenAddress": "0xe7BAdAaF6d2FFF75394cC8608f68362c61F00bFb",
  "tokenAmount": "100000000000000000000",
  "pricePerToken": "800000",
  "mETHCollateral": "50000000000000000000"
}

Response:
{
  "success": true,
  "positionId": 1,
  "transactionHash": "0x...",
  "position": {
    "positionId": 1,
    "userAddress": "0x...",
    "assetId": "...",
    "currentHealthFactor": 15000,
    "healthStatus": "HEALTHY",
    ...
  },
  "message": "Leveraged position created successfully"
}
```

**Validation**:
- Validates 150% LTV: `mETH value >= 1.5 × (tokenAmount × pricePerToken)`
- Checks SeniorPool has sufficient liquidity
- Verifies user has approved mETH spending

### 2. Get Position Details

```bash
GET /leverage/position/:id
Authorization: Bearer <JWT_TOKEN>

Example:
GET /leverage/position/1

Response:
{
  "position": {
    "positionId": 1,
    "userAddress": "0x...",
    "assetId": "...",
    "mETHCollateral": "50000000000000000000",
    "usdcBorrowed": "80000000000",
    "currentHealthFactor": 14500,
    "healthStatus": "HEALTHY",
    "status": "ACTIVE",
    "harvestHistory": [
      {
        "timestamp": "2025-01-15T10:30:00Z",
        "mETHSwapped": "1000000000000000000",
        "usdcReceived": "3000000000",
        "interestPaid": "100000000"
      }
    ],
    ...
  },
  "currentHealthFactor": 14500,
  "outstandingDebt": "80500000000"
}
```

### 3. Get My Positions

Get all positions for authenticated user.

```bash
GET /leverage/positions/my
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "positions": [
    {
      "positionId": 1,
      "assetId": "...",
      "healthStatus": "HEALTHY",
      ...
    },
    {
      "positionId": 2,
      "assetId": "...",
      "healthStatus": "WARNING",
      ...
    }
  ],
  "count": 2
}
```

### 4. Get User Positions

Get positions for any user address (public endpoint).

```bash
GET /leverage/positions/user/:address
Authorization: Bearer <JWT_TOKEN>

Example:
GET /leverage/positions/user/0x23e67597f0898f747Fa3291C8920168adF9455D0

Response:
{
  "userAddress": "0x23e67597f0898f747Fa3291C8920168adF9455D0",
  "positions": [...],
  "count": 3
}
```

### 5. Get Swap Quote

Get expected USDC output for mETH swap.

```bash
GET /leverage/quote/:mETHAmount
Authorization: Bearer <JWT_TOKEN>

Example:
GET /leverage/quote/1000000000000000000

Response:
{
  "mETHAmount": "1000000000000000000",
  "expectedUSDC": "3000000000",
  "expectedUSDCFormatted": "3000.0 USDC"
}
```

### 6. Get mETH Price

Get current mETH price in USD.

```bash
GET /leverage/meth-price
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "price": "3000",
  "priceFormatted": "$3000"
}
```

### 7. Unwind Position (Future)

Manually close a position (not yet implemented).

```bash
POST /leverage/unwind/:id
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "error": "Manual position unwind not yet implemented"
}
```

---

## Admin Endpoints

All admin endpoints require `AdminRoleGuard` (user role must be 'ADMIN').

### 1. Approve Asset

```bash
POST /admin/compliance/approve
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
  "adminWallet": "0x23e67597f0898f747Fa3291C8920168adF9455D0"
}

Response:
{
  "success": true,
  "assetId": "...",
  "status": "ATTESTED"
}
```

### 2. Schedule Auction

```bash
POST /admin/compliance/schedule-auction
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
  "startDelayMinutes": 2
}

Response:
{
  "success": true,
  "assetId": "...",
  "scheduledStartTime": "2025-01-15T10:32:00Z",
  "scheduledEndTime": "2025-01-15T10:32:30Z",
  "message": "Auction scheduled to start in 2 minutes and run for 0.5 minutes"
}
```

### 3. Get Auction Clearing Price Suggestion

Get suggested clearing price with full bid analysis.

```bash
GET /admin/compliance/auction-clearing-price/:assetId
Authorization: Bearer <ADMIN_JWT_TOKEN>

Example:
GET /admin/compliance/auction-clearing-price/1aa1e321-f783-4504-ad19-676a397057d7

Response:
{
  "suggestedPrice": "900000",
  "tokensAtPrice": "75000000000000000000000",
  "percentageOfSupply": 75.0,
  "totalBids": 15,
  "allBids": [
    {
      "bidder": "0x...",
      "price": "950000",
      "tokenAmount": "10000000000000000000000",
      "usdcDeposited": "9500000000",
      "status": "PENDING",
      "createdAt": "2025-01-15T10:25:00Z"
    },
    ...
  ],
  "priceBreakdown": [
    {
      "price": "950000",
      "cumulativeTokens": "30000000000000000000000",
      "percentage": 30.0,
      "bidsCount": 3
    },
    {
      "price": "920000",
      "cumulativeTokens": "60000000000000000000000",
      "percentage": 60.0,
      "bidsCount": 5
    },
    {
      "price": "900000",
      "cumulativeTokens": "75000000000000000000000",
      "percentage": 75.0,
      "bidsCount": 2
    },
    ...
  ]
}
```

### 4. End Auction

Finalize auction with clearing price (after calling smart contract).

```bash
POST /admin/compliance/end-auction
Authorization: Bearer <ADMIN_JWT_TOKEN>
Content-Type: application/json

{
  "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
  "clearingPrice": "900000",
  "transactionHash": "0x45485f5f6b0a950f9dc6c14fabb0be08b9ff14de2e4df8466a6ccf91fc671922"
}

Response:
{
  "success": true,
  "assetId": "...",
  "clearingPrice": "900000",
  "tokensSold": "75000000000000000000000",
  "tokensRemaining": "25000000000000000000000",
  "totalBids": 15,
  "transactionHash": "0x...",
  "message": "Auction ended successfully"
}
```

---

## Asset Endpoints

### 1. Upload Asset

```bash
POST /assets/upload
Authorization: Bearer <JWT_TOKEN>
Content-Type: multipart/form-data

Form Data:
- assetType: "AUCTION" | "STATIC"
- invoiceNumber: "INV-001"
- faceValue: "100"
- currency: "USD"
- issueDate: "2025-01-01"
- dueDate: "2025-07-01"
- buyerName: "Tech Solutions Inc"
- industry: "Technology"
- riskTier: "A"
- totalSupply: "100000000000000000000"
- minInvestment: "10000000000000000000"
- minRaisePercentage: "80"
- maxRaisePercentage: "95"
- auctionDuration: "30" (seconds, for AUCTION type)
- pricePerToken: "800000" (optional, for STATIC type)
- file: <invoice PDF>

Response:
{
  "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
  "status": "UPLOADED",
  "assetType": "AUCTION",
  "message": "AUCTION asset uploaded successfully. Processing started.",
  "priceRange": {
    "min": "800000",
    "max": "950000",
    "minRaise": "80000000000",
    "maxRaise": "95000000000"
  }
}
```

### 2. Get Asset

```bash
GET /assets/:id
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "assetId": "...",
  "originator": "0x...",
  "status": "LISTED",
  "assetType": "AUCTION",
  "metadata": {...},
  "tokenParams": {...},
  "listing": {
    "type": "AUCTION",
    "reservePrice": "800000",
    "priceRange": {...},
    "duration": 30,
    "active": true,
    "phase": "BIDDING",
    ...
  },
  ...
}
```

---

## Notification Endpoints

### Get My Notifications

```bash
GET /notifications/my
Authorization: Bearer <JWT_TOKEN>

Response:
{
  "notifications": [
    {
      "_id": "...",
      "userId": "0x...",
      "header": "Auction Ended - Action Required",
      "detail": "Auction for INV-001 has ended! ...",
      "type": "SYSTEM_ALERT",
      "severity": "WARNING",
      "action": "VIEW_ASSET",
      "actionMetadata": {
        "assetId": "...",
        "suggestedClearingPrice": "900000",
        ...
      },
      "read": false,
      "createdAt": "2025-01-15T10:30:00Z"
    },
    ...
  ]
}
```

---

## Testing Examples

### Complete Leveraged Purchase Flow

```bash
# 1. Get mETH price
curl http://localhost:3000/leverage/meth-price \
  -H "Authorization: Bearer $JWT_TOKEN"

# 2. Get swap quote
curl http://localhost:3000/leverage/quote/50000000000000000000 \
  -H "Authorization: Bearer $JWT_TOKEN"

# 3. Create leveraged position
curl -X POST http://localhost:3000/leverage/initiate \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "1aa1e321-f783-4504-ad19-676a397057d7",
    "tokenAddress": "0xe7BAdAaF6d2FFF75394cC8608f68362c61F00bFb",
    "tokenAmount": "100000000000000000000",
    "pricePerToken": "800000",
    "mETHCollateral": "50000000000000000000"
  }'

# 4. Monitor position
watch -n 5 'curl -s http://localhost:3000/leverage/position/1 \
  -H "Authorization: Bearer $JWT_TOKEN" | jq'
```

### Complete Auction Flow

```bash
# 1. Admin approves asset
curl -X POST http://localhost:3000/admin/compliance/approve \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "...",
    "adminWallet": "0x23e67597f0898f747Fa3291C8920168adF9455D0"
  }'

# 2. Schedule auction (2 minutes from now)
curl -X POST http://localhost:3000/admin/compliance/schedule-auction \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "...",
    "startDelayMinutes": 2
  }'

# 3. Wait for auction to end

# 4. Get clearing price suggestion
curl http://localhost:3000/admin/compliance/auction-clearing-price/... \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" | jq

# 5. End auction with clearing price
curl -X POST http://localhost:3000/admin/compliance/end-auction \
  -H "Authorization: Bearer $ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "...",
    "clearingPrice": "900000",
    "transactionHash": "0x..."
  }'
```

---

## Error Responses

All endpoints return errors in the following format:

```json
{
  "statusCode": 400,
  "message": "Insufficient collateral. Required: 120000000000 USDC worth of mETH, Provided: 100000000000 USDC worth",
  "error": "Bad Request"
}
```

Common status codes:
- `400` - Bad Request (validation error)
- `401` - Unauthorized (missing/invalid JWT)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `500` - Internal Server Error

---

## Health Check

```bash
GET /health

Response:
{
  "status": "ok",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## Environment-Specific URLs

### Development
```
http://localhost:3000
```

### Production (Railway/Render)
```
https://rwa-platform-api.railway.app
```

### Frontend CORS Origins

Configured in backend:
- `http://localhost:5173` (Vite dev)
- `https://rwa-platform.vercel.app` (production)

---

## Postman Collection

Import this collection for quick testing:

```json
{
  "info": {
    "name": "RWA Platform API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [
    {
      "name": "Leverage",
      "item": [
        {
          "name": "Initiate Purchase",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Authorization",
                "value": "Bearer {{jwt_token}}"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"assetId\": \"...\",\n  \"tokenAddress\": \"...\",\n  \"tokenAmount\": \"100000000000000000000\",\n  \"pricePerToken\": \"800000\",\n  \"mETHCollateral\": \"50000000000000000000\"\n}"
            },
            "url": {
              "raw": "{{base_url}}/leverage/initiate",
              "host": ["{{base_url}}"],
              "path": ["leverage", "initiate"]
            }
          }
        }
      ]
    }
  ],
  "variable": [
    {
      "key": "base_url",
      "value": "http://localhost:3000"
    },
    {
      "key": "jwt_token",
      "value": ""
    }
  ]
}
```

Save as `rwa-platform.postman_collection.json` and import into Postman.
