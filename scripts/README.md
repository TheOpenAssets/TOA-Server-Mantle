# RWA Platform Scripts

This directory contains scripts for testing the RWA platform auction flow.

## Prerequisites

- Node.js with ethers.js installed
- jq (JSON processor) installed: `brew install jq` (macOS) or `apt-get install jq` (Linux)
- Backend server running at http://localhost:3000 (or set `API_BASE_URL` environment variable)

## Scripts Overview

### 1. Upload Auction Asset (Originator)

**Script**: `upload-auction-asset.sh`

Uploads an invoice as an auction asset.

```bash
ORIGINATOR_PRIVATE_KEY=0x... ./upload-auction-asset.sh path/to/invoice.pdf
```

**Output**: Asset ID that can be used for approval

### 2. Admin Approve & Schedule Auction

**Script**: `admin-approve-and-schedule.sh`

Complete admin flow: authenticate, approve asset, and schedule auction.

```bash
ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh <asset-id> [delay-minutes]
```

**Parameters**:
- `asset-id`: UUID from the upload step
- `delay-minutes`: (Optional) Minutes until auction starts (default: 5)

**Example**:
```bash
# Schedule auction to start in 10 minutes
ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh 550e8400-e29b-41d4-a716-446655440000 10
```

**What it does**:
1. Admin login with wallet signature
2. Fetch asset details
3. Approve the asset (generates attestation)
4. Schedule auction with specified delay
5. Verify AUCTION_SCHEDULED announcement created

### 3. Check Announcements

**Script**: `check-announcements.sh`

Monitor announcements for a specific asset.

```bash
./check-announcements.sh <asset-id>
```

**Example**:
```bash
./check-announcements.sh 550e8400-e29b-41d4-a716-446655440000
```

### 4. Register Investor (KYC)

**Script**: `register-investor.js`

Registers an investor wallet in the IdentityRegistry for KYC verification.

```bash
node scripts/register-investor.js <investor-address>
```

**Example**:
```bash
# Register investor wallet
node scripts/register-investor.js 0x23e67597f0898f747Fa3291C8920168adF9455D0
```

**Note**: This must be done before an investor can place bids or purchase tokens.

### 5. Investor Login

**Script**: `sign-investor-login.js`

Authenticates an investor and returns JWT tokens for API access.

```bash
INVESTOR_PRIVATE_KEY=0x... node scripts/sign-investor-login.js
```

**Output**: JWT access token for use in API calls

**Example**:
```bash
INVESTOR_PRIVATE_KEY=0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305 \
  node scripts/sign-investor-login.js
```

Save the access token to use in bid notifications.

### 6. Place Bid on Auction

**Script**: `place-bid.js`

Places a bid on an active auction.

```bash
INVESTOR_PRIVATE_KEY=0x... node scripts/place-bid.js <asset-id> <token-amount> <price-per-token>
```

**Parameters**:
- `asset-id`: UUID of the auction
- `token-amount`: Number of tokens to bid for (in whole tokens)
- `price-per-token`: Price per token in USDC (e.g., 0.95 for $0.95/token)

**Example**:
```bash
# Bid for 1000 tokens at $0.95 per token
INVESTOR_PRIVATE_KEY=0x... node scripts/place-bid.js \
  550e8400-e29b-41d4-a716-446655440000 \
  1000 \
  0.95
```

**What it does**:
1. Validates auction is active and price is within allowed range
2. Calculates USDC deposit needed (price × token amount)
3. Approves USDC spending
4. Submits bid to smart contract
5. Outputs curl command to notify backend

**After placing bid**: Use the provided curl command with your JWT token to notify the backend.

### 7. All-in-One Investor Bid (Recommended)

**Script**: `investor-place-bid.sh`

Complete investor flow: KYC check, authentication, place bid, and notify backend - all in one command.

```bash
INVESTOR_PRIVATE_KEY=0x... ./investor-place-bid.sh <asset-id> <token-amount> <price-per-token>
```

**Parameters**:
- `asset-id`: UUID of the auction
- `token-amount`: Number of tokens to bid for (in whole tokens)
- `price-per-token`: Price per token in USDC

**Example**:
```bash
# Complete investor bid flow in one command
INVESTOR_PRIVATE_KEY=0x1d12932a5c3a7aa8d4f50662caa679bb2e53321e11bc5df2af9298e2ace59305 \
  ./investor-place-bid.sh 550e8400-e29b-41d4-a716-446655440000 1000 0.95
```

**What it does**:
1. Derives wallet address from private key
2. Checks KYC status and registers if needed
3. Authenticates investor and gets JWT token
4. Places bid on-chain via smart contract
5. Notifies backend about the bid
6. Verifies bid was recorded in database
7. Displays all bids for the auction

**This is the recommended way to place bids** - it handles the entire flow automatically.

## Complete E2E Flow

### Step 1: Upload Asset (Originator)
```bash
ORIGINATOR_PRIVATE_KEY=0xabc123... ./upload-auction-asset.sh test-invoice.pdf
```
Save the returned `ASSET_ID`.

### Step 2: Approve and Schedule (Admin)
```bash
ADMIN_PRIVATE_KEY=0xdef456... ./admin-approve-and-schedule.sh $ASSET_ID 5
```

This will:
- Approve the asset
- Schedule auction to start in 5 minutes
- Create AUCTION_SCHEDULED announcement

