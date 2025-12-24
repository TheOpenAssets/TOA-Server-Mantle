# Mantle RWA Platform - API Documentation

**Base URL:** `http://localhost:3000`

**Server Port:** 3000

**CORS:** Enabled for all origins (`*`)

---

## Table of Contents

1. [Authentication](#authentication)
2. [KYC (Know Your Customer)](#kyc-know-your-customer)
3. [Assets](#assets)
4. [Admin - Asset Operations](#admin---asset-operations)
5. [Admin - Yield Operations](#admin---yield-operations)
6. [Admin - Compliance](#admin---compliance)
7. [Notifications](#notifications)

---

## Authentication

All auth endpoints are under `/auth` base path.

### 1. Get Challenge

Creates a challenge message for wallet signing.

**Endpoint:** `GET /auth/challenge`

**Authentication:** None

**Query Parameters:**
- `walletAddress` (string, required) - The wallet address to authenticate

**Response:**
```json
{
  "message": "Sign this message to authenticate with Mantle RWA Platform.\nNonce: <uuid>\nTimestamp: <timestamp>",
  "nonce": "<uuid>"
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/auth/challenge?walletAddress=0x23e67597f0898f747Fa3291C892016hadF9455D0'
```

---

### 2. Login

Authenticates user with signed message.

**Endpoint:** `POST /auth/login`

**Authentication:** None

**Request Body:**
```json
{
  "walletAddress": "string",
  "signature": "string",
  "message": "string"
}
```

**Response:**
```json
{
  "user": {
    "id": "string",
    "walletAddress": "string",
    "role": "INVESTOR" | "ORIGINATOR" | "ADMIN",
    "kyc": boolean,
    "createdAt": "date"
  },
  "tokens": {
    "access": "jwt_access_token",
    "refresh": "jwt_refresh_token"
  }
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/auth/login' \
  --header 'Content-Type: application/json' \
  --data '{
    "walletAddress": "0x23e67597f0898f747Fa3291C892016hadF9455D0",
    "signature": "<signature>",
    "message": "Sign this message to authenticate with Mantle RWA Platform.\nNonce: <nonce>\nTimestamp: <timestamp>"
  }'
```

---

### 3. Refresh Token

Generates new access and refresh tokens.

**Endpoint:** `POST /auth/refresh`

**Authentication:** None

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

**Response:**
```json
{
  "accessToken": "jwt_access_token",
  "refreshToken": "jwt_refresh_token"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/auth/refresh' \
  --header 'Content-Type: application/json' \
  --data '{
    "refreshToken": "<your_refresh_token>"
  }'
```

---

### 4. Logout

Logs out the authenticated user.

**Endpoint:** `POST /auth/logout`

**Authentication:** Required (JWT)

**Request Body:** None

**Response:** 204 No Content

**Example:**
```bash
curl -X POST 'http://localhost:3000/auth/logout' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 5. Get User Profile

Retrieves authenticated user profile.

**Endpoint:** `GET /auth/me`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "_id": "string",
  "walletAddress": "string",
  "role": "INVESTOR" | "ORIGINATOR" | "ADMIN",
  "kyc": boolean,
  "jti": "string"
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/auth/me' \
  --header 'Authorization: Bearer <access_token>'
```

---

## KYC (Know Your Customer)

All KYC endpoints are under `/kyc` base path and require JWT authentication.

### 1. Upload KYC Document

Uploads KYC document for verification.

**Endpoint:** `POST /kyc/upload`

**Authentication:** Required (JWT)

**Form Data:**
- `document` (file, required)
  - Accepted types: pdf, jpeg, jpg, png
  - Max size: 5MB

**Response:**
```json
{
  "documentId": "string",
  "status": "PROCESSING",
  "message": "string"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/kyc/upload' \
  --header 'Authorization: Bearer <access_token>' \
  --form 'document=@/path/to/document.pdf'
```

---

### 2. Get KYC Status

Retrieves KYC verification status.

**Endpoint:** `GET /kyc/status`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "kyc": boolean,
  "documents": {
    "documentId": "string",
    "status": "PROCESSING" | "VERIFIED" | "REJECTED",
    "uploadedAt": "date"
  }
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/kyc/status' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 3. Delete KYC Document

Deletes unverified KYC document.

**Endpoint:** `DELETE /kyc/documents`

**Authentication:** Required (JWT)

**Note:** Cannot delete verified documents

**Response:**
```json
{
  "message": "string"
}
```

**Example:**
```bash
curl -X DELETE 'http://localhost:3000/kyc/documents' \
  --header 'Authorization: Bearer <access_token>'
```

---

## Assets

All asset endpoints are under `/assets` base path and require JWT authentication.

### 1. Upload Asset

Upload a new asset (invoice) for tokenization.

**Endpoint:** `POST /assets/upload`

**Authentication:** Required (JWT + Originator Role)

**Form Data:**
- `file` (file, required) - Invoice document
- `invoiceNumber` (string, required)
- `faceValue` (string, required) - Numeric string
- `currency` (string, required)
- `issueDate` (string, required) - ISO date string
- `dueDate` (string, required) - ISO date string
- `buyerName` (string, required)
- `industry` (string, required)
- `riskTier` (string, required)
- `totalSupply` (string, required) - Numeric string
- `pricePerToken` (string, required) - Numeric string
- `minInvestment` (string, required) - Numeric string

**Response:**
```json
{
  "assetId": "string",
  "status": "PENDING_VERIFICATION",
  "message": "Asset uploaded successfully"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/assets/upload' \
  --header 'Authorization: Bearer <access_token>' \
  --form 'file=@/path/to/invoice.pdf' \
  --form 'invoiceNumber=INV-12345' \
  --form 'faceValue=100000' \
  --form 'currency=USD' \
  --form 'issueDate=2024-01-01' \
  --form 'dueDate=2024-12-31' \
  --form 'buyerName=Acme Corp' \
  --form 'industry=Technology' \
  --form 'riskTier=A' \
  --form 'totalSupply=1000' \
  --form 'pricePerToken=100' \
  --form 'minInvestment=1000'
```

---

### 2. Get Asset Details

Retrieves details of a specific asset.

**Endpoint:** `GET /assets/:assetId`

**Authentication:** Required (JWT)

**Path Parameters:**
- `assetId` (string, required)

**Response:**
```json
{
  "assetId": "string",
  "invoiceNumber": "string",
  "faceValue": "string",
  "currency": "string",
  "issueDate": "date",
  "dueDate": "date",
  "buyerName": "string",
  "industry": "string",
  "riskTier": "string",
  "status": "PENDING_VERIFICATION" | "VERIFIED" | "REGISTERED" | "REJECTED" | "REVOKED",
  "originator": "string",
  "tokenAddress": "string",
  "createdAt": "date"
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/assets/asset_123456' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 3. Get My Assets (Originator)

Retrieves all assets uploaded by the authenticated originator.

**Endpoint:** `GET /assets/originator/my-assets`

**Authentication:** Required (JWT + Originator Role)

**Response:**
```json
[
  {
    "assetId": "string",
    "invoiceNumber": "string",
    "faceValue": "string",
    "status": "string",
    "createdAt": "date"
  }
]
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/assets/originator/my-assets' \
  --header 'Authorization: Bearer <access_token>'
```

---

## Admin - Asset Operations

All admin asset operation endpoints are under `/admin/assets` base path and require JWT authentication + Admin role.

### 1. Register Asset

Registers an approved asset on the blockchain.

**Endpoint:** `POST /admin/assets/:assetId/register`

**Authentication:** Required (JWT + Admin Role)

**Path Parameters:**
- `assetId` (string, required)

**Response:**
```json
{
  "transactionHash": "string",
  "status": "SUCCESS" | "PENDING",
  "blockNumber": number
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/assets/asset_123456/register' \
  --header 'Authorization: Bearer <admin_access_token>'
```

---

### 2. Deploy Token

Deploys an ERC20 token for an asset.

**Endpoint:** `POST /admin/assets/deploy-token`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "assetId": "string",
  "totalSupply": "string",
  "name": "string",
  "symbol": "string",
  "issuer": "string",
  "listingParams": {
    "type": "STATIC" | "AUCTION",
    "price": "string",
    "minInvestment": "string"
  }
}
```

**Response:**
```json
{
  "tokenAddress": "string",
  "transactionHash": "string",
  "status": "SUCCESS"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/assets/deploy-token' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "asset_123456",
    "totalSupply": "1000",
    "name": "Invoice Token",
    "symbol": "INVT",
    "issuer": "0x...",
    "listingParams": {
      "type": "STATIC",
      "price": "100",
      "minInvestment": "1000"
    }
  }'
```

---

### 3. Revoke Asset

Revokes an asset from the blockchain.

**Endpoint:** `POST /admin/assets/:assetId/revoke`

**Authentication:** Required (JWT + Admin Role)

**Path Parameters:**
- `assetId` (string, required)

**Request Body:**
```json
{
  "reason": "string"
}
```

**Response:**
```json
{
  "transactionHash": "string",
  "status": "REVOKED",
  "reason": "string"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/assets/asset_123456/revoke' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "reason": "Fraudulent invoice"
  }'
```

---

## Admin - Yield Operations

All admin yield operation endpoints are under `/admin/yield` base path and require JWT authentication + Admin role.

### 1. Record Settlement

Records a settlement for an asset.

**Endpoint:** `POST /admin/yield/settlement`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "assetId": "string",
  "settlementAmount": number,
  "settlementDate": "string"
}
```

**Response:**
```json
{
  "settlementId": "string",
  "status": "PENDING_USDC_CONVERSION",
  "assetId": "string",
  "amount": number
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/yield/settlement' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "asset_123456",
    "settlementAmount": 105000,
    "settlementDate": "2024-12-31"
  }'
```

---

### 2. Confirm USDC Conversion

Confirms USDC conversion for a settlement.

**Endpoint:** `POST /admin/yield/confirm-usdc`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "settlementId": "string",
  "usdcAmount": "string"
}
```

**Response:**
```json
{
  "settlementId": "string",
  "status": "READY_FOR_DISTRIBUTION",
  "usdcAmount": "string"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/yield/confirm-usdc' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "settlementId": "settlement_123",
    "usdcAmount": "105000000000"
  }'
```

---

### 3. Distribute Yield

Distributes yield to token holders.

**Endpoint:** `POST /admin/yield/distribute`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "settlementId": "string"
}
```

**Response:**
```json
{
  "settlementId": "string",
  "status": "DISTRIBUTED",
  "transactionHash": "string",
  "distributionDetails": {
    "totalAmount": "string",
    "recipientCount": number
  }
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/yield/distribute' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "settlementId": "settlement_123"
  }'
```

---

## Admin - Compliance

All admin compliance endpoints are under `/admin/compliance` base path and require JWT authentication + Admin role.

### 1. Approve Asset

Approves an asset for registration.

**Endpoint:** `POST /admin/compliance/approve`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "assetId": "string",
  "adminWallet": "string"
}
```

**Response:**
```json
{
  "assetId": "string",
  "status": "VERIFIED",
  "approvedBy": "string",
  "approvedAt": "date"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/compliance/approve' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "asset_123456",
    "adminWallet": "0x..."
  }'
```

---

### 2. Reject Asset

Rejects an asset with a reason.

**Endpoint:** `POST /admin/compliance/reject`

**Authentication:** Required (JWT + Admin Role)

**Request Body:**
```json
{
  "assetId": "string",
  "reason": "string"
}
```

**Response:**
```json
{
  "assetId": "string",
  "status": "REJECTED",
  "reason": "string",
  "rejectedAt": "date"
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/admin/compliance/reject' \
  --header 'Authorization: Bearer <admin_access_token>' \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "asset_123456",
    "reason": "Incomplete documentation"
  }'
```

---

## Notifications

All notification endpoints are under `/notifications` base path and require JWT authentication.

### 1. Get Notifications

Retrieves notifications for the authenticated user.

**Endpoint:** `GET /notifications`

**Authentication:** Required (JWT)

**Query Parameters:**
- `filter` (string, optional) - Values: `all`, `unread`, `read` (default: `all`)
- `limit` (number, optional) - Default: 20
- `offset` (number, optional) - Default: 0

**Response:**
```json
{
  "notifications": [
    {
      "id": "string",
      "type": "string",
      "title": "string",
      "message": "string",
      "read": boolean,
      "createdAt": "date"
    }
  ],
  "meta": {
    "total": number,
    "unreadCount": number,
    "limit": number,
    "offset": number
  }
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/notifications?filter=unread&limit=10&offset=0' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 2. Get Unread Count

Retrieves the count of unread notifications.

**Endpoint:** `GET /notifications/unread-count`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "unreadCount": number
}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/notifications/unread-count' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 3. Mark Notification as Read

Marks a specific notification as read.

**Endpoint:** `PATCH /notifications/:id/read`

**Authentication:** Required (JWT)

**Path Parameters:**
- `id` (string, required) - Notification ID

**Response:**
```json
{
  "success": true
}
```

**Example:**
```bash
curl -X PATCH 'http://localhost:3000/notifications/notif_123456/read' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 4. Mark All Notifications as Read

Marks all notifications as read for the authenticated user.

**Endpoint:** `POST /notifications/mark-all-read`

**Authentication:** Required (JWT)

**Response:**
```json
{
  "success": true
}
```

**Example:**
```bash
curl -X POST 'http://localhost:3000/notifications/mark-all-read' \
  --header 'Authorization: Bearer <access_token>'
```

---

### 5. SSE Stream (Real-time Notifications)

Establishes a Server-Sent Events connection for real-time notifications.

**Endpoint:** `GET /notifications/stream`

**Authentication:** Required (JWT)

**Response:** SSE Stream

**Event Format:**
```
data: {"type":"notification","notification":{"id":"string","type":"string","title":"string","message":"string","createdAt":"date"}}
```

**Example:**
```bash
curl -X GET 'http://localhost:3000/notifications/stream' \
  --header 'Authorization: Bearer <access_token>' \
  --no-buffer
```

---

## Authentication & Security

### JWT Token Details

**Access Token:**
- Expiration: 15 minutes
- Storage: Redis
- Payload includes: `sub` (user ID), `wallet`, `role`, `kyc`, `jti`

**Refresh Token:**
- Expiration: 7 days
- Storage: MongoDB (UserSession collection)
- Payload includes: `sub` (user ID), `wallet`, `type`, `jti`, `deviceHash`

### User Roles

- `INVESTOR` - Can view and invest in assets
- `ORIGINATOR` - Can upload assets for tokenization
- `ADMIN` - Full access to all operations

### Guards

- `JwtAuthGuard` - Validates JWT token and checks Redis
- `AdminRoleGuard` - Requires ADMIN role
- `OriginatorGuard` - Requires ORIGINATOR role
- `KycAuthGuard` - Requires verified KYC status

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "Error message",
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Cannot GET /route",
  "error": "Not Found"
}
```

### 422 Unprocessable Entity
```json
{
  "statusCode": 422,
  "message": "Validation failed",
  "error": "Unprocessable Entity"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

---

## Testing Checklist

### Auth Domain
- [x] GET /auth/challenge
- [x] POST /auth/login
- [ ] POST /auth/refresh
- [ ] GET /auth/me
- [ ] POST /auth/logout

### KYC Domain
- [ ] POST /kyc/upload
- [ ] GET /kyc/status
- [ ] DELETE /kyc/documents

### Assets Domain
- [ ] POST /assets/upload
- [ ] GET /assets/:assetId
- [ ] GET /assets/originator/my-assets

### Admin - Assets
- [ ] POST /admin/assets/:assetId/register
- [ ] POST /admin/assets/deploy-token
- [ ] POST /admin/assets/:assetId/revoke

### Admin - Yield
- [ ] POST /admin/yield/settlement
- [ ] POST /admin/yield/confirm-usdc
- [ ] POST /admin/yield/distribute

### Admin - Compliance
- [ ] POST /admin/compliance/approve
- [ ] POST /admin/compliance/reject

### Notifications
- [ ] GET /notifications
- [ ] GET /notifications/unread-count
- [ ] PATCH /notifications/:id/read
- [ ] POST /notifications/mark-all-read
- [ ] GET /notifications/stream

---

## Environment Variables

Required environment variables:

```env
JWT_SECRET=<your_secret_key>
MONGODB_URI=<mongodb_connection_string>
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## Notes

- All timestamps are in ISO 8601 format
- All numeric values for blockchain operations are strings to preserve precision
- File uploads have specific size and type restrictions
- Access tokens expire after 15 minutes - use refresh tokens for extended sessions
- Redis must be running for authentication to work
- MongoDB must be running for data persistence
