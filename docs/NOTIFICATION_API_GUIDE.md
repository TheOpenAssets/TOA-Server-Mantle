# Notification Service API Guide

## Overview
The Notification Service provides real-time and persistent notifications for users throughout the RWA platform. It uses a hybrid approach:
- **Real-time**: Server-Sent Events (SSE) for instant notifications
- **Persistent**: MongoDB storage for notification history

## Base URL
```
http://localhost:3000/notifications
```

## Authentication
All endpoints require JWT authentication via Bearer token in the Authorization header:
```bash
Authorization: Bearer <your_jwt_token>
```

---

## API Endpoints

### 1. Fetch All Notifications
Get paginated list of notifications for the authenticated user.

**Endpoint:** `GET /notifications`

**Query Parameters:**
- `filter` (optional): Filter by read status
  - `all` (default) - All notifications
  - `unread` - Only unread notifications
  - `read` - Only read notifications
- `limit` (optional): Number of notifications per page (default: 20)
- `offset` (optional): Pagination offset (default: 0)

**cURL Example:**
```bash
# Fetch all notifications
curl -X GET "http://localhost:3000/notifications?filter=all&limit=20&offset=0" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq

# Fetch only unread notifications
curl -X GET "http://localhost:3000/notifications?filter=unread&limit=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq

# Fetch with pagination
curl -X GET "http://localhost:3000/notifications?limit=10&offset=10" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq
```

**Response:**
```json
{
  "notifications": [
    {
      "_id": "notification_id",
      "header": "Asset Approved by Compliance",
      "detail": "Your asset INV-12345 has been approved and is ready for registration.",
      "type": "ASSET_STATUS",
      "severity": "SUCCESS",
      "action": "VIEW_ASSET",
      "actionMetadata": {
        "assetId": "asset-uuid"
      },
      "icon": "file-document-check",
      "read": false,
      "readAt": null,
      "receivedAt": "2025-12-27T10:30:00.000Z"
    }
  ],
  "meta": {
    "unreadCount": 5,
    "totalCount": 25
  }
}
```

---

### 2. Get Notification by ID
Fetch a specific notification by its ID. Only returns if the notification belongs to the authenticated user.

**Endpoint:** `GET /notifications/:id`

**Path Parameters:**
- `id`: The notification ID

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/notifications/67946a1234567890abcdef12" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq
```

**Response:**
```json
{
  "_id": "67946a1234567890abcdef12",
  "header": "Token Purchase Successful",
  "detail": "You purchased 1000 tokens of Asset INV-12345 for $950.00",
  "type": "TOKEN_PURCHASED",
  "severity": "SUCCESS",
  "action": "VIEW_PORTFOLIO",
  "actionMetadata": {
    "assetId": "asset-uuid",
    "amount": "1000",
    "totalPayment": "950000000"
  },
  "icon": "shopping",
  "read": true,
  "readAt": "2025-12-27T11:00:00.000Z",
  "receivedAt": "2025-12-27T10:45:00.000Z"
}
```

**Error Response (Not Found or Access Denied):**
```json
{
  "statusCode": 500,
  "message": "Notification not found or access denied"
}
```

---

### 3. Get Unread Count
Lightweight endpoint to get the count of unread notifications for the bell badge.

**Endpoint:** `GET /notifications/unread-count`

**cURL Example:**
```bash
curl -X GET "http://localhost:3000/notifications/unread-count" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq
```

**Response:**
```json
{
  "unreadCount": 5
}
```

---

### 4. Mark Notification as Read
Mark a specific notification as read.

**Endpoint:** `PATCH /notifications/:id/read`

**Path Parameters:**
- `id`: The notification ID to mark as read

**cURL Example:**
```bash
curl -X PATCH "http://localhost:3000/notifications/67946a1234567890abcdef12/read" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq
```

**Response:**
```json
{
  "success": true
}
```

---

### 5. Mark All as Read
Bulk operation to mark all notifications as read.

**Endpoint:** `POST /notifications/mark-all-read`

**cURL Example:**
```bash
curl -X POST "http://localhost:3000/notifications/mark-all-read" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" | jq
```

**Response:**
```json
{
  "success": true
}
```

---

### 6. SSE Stream (Real-Time Notifications)
Establish a Server-Sent Events connection to receive real-time notifications.

**Endpoint:** `GET /notifications/stream`

**cURL Example:**
```bash
curl -N -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/notifications/stream
```

**SSE Event Format:**
```
event: notification
data: {"id":"notification_id","header":"Asset Approved","severity":"SUCCESS","type":"ASSET_STATUS","timestamp":"2025-12-27T10:30:00.000Z"}

event: notification
data: {"id":"notification_id_2","header":"Token Purchase Successful","severity":"SUCCESS","type":"TOKEN_PURCHASED","timestamp":"2025-12-27T10:31:00.000Z"}
```

**JavaScript Client Example:**
```javascript
const eventSource = new EventSource('http://localhost:3000/notifications/stream', {
  headers: {
    'Authorization': 'Bearer YOUR_JWT_TOKEN'
  }
});

