# Yield Claim Notification System

## Overview

This system tracks individual investor yield claims when they burn their RWA tokens to receive USDC. Each claim is recorded in the backend with notifications sent to users.

## Architecture

```
Investor → Frontend → claimYield() on YieldVault
                   ↓
           POST /yield/claims/notify → Backend
                   ↓
           UserYieldClaimService → MongoDB
                   ↓
           NotificationService → User Notification
```

## Key Components

### 1. Schema: `UserYieldClaim`
Tracks individual yield claims with:
- User address
- Token address & asset ID
- Tokens burned & USDC received
- Transaction hash & block number
- Claim timestamp & status

### 2. Service: `UserYieldClaimService`
Manages yield claim records:
- `recordClaim()` - Store new claim
- `getUserClaims()` - Get user's claim history
- `getAssetClaims()` - Get all claims for an asset
- `getTotalClaimedForAsset()` - Aggregate totals

### 3. Controller: `YieldController`
API endpoints:
- `POST /yield/claims/notify` - Record claim
- `GET /yield/claims/my-claims` - User's history
- `GET /yield/claims/asset/:assetId` - Asset claims
- `GET /yield/claims/recent` - Recent claims (admin)

## API Usage

### Notify Yield Claim

**Endpoint:** `POST /yield/claims/notify`

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "txHash": "0x...",
  "tokenAddress": "0xTOKENADDRESS",
  "assetId": "asset-uuid",
  "tokensBurned": "100000000000000000000", // 100 tokens in wei
  "usdcReceived": "98500000", // 98.5 USDC in wei (6 decimals)
  "blockNumber": "12345678" // optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "Yield claim recorded successfully",
  "claim": {
    "id": "claim-id",
    "tokensBurned": "100000000000000000000",
    "usdcReceived": "98500000",
    "transactionHash": "0x..."
  }
}
```

### Get My Claims

**Endpoint:** `GET /yield/claims/my-claims`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "success": true,
  "count": 2,
  "claims": [
    {
      "id": "claim-1",
      "assetId": "asset-uuid",
      "tokenAddress": "0x...",
      "tokensBurned": "100000000000000000000",
      "tokensBurnedFormatted": "100.00",
      "usdcReceived": "98500000",
      "usdcReceivedFormatted": "98.50",
      "transactionHash": "0x...",
      "claimTimestamp": "2025-12-30T10:00:00Z",
      "status": "CONFIRMED"
    }
  ]
}
```

### Get Asset Claims (Admin/Originator)

**Endpoint:** `GET /yield/claims/asset/:assetId`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "success": true,
  "count": 3,
  "totals": {
    "totalUSDC": "295500000",
    "totalUSDCFormatted": "295.50",
    "totalTokensBurned": "300000000000000000000",
    "totalTokensBurnedFormatted": "300.00",
    "claimCount": 3
  },
  "claims": [...]
}
```

## Frontend Integration

### Example: Claiming Yield

```typescript
// 1. User calls claimYield() on YieldVault contract
const tx = await yieldVaultContract.claimYield(
  tokenAddress,
  tokenAmountToB urn
);
await tx.wait();

// 2. Parse event to get actual amounts
const receipt = await provider.getTransactionReceipt(tx.hash);
const event = parseYieldClaimedEvent(receipt.logs);

// 3. Notify backend
const response = await fetch('/api/yield/claims/notify', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    txHash: tx.hash,
    tokenAddress: tokenAddress,
    assetId: assetId,
    tokensBurned: event.tokensBurned,
    usdcReceived: event.usdcReceived,
    blockNumber: receipt.blockNumber,
  }),
});

// 4. User receives notification
```

### Example: Displaying User's Claims

```typescript
// Fetch user's claim history
const response = await fetch('/api/yield/claims/my-claims', {
  headers: {
    'Authorization': `Bearer ${jwtToken}`,
  },
});

const data = await response.json();

// Display claims
data.claims.forEach(claim => {
  console.log(`Claimed ${claim.usdcReceivedFormatted} USDC`);
  console.log(`Burned ${claim.tokensBurnedFormatted} tokens`);
  console.log(`TX: ${claim.transactionHash}`);
});
```

## Database Schema

```typescript
{
  userAddress: string;      // Investor wallet (indexed)
  tokenAddress: string;     // RWA token (indexed)
  assetId: string;          // Asset ID (indexed)
  tokensBurned: string;     // Wei amount
  usdcReceived: string;     // Wei amount (6 decimals)
  transactionHash: string;  // Unique
  blockNumber: number;
  claimTimestamp: Date;
  status: 'CONFIRMED' | 'PENDING' | 'FAILED';
  notificationSent: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

## Notifications

When a claim is recorded, the user receives a notification:

**Type:** `YIELD_DISTRIBUTED`
**Severity:** `SUCCESS`
**Action:** `VIEW_PORTFOLIO`

**Content:**
```
Header: "Yield Claimed Successfully!"
Detail: "You've successfully claimed 98.50 USDC by burning 100.00 tokens
         for asset INV-001"
```

## Key Differences from Settlement

| Settlement (Admin) | Yield Claim (Investor) |
|-------------------|------------------------|
| Admin deposits USDC to vault | Investor burns tokens for USDC |
| One transaction per asset | Multiple transactions (one per investor) |
| Recorded in `Settlement` collection | Recorded in `UserYieldClaim` collection |
| All investors notified | Only claimant notified |
| Happens once | Happens per investor |

## Notes

- **Idempotency**: Duplicate claims (same txHash) are ignored
- **Status Tracking**: Each claim has status (CONFIRMED/PENDING/FAILED)
- **Notifications**: Sent automatically after recording
- **Partial Claims**: Users can claim partial amounts in multiple transactions
- **Settlement Independence**: One user claiming doesn't affect others

## Testing

### Test Flow

1. Create and tokenize asset
2. Investor purchases tokens
3. Admin settles yield (deposits to YieldVault)
4. Investor claims yield (burns tokens)
5. Frontend calls `/yield/claims/notify`
6. Check claim recorded: `/yield/claims/my-claims`
7. Verify notification received

### Example cURL

```bash
# Notify claim
curl -X POST http://localhost:3000/yield/claims/notify \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "txHash": "0x...",
    "tokenAddress": "0x...",
    "assetId": "asset-uuid",
    "tokensBurned": "100000000000000000000",
    "usdcReceived": "98500000",
    "blockNumber": "12345678"
  }'

# Get my claims
curl http://localhost:3000/yield/claims/my-claims \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Admin Dashboard Features

The `/yield/claims/asset/:assetId` endpoint provides:

1. **Total Claimed**: How much USDC has been claimed for an asset
2. **Total Burned**: How many tokens have been burned
3. **Claim Count**: Number of individual claims
4. **Individual Claims**: List of all claims with user addresses

This helps admins/originators track:
- How many investors have claimed
- How much of the settlement has been claimed
- Who hasn't claimed yet (by comparing to token holders)

## Future Enhancements

- Event listener to auto-record claims from blockchain events
- Reminder notifications for unclaimed yields
- Analytics dashboard showing claim patterns
- Bulk claim tracking for multiple assets
