# Issuer Flow Testing Guide

**Date**: December 24, 2025
**Purpose**: Complete guide to test issuer login → KYC → Invoice upload → Tokenization → Primary marketplace listing

## Prerequisites

✓ Backend running on `http://localhost:3000`
✓ All RWA contracts deployed to Mantle Sepolia
✓ MongoDB and Redis running
✓ Wallet with Mantle Sepolia testnet ETH

**Your Deployed Contracts**:
- MockUSDC: `0xfD61dC86e7799479597c049D7b19e6E638adDdd0`
- AttestationRegistry: `0x4d0B52aB6303C4532bE779c14C49d6a97A5867ac`
- IdentityRegistry: `0xD93911f05958b017F43DAcF99A0eB9a1EB91431d`
- YieldVault: `0x04bABaDA4b187d39BcB4e3e851e909fAD0513Fe5`
- TokenFactory: `0x094A619b6E7e851C128317795266468552F4e964`
- PrimaryMarketplace: `0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615`

## Testing Flow Overview

```
1. Issuer Login (with ORIGINATOR role)
   ↓
2. KYC Verification
   ↓
3. Upload Invoice
   ↓
4. Admin Approval & Attestation
   ↓
5. Register on Blockchain
   ↓
6. Deploy RWA Token
   ↓
7. List on Primary Marketplace
   ↓
8. View in Marketplace
```

---

## Step 1: Issuer Login with ORIGINATOR Role

### 1.1 Request Challenge (with role parameter)

```bash
curl 'http://localhost:3000/auth/challenge?walletAddress=0x23e67597f0898f747Fa3291C8920168adF9455D0&role=ORIGINATOR'
```

**Response**:
```json
{
  "message": "Sign this message to authenticate with Mantle RWA Platform.\nNonce: 550e8400-e29b-41d4-a716-446655440000\nTimestamp: 1735027200000",
  "nonce": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Important**: The `role=ORIGINATOR` parameter is now included in the challenge request. This ensures the user will be created with ORIGINATOR role upon first login.

### 1.2 Sign the Message

Use your wallet (MetaMask, etc.) to sign the message from step 1.1.

**Example with ethers.js**:
```javascript
const { ethers } = require('ethers');

const privateKey = 'YOUR_PRIVATE_KEY';
const wallet = new ethers.Wallet(privateKey);

const message = "Sign this message to authenticate with Mantle RWA Platform.\nNonce: 550e8400-e29b-41d4-a716-446655440000\nTimestamp: 1735027200000";

const signature = await wallet.signMessage(message);
console.log('Signature:', signature);
```

### 1.3 Login with Signature

```bash
curl -X POST 'http://localhost:3000/auth/login' \
  --header 'Content-Type: application/json' \
  --data '{
    "walletAddress": "0x23e67597f0898f747Fa3291C8920168adF9455D0",
    "signature": "0xYOUR_SIGNATURE_HERE",
    "message": "Sign this message to authenticate with Mantle RWA Platform.\nNonce: 550e8400-e29b-41d4-a716-446655440000\nTimestamp: 1735027200000"
  }'
