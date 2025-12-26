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

## Environment Variables

| Variable | Description | Required For |
|----------|-------------|--------------|
| `ORIGINATOR_PRIVATE_KEY` | Originator wallet private key | upload-auction-asset.sh |
| `ADMIN_PRIVATE_KEY` | Admin wallet private key | admin-approve-and-schedule.sh |
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
# Full flow in one go (with 2 minute delays between steps)
ORIGINATOR_PRIVATE_KEY=0x... ./upload-auction-asset.sh invoice.pdf
# Copy the ASSET_ID from output

ADMIN_PRIVATE_KEY=0x... ./admin-approve-and-schedule.sh <ASSET_ID> 2

# Wait 2 minutes
sleep 120
./check-announcements.sh <ASSET_ID>

# Wait 1 more minute
sleep 60
./check-announcements.sh <ASSET_ID>
# Should see AUCTION_LIVE announcement
```