eventSource.addEventListener('notification', (event) => {
  const notification = JSON.parse(event.data);
  console.log('New notification:', notification);
  // Show toast notification in UI
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
};
```

---

## Notification Types

### Asset Status Notifications
- **ASSET_STATUS**: General asset lifecycle updates
- **TOKEN_DEPLOYED**: Token deployment completion

**Triggers:**
- Asset upload
- Document processing (hashing)
- Cryptographic verification (merkle tree)
- Compliance approval
- On-chain registration
- Token deployment
- Marketplace listing

---

### Marketplace Notifications
- **TOKEN_PURCHASED**: Token purchase confirmation
- **BID_PLACED**: Bid placement confirmation
- **AUCTION_WON**: Auction win notification
- **BID_REFUNDED**: Bid refund notification

**Triggers:**
- Static listing purchase
- Auction bid placement
- Auction settlement (win/refund)

---

### KYC Notifications
- **KYC_STATUS**: KYC verification results

**Triggers:**
- KYC approval
- KYC rejection

---

### Yield Notifications
- **YIELD_DISTRIBUTED**: Yield payment received

**Triggers:**
- Yield distribution to token holders

---

## Notification Severity Levels

- **SUCCESS**: Positive outcomes (green)
- **INFO**: Informational updates (blue)
- **WARNING**: Important notices (yellow)
- **ERROR**: Failed operations (red)

---

## Notification Actions

Defines what action the user can take when clicking the notification:

- **VIEW_ASSET**: Navigate to asset details page
- **VIEW_PORTFOLIO**: Navigate to user's portfolio
- **VIEW_MARKETPLACE**: Navigate to marketplace
- **CLAIM_YIELD**: Navigate to yield claiming page
- **VIEW_KYC**: Navigate to KYC verification page
- **NONE**: No action available

---

## Testing Workflow

### Step 1: Upload an Asset
```bash
# Use the originator upload script
ORIGINATOR_PRIVATE_KEY=0x... ./scripts/upload-as-originator.sh sample-invoice.pdf
```

This should trigger:
1. "Asset Upload Successful" notification
2. "Document Processing Complete" notification
3. "Cryptographic Verification Complete" notification

### Step 2: Check Notifications
```bash
# Get unread count
curl -X GET "http://localhost:3000/notifications/unread-count" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq

# Fetch all unread notifications
curl -X GET "http://localhost:3000/notifications?filter=unread" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq
```

### Step 3: Admin Approves Asset
```bash
# Admin approves the asset
curl -X POST "http://localhost:3000/admin/compliance/approve" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assetId":"YOUR_ASSET_ID","adminWallet":"ADMIN_WALLET"}' | jq
```

This should trigger:
- "Asset Approved by Compliance" notification

### Step 4: Asset Deployment
```bash
# Deploy the asset
./scripts/deploy-asset.sh YOUR_ASSET_ID
```

This should trigger:
- "Asset Registered On-Chain" notification
- "Token Deployment Complete" notification
- "Asset Listed on Marketplace" notification

### Step 5: Token Purchase
```bash
# Purchase tokens
node scripts/investor-buy-static.js YOUR_ASSET_ID 1000
```

This should trigger:
- "Token Purchase Successful" notification

### Step 6: Mark Notifications as Read
```bash
# Mark specific notification as read
curl -X PATCH "http://localhost:3000/notifications/NOTIFICATION_ID/read" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq

# Or mark all as read
curl -X POST "http://localhost:3000/notifications/mark-all-read" \
  -H "Authorization: Bearer YOUR_TOKEN" | jq
```

---

## Security Notes

### User Isolation
- All endpoints validate that the authenticated user can only access their own notifications
- `getNotificationById` verifies ownership before returning notification details
- SSE streams are isolated per user's wallet address

### Best Practices
- Always use HTTPS in production
- Store JWT tokens securely (HttpOnly cookies recommended)
- Implement token refresh mechanism
- Set appropriate CORS policies
- Monitor SSE connection count to prevent resource exhaustion

---

## Troubleshooting

### No Notifications Appearing
1. Check MongoDB `usernotifications` collection:
   ```bash
   mongosh rwa-platform --eval "db.usernotifications.find({walletAddress: 'YOUR_WALLET'}).pretty()"
   ```

2. Check `notifications` collection:
   ```bash
   mongosh rwa-platform --eval "db.notifications.find().sort({createdAt: -1}).limit(5).pretty()"
   ```

3. Verify NotificationService is injected in relevant services
4. Check backend logs for notification creation errors

### SSE Connection Issues
1. Verify JWT token is valid
2. Check browser console for connection errors
3. Ensure server supports SSE (check response headers)
4. Monitor backend logs for connection/disconnection events

### Duplicate Notifications
1. Check if notification create calls are duplicated
2. Verify background jobs aren't retriggering notifications
3. Review error handling to ensure failed notifications aren't retried multiple times

---

## Future Enhancements

- [ ] Email notifications for critical events
- [ ] Push notifications (Web Push API)
- [ ] Notification preferences (user settings)
- [ ] Notification grouping/threading
- [ ] Rich notification content (images, charts)
- [ ] Notification archiving
- [ ] Search and filter by date range
- [ ] Export notification history