```

**Response**:
```json
{
  "user": {
    "id": "676aa36c8d9f1234567890ab",
    "walletAddress": "0x23e67597f0898f747Fa3291C8920168adF9455D0",
    "role": "ORIGINATOR",  ← Notice the role!
    "kyc": false,
    "createdAt": "2025-12-24T10:00:00.000Z"
  },
  "tokens": {
    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Save the access token** for subsequent requests:
```bash
export TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

## Step 2: KYC Verification

### 2.1 Upload KYC Document

```bash
curl -X POST 'http://localhost:3000/kyc/upload' \
  --header "Authorization: Bearer $TOKEN" \
  --form 'document=@/path/to/aadhaar.png'
```

**Response**:
```json
{
  "documentId": "92130103-d75f-40c3-9ec3-3f8a5f339fef",
  "status": "PROCESSING",
  "message": "Document uploaded, verification in progress"
}
```

### 2.2 Check KYC Status

```bash
curl 'http://localhost:3000/kyc/status' \
  --header "Authorization: Bearer $TOKEN"
```

**Response (After Processing)**:
```json
{
  "kyc": true,
  "documents": {
    "aadhaar": {
      "documentId": "92130103-d75f-40c3-9ec3-3f8a5f339fef",
      "status": "VERIFIED",
      "verificationScore": 105,
      "extractedData": {
        "uid": "XXXXXXXX4701",
        "name": "Divyraj Saini",
        "address": {
          "careOf": "C/O: Rajkumar Saini",
          "locality": "Kailashpuri Kunhadi",
          "district": "Kota",
          "state": "Rajasthan",
          "pincode": "324008"
        }
      }
    }
  }
}
```

**Option: Manual Approval (Testing Only)**

If automatic verification fails:
```bash
curl -X POST 'http://localhost:3000/kyc/manual-approve' \
  --header "Authorization: Bearer $TOKEN"
```

---

## Step 3: Upload Invoice

### 3.1 Prepare Invoice Metadata

```bash
curl -X POST 'http://localhost:3000/assets/upload' \
  --header "Authorization: Bearer $TOKEN" \
  --form 'file=@/path/to/invoice.pdf' \
  --form 'invoiceNumber=INV-2025-001' \
  --form 'faceValue=100000' \
  --form 'currency=USD' \
  --form 'issueDate=2025-01-01' \
  --form 'dueDate=2025-07-01' \
  --form 'buyerName=Tech Solutions Inc' \
  --form 'industry=Technology' \
  --form 'riskTier=A' \
  --form 'totalSupply=100000' \
  --form 'pricePerToken=1' \
  --form 'minInvestment=1000'
```

**Response**:
```json
{
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "UPLOADED",
  "message": "Asset uploaded successfully. Processing started."
}
```

**Save the assetId**:
```bash
export ASSET_ID="a1b2c3d4-e5f6-7890-abcd-ef1234567890"
```

### 3.2 Check Asset Status

```bash
curl "http://localhost:3000/assets/$ASSET_ID" \
  --header "Authorization: Bearer $TOKEN"
```

**Expected Status Flow**:
- `UPLOADED` → Hash computation queued
- `HASHED` → Merkle tree built
- `MERKLED` → Awaiting admin attestation

---

## Step 4: Admin Approval & Attestation

**Note**: Admin operations require ADMIN role. You'll need to create an admin user or update your user's role.

### 4.1 Create Admin User (One-time Setup)

**Option A: Via MongoDB**:
```javascript
db.users.updateOne(
  { walletAddress: "0xYOUR_ADMIN_WALLET" },
  { $set: { role: "ADMIN" } }
)
```

**Option B: Via Admin API** (requires existing admin):
```bash
curl -X POST 'http://localhost:3000/admin/users/0xYOUR_ADMIN_WALLET/role' \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{ "role": "ADMIN" }'
```

### 4.2 Admin Login

Follow Step 1 to login with the admin wallet and get admin token:
```bash
export ADMIN_TOKEN="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

### 4.3 Attest Asset

```bash
curl -X POST "http://localhost:3000/admin/assets/$ASSET_ID/attest" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "expiryDays": 180
  }'
```

**Response**:
```json
{
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "ATTESTED",
  "attestation": {
    "hash": "0xabcd1234...",
    "signature": "0x5678efgh...",
    "attestor": "0xADMIN_WALLET",
    "expiryDate": "2025-06-30"
  }
}
```

**Asset will now move to**:
- `ATTESTED` → EigenDA anchoring queued
- `DA_ANCHORED` → Ready for blockchain registration

---

## Step 5: Register on Blockchain

### 5.1 Register Asset with AttestationRegistry

```bash
curl -X POST "http://localhost:3000/admin/assets/$ASSET_ID/register" \
  --header "Authorization: Bearer $ADMIN_TOKEN"
```

**Response**:
```json
{
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "REGISTERED",
  "transactionHash": "0x9876abcd...",
  "blockNumber": 12345678
}
```

**Verify on Mantle Sepolia Explorer**:
```
https://explorer.sepolia.mantle.xyz/tx/0x9876abcd...
```

---

## Step 6: Deploy RWA Token

### 6.1 Deploy Token Contract

```bash
curl -X POST "http://localhost:3000/admin/assets/$ASSET_ID/deploy-token" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "name": "TechInvoice RWA Token",
    "symbol": "TINV"
  }'
```

**Response**:
```json
{
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "TOKENIZED",
  "tokenAddress": "0x1234abcd...",
  "transactionHash": "0xef567890...",
  "supply": "100000"
}
```

**Save the token address**:
```bash
export TOKEN_ADDRESS="0x1234abcd..."
```

---

## Step 7: List on Primary Marketplace

### 7.1 Create Marketplace Listing

```bash
curl -X POST "http://localhost:3000/admin/marketplace/list" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "'"$ASSET_ID"'",
    "listingType": "STATIC",
    "pricePerToken": "1000000000000000000",
    "duration": 2592000
  }'
```

**Parameters**:
- `listingType`: `"STATIC"` (fixed price) or `"AUCTION"` (Dutch auction)
- `pricePerToken`: Price in wei (1 ETH = 1e18 wei)
- `duration`: Listing duration in seconds (2592000 = 30 days)

**Response**:
```json
{
  "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "status": "LISTED",
  "listing": {
    "type": "STATIC",
    "price": "1000000000000000000",
    "sold": "0",
    "active": true,
    "listedAt": "2025-12-24T12:00:00.000Z"
  }
}
```

---

## Step 8: View in Marketplace

### 8.1 Get All Active Listings

```bash
curl 'http://localhost:3000/marketplace/listings?active=true'
```

**Response**:
```json
{
  "listings": [
    {
      "assetId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "metadata": {
        "invoiceNumber": "INV-2025-001",
        "faceValue": "100000",
        "currency": "USD",
        "buyerName": "Tech Solutions Inc",
        "industry": "Technology",
        "riskTier": "A"
      },
      "token": {
        "address": "0x1234abcd...",
        "name": "TechInvoice RWA Token",
        "symbol": "TINV",
        "supply": "100000"
      },
      "listing": {
        "type": "STATIC",
        "price": "1000000000000000000",
        "sold": "0",
        "active": true
      }
    }
  ]
}
```

### 8.2 Get Specific Asset Details

```bash
curl "http://localhost:3000/assets/$ASSET_ID/public"
```

---

## Complete Test Script

Here's a complete bash script to test the entire flow:

```bash
#!/bin/bash

# Configuration
API_URL="http://localhost:3000"
WALLET="0x23e67597f0898f747Fa3291C8920168adF9455D0"
INVOICE_FILE="/path/to/invoice.pdf"
AADHAAR_FILE="/path/to/aadhaar.png"

echo "=== Step 1: Issuer Login ==="
CHALLENGE=$(curl -s "$API_URL/auth/challenge?walletAddress=$WALLET&role=ORIGINATOR")
echo "Challenge: $CHALLENGE"

echo "\n=== Sign the message with your wallet ==="
read -p "Enter signature: " SIGNATURE
read -p "Enter message: " MESSAGE

LOGIN=$(curl -s -X POST "$API_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"walletAddress\":\"$WALLET\",\"signature\":\"$SIGNATURE\",\"message\":\"$MESSAGE\"}")

TOKEN=$(echo $LOGIN | jq -r '.tokens.access')
echo "Access Token: $TOKEN"

echo "\n=== Step 2: KYC Upload ==="
KYC=$(curl -s -X POST "$API_URL/kyc/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "document=@$AADHAAR_FILE")
echo "KYC Response: $KYC"

echo "\n=== Step 3: Upload Invoice ==="
ASSET=$(curl -s -X POST "$API_URL/assets/upload" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@$INVOICE_FILE" \
  -F 'invoiceNumber=INV-2025-001' \
  -F 'faceValue=100000' \
  -F 'currency=USD' \
  -F 'issueDate=2025-01-01' \
  -F 'dueDate=2025-07-01' \
  -F 'buyerName=Tech Solutions Inc' \
  -F 'industry=Technology' \
  -F 'riskTier=A' \
  -F 'totalSupply=100000' \
  -F 'pricePerToken=1' \
  -F 'minInvestment=1000')

ASSET_ID=$(echo $ASSET | jq -r '.assetId')
echo "Asset ID: $ASSET_ID"

echo "\n=== Complete! ==="
echo "Next steps (require admin):"
echo "1. Attest: POST $API_URL/admin/assets/$ASSET_ID/attest"
echo "2. Register: POST $API_URL/admin/assets/$ASSET_ID/register"
echo "3. Deploy Token: POST $API_URL/admin/assets/$ASSET_ID/deploy-token"
echo "4. List: POST $API_URL/admin/marketplace/list"
```

---

## Troubleshooting

### Issue: "Invalid or expired nonce"
**Solution**: The nonce expires after 60 seconds. Request a new challenge.

### Issue: "KYC not verified" when uploading asset
**Solution**: Use manual approval endpoint:
```bash
curl -X POST 'http://localhost:3000/kyc/manual-approve' \
  --header "Authorization: Bearer $TOKEN"
```

### Issue: "Admin access required"
**Solution**: Update user role to ADMIN in MongoDB or via admin API.

### Issue: Asset stuck in PROCESSING
**Solution**: Check BullMQ queue and backend logs for errors.

---

## Role Comparison

| Feature | INVESTOR (default) | ORIGINATOR | ADMIN |
|---------|-------------------|------------|-------|
| Upload Assets | ❌ | ✅ | ✅ |
| View Marketplace | ✅ | ✅ | ✅ |
| Purchase Tokens | ✅ | ❌ | ✅ |
| Attest Assets | ❌ | ❌ | ✅ |
| Deploy Tokens | ❌ | ❌ | ✅ |
| Manage Users | ❌ | ❌ | ✅ |

---

## Next Steps

After completing this test flow:

1. **Test Investor Flow**: Login as INVESTOR and purchase tokens
2. **Test Yield Distribution**: Deposit yield and distribute to token holders
3. **Test Compliance**: Try compliance verification and KYC updates
4. **Frontend Integration**: Integrate these APIs with your frontend application

## API Documentation

For complete API reference, see: `/docs/API_DOCUMENTATION.md`