### Step 3: Monitor Progress
```bash
# Check announcements immediately
./check-announcements.sh $ASSET_ID

# Wait 5 minutes, check again (should see auction activated)
sleep 300
./check-announcements.sh $ASSET_ID

# Wait 1 more minute, check for AUCTION_LIVE announcement
sleep 60
./check-announcements.sh $ASSET_ID
```

### Step 4: Place Bids (Investors)
```bash
# Simple: Use all-in-one script (recommended)
INVESTOR_PRIVATE_KEY=0x... ./investor-place-bid.sh $ASSET_ID 1000 0.95

# Or manually (advanced):
# 4a. Register investor wallet for KYC
node scripts/register-investor.js 0x23e67597f0898f747Fa3291C8920168adF9455D0

# 4b. Investor login to get JWT token
INVESTOR_PRIVATE_KEY=0x... node scripts/sign-investor-login.js

# 4c. Place bid on-chain
INVESTOR_PRIVATE_KEY=0x... node scripts/place-bid.js $ASSET_ID 1000 0.95

# 4d. Notify backend (copy curl command from script output)
```

You can place multiple bids from different investors or different prices:
```bash
# Second bid at different price
INVESTOR_PRIVATE_KEY=0x... ./investor-place-bid.sh $ASSET_ID 500 0.98

# Third bid from another investor
INVESTOR_PRIVATE_KEY=0x<another_key> ./investor-place-bid.sh $ASSET_ID 2000 0.93
```

### Step 5: Monitor Auction End
```bash
# Wait for auction to end (duration + 1 minute)
# Check for AUCTION_ENDED announcement
./check-announcements.sh $ASSET_ID
```

## Expected Timeline

```
T+0:00  Upload asset → Asset ID received
T+0:05  Admin approves → Status: ATTESTED
T+0:06  Admin schedules (5 min) → AUCTION_SCHEDULED announcement
T+5:06  [Job activates auction] → listing.active = true
T+6:06  [Job checks status] → AUCTION_LIVE announcement
```

## API Endpoints Used

| Endpoint | Method | Script |
|----------|--------|--------|
| `/auth/challenge` | GET | All |
| `/auth/login` | POST | All |
| `/assets/upload` | POST | upload-auction-asset.sh |
| `/assets/:id` | GET | admin-approve-and-schedule.sh |
| `/admin/compliance/approve` | POST | admin-approve-and-schedule.sh |
| `/admin/compliance/schedule-auction` | POST | admin-approve-and-schedule.sh |
| `/announcements/asset/:id` | GET | check-announcements.sh |
| `/marketplace/bids/notify` | POST | investor-place-bid.sh |
| `/marketplace/bids/my-bids` | GET | investor-place-bid.sh |
| `/marketplace/auctions/:id/bids` | GET | investor-place-bid.sh |

## Environment Variables

| Variable | Description | Required For |
|----------|-------------|--------------|
| `ORIGINATOR_PRIVATE_KEY` | Originator wallet private key | upload-auction-asset.sh |
| `ADMIN_PRIVATE_KEY` | Admin wallet private key | admin-approve-and-schedule.sh |
| `INVESTOR_PRIVATE_KEY` | Investor wallet private key | investor-place-bid.sh, place-bid.js, sign-investor-login.js |
| `API_BASE_URL` | Backend API URL (default: http://localhost:3000) | All (optional) |

## Troubleshooting

### "jq: command not found"
Install jq:
- macOS: `brew install jq`
- Ubuntu/Debian: `sudo apt-get install jq`
- Other: https://stedolan.github.io/jq/download/

### "Cannot find module 'ethers'"
Install ethers.js in your project:
```bash
cd packages/backend
npm install ethers
```

### "Failed to get challenge"
- Ensure backend server is running
- Check `API_BASE_URL` is correct
- Verify network connectivity

### "Asset approval failed"
- Ensure asset exists and is in UPLOADED/HASHED/MERKLED status
- Verify admin wallet has ADMIN role in database
- Check backend logs for detailed error

### "Auction scheduling failed"
- Ensure asset is ATTESTED or REGISTERED status
- Verify asset type is AUCTION
- Check that asset hasn't already been scheduled

## Quick Reference

```bash
# Full auction flow (simplified)

# 1. Upload asset (Originator)
ORIGINATOR_PRIVATE_KEY=0x... ./upload-auction-asset.sh invoice.pdf
# Save ASSET_ID from output

# 2. Approve and schedule (Admin) - 2 minute delay
ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh <ASSET_ID> 2

# 3. Wait for auction to start and go live
sleep 180  # Wait 3 minutes (2 min delay + 1 min activation check)
./check-announcements.sh <ASSET_ID>  # Should see AUCTION_LIVE

# 4. Place bids (Investors) - all-in-one script
INVESTOR_PRIVATE_KEY=0x... ./investor-place-bid.sh <ASSET_ID> 1000 0.95
INVESTOR_PRIVATE_KEY=0x... ./investor-place-bid.sh <ASSET_ID> 500 0.98
INVESTOR_PRIVATE_KEY=0x<other> ./investor-place-bid.sh <ASSET_ID> 2000 0.93

# 5. Wait for auction to end (depends on duration set)
# Check final announcement with clearing price
./check-announcements.sh <ASSET_ID>  # Should see AUCTION_ENDED
```
