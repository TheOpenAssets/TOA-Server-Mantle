# Auction Scheduling & Announcements Implementation

## Overview
This document summarizes the implementation of the auction scheduling system with admin-controlled timing, announcements collection, and automated auction status checking for the RWA platform.

## What Was Implemented

### 1. Announcements Collection

**New Schema**: `packages/backend/src/database/schemas/announcement.schema.ts`

- **Purpose**: Store public announcements about auction events
- **Fields**:
  - `announcementId`: Unique identifier (UUID)
  - `assetId`: Reference to the asset
  - `type`: Enum of announcement types (AUCTION_SCHEDULED, AUCTION_LIVE, AUCTION_FAILED, AUCTION_ENDED, ASSET_LISTED)
  - `title`: Announcement title
  - `message`: Detailed message with auction information
  - `status`: ACTIVE or ARCHIVED
  - `metadata`: Rich metadata including:
    - Invoice details (number, face value, industry, risk tier)
    - Token supply and price range
    - Auction timing (start time, end time, duration)
    - Failure reason (if applicable)
  - `createdAt`, `updatedAt`: Timestamps

**Announcement Types**:
- `AUCTION_SCHEDULED`: Created when admin schedules an auction with future start time
- `AUCTION_LIVE`: Created 1 minute after auction activates to confirm it's actually live
- `AUCTION_FAILED`: Created if auction fails to start properly
- `AUCTION_ENDED`: For future use when auction completes
- `ASSET_LISTED`: For future use when assets are listed

### 2. Announcement Service

**Location**: `packages/backend/src/modules/announcements/services/announcement.service.ts`

**Key Methods**:
- `createAuctionScheduledAnnouncement(assetId, auctionStartTime)`: Creates announcement when auction is scheduled
- `createAuctionLiveAnnouncement(assetId)`: Creates announcement confirming auction is live
- `createAuctionFailedAnnouncement(assetId, reason)`: Creates announcement when auction fails
- `getAllAnnouncements(filters)`: Retrieves announcements with pagination and filtering
- `getAnnouncementsByAsset(assetId)`: Gets all announcements for a specific asset
- `archiveAnnouncement(announcementId)`: Archives an announcement

**Message Format Examples**:
- **Scheduled**: "A new auction has been scheduled for invoice INV-123. The auction will start at 2025-01-15T10:00:00Z and run for 24 hours. Face value: 100000 USD. Total supply: 100000 tokens. Bid range: $0.80 - $0.95 per token."
- **Live**: "The auction for invoice INV-123 is now live! Place your bids before 2025-01-16T10:00:00Z. Face value: 100000 USD. Total supply: 100000 tokens. Bid range: $0.80 - $0.95 per token."
- **Failed**: "The auction for invoice INV-123 has failed. Reason: Auction failed to activate on-chain"

### 3. Announcement API Endpoints

**Location**: `packages/backend/src/modules/announcements/controllers/announcement.controller.ts`

**Endpoints**:
- `GET /announcements`: Get all announcements with optional filters
  - Query params: `type`, `status`, `page`, `limit`
- `GET /announcements/asset/:assetId`: Get all announcements for a specific asset
- `PATCH /announcements/:announcementId/archive`: Archive an announcement

### 4. Admin Endpoints

**Location**: `packages/backend/src/modules/admin/controllers/compliance.controller.ts`

**Two-Step Process**:

#### Step 1: Approve Asset
```
POST /admin/compliance/approve
{
  "assetId": "uuid",
  "adminWallet": "0x..."
}
```
- Generates attestation with admin's ECDSA signature
- Updates asset status to ATTESTED
- Queues EigenDA anchoring job
- **Does NOT automatically schedule auction**

#### Step 2: Schedule Auction (Admin Control)
```
POST /admin/compliance/schedule-auction
{
  "assetId": "uuid",
  "startDelayMinutes": 5
}
```
- Admin specifies when auction should start (in minutes from now)
- Creates AUCTION_SCHEDULED announcement immediately
- Queues delayed job to activate auction at specified time

**Response**:
```json
{
  "success": true,
  "assetId": "uuid",
  "scheduledStartTime": "2025-01-15T10:05:00Z",
  "message": "Auction scheduled to start in 5 minutes"
}
```

### 5. Auction Scheduling Logic

**Updated**: `packages/backend/src/modules/assets/services/asset-lifecycle.service.ts`

**scheduleAuction Method** (assetId, startDelayMinutes):
1. Validates asset exists and is AUCTION type
2. Validates asset is ATTESTED or REGISTERED
3. Calculates auction start time: `now + startDelayMinutes * 60 seconds`
4. Creates AUCTION_SCHEDULED announcement with future start time
5. Queues `activate-auction` job with delay of `startDelayMinutes * 60 * 1000 ms`

**New Dependencies Injected**:
- `AnnouncementService`: To create announcements
- `@InjectQueue('auction-status-check')`: Queue for delayed auction operations

### 6. Auction Activation & Status Check Jobs

**Processor**: `packages/backend/src/modules/announcements/processors/auction-status.processor.ts`

**Handles Two Job Types**:

#### Job 1: `activate-auction`
- **When**: Runs at the scheduled auction start time (admin-specified delay)
- **Actions**:
  1. Fetches asset from database
  2. Sets `listing.active = true`
  3. Sets `listing.listedAt = new Date()`
  4. Queues `check-auction-status` job to run 1 minute later

#### Job 2: `check-auction-status`
- **When**: Runs 1 minute after auction activation
- **Purpose**: Verify auction is actually live on-chain
- **Logic**:
  - If `listing.active === true`: Creates `AUCTION_LIVE` announcement
  - If `listing.active === false`: Creates `AUCTION_FAILED` announcement with reason

**Failure Reasons**:
- "Auction listing not found"
- "Auction failed to activate on-chain"
- "Asset is not configured as auction type"

### 7. Module Updates

**AnnouncementsModule** (new): `packages/backend/src/modules/announcements/announcements.module.ts`
- Imports: Announcement and Asset schemas, auction-status-check queue
- Providers: AnnouncementService, AuctionStatusProcessor
- Exports: AnnouncementService
- Controllers: AnnouncementController

**AssetModule** (updated): `packages/backend/src/modules/assets/assets.module.ts`
- Added: `BullModule.registerQueue({ name: 'auction-status-check' })`
- Added: `forwardRef(() => AnnouncementsModule)` to avoid circular dependency

**AppModule** (updated): `packages/backend/src/app.module.ts`
- Added: `AnnouncementsModule` to imports

## Complete Flow

### Originator Side
1. Originator uploads auction asset using `/assets/upload`
   - Sets `assetType=AUCTION`
   - Provides `minRaisePercentage`, `maxRaisePercentage`, `auctionDuration`
   - Backend calculates price range automatically
2. Asset status: `UPLOADED` → `HASHED` → `MERKLED` → awaits admin approval

### Admin Side (Two Steps)

#### Step 1: Approve Asset
```bash
curl -X POST http://localhost:3000/admin/compliance/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "550e8400-e29b-41d4-a716-446655440000",
    "adminWallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb"
  }'
```

Response:
```json
{
  "success": true,
  "assetId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "ATTESTED"
}
```

#### Step 2: Schedule Auction (Admin chooses timing)
```bash
curl -X POST http://localhost:3000/admin/compliance/schedule-auction \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "550e8400-e29b-41d4-a716-446655440000",
    "startDelayMinutes": 5
  }'
```

Response:
```json
{
  "success": true,
  "assetId": "550e8400-e29b-41d4-a716-446655440000",
  "scheduledStartTime": "2025-01-15T10:05:00Z",
  "message": "Auction scheduled to start in 5 minutes"
}
```

**What happens immediately**:
- AUCTION_SCHEDULED announcement created
- Job queued to activate auction in 5 minutes

### Automated System (5 minutes later)
1. `activate-auction` job executes
2. Sets `listing.active = true` and `listing.listedAt = now`
3. Queues another job to check status in 1 minute

### Automated System (1 minute after activation)
1. `check-auction-status` job executes
2. Checks if auction is actually live:
   - **Success**: Creates `AUCTION_LIVE` announcement
   - **Failure**: Creates `AUCTION_FAILED` announcement with reason

### Public Side
1. Users can query announcements:
   - `GET /announcements?status=ACTIVE&type=AUCTION_SCHEDULED` → See upcoming auctions
   - `GET /announcements?status=ACTIVE&type=AUCTION_LIVE` → See active live auctions
   - `GET /announcements/asset/:assetId` → See announcement history for specific asset

## Timeline Example

```
T+0:00  Admin approves asset (POST /admin/compliance/approve)
        ↓
        Asset status: ATTESTED

T+0:05  Admin schedules auction for 5 minutes (POST /admin/compliance/schedule-auction)
        ↓
        AUCTION_SCHEDULED announcement created
        Job queued with 5-minute delay

T+5:00  [activate-auction job runs]
        ↓
        listing.active = true
        listing.listedAt = now
        Job queued with 1-minute delay

T+6:00  [check-auction-status job runs]
        ↓
        If successful: AUCTION_LIVE announcement created
        If failed: AUCTION_FAILED announcement created
```

## Database Collections

### announcements Collection
```javascript
{
  announcementId: "uuid",
  assetId: "asset-uuid",
  type: "AUCTION_SCHEDULED",
  title: "Auction Scheduled: INV-123",
  message: "A new auction has been scheduled...",
  status: "ACTIVE",
  metadata: {
    invoiceNumber: "INV-123",
    faceValue: "100000",
    totalSupply: "100000000000000000000000",
    priceRange: { min: "800000", max: "950000" },
    auctionStartTime: "2025-01-15T10:05:00Z",
    auctionEndTime: "2025-01-16T10:05:00Z",
    duration: 86400,
    industry: "Technology",
    riskTier: "A"
  },
  createdAt: "2025-01-15T10:00:00Z",
  updatedAt: "2025-01-15T10:00:00Z"
}
```

## API Reference

### Admin APIs

#### Approve Asset
```bash
POST /admin/compliance/approve
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "assetId": "uuid",
  "adminWallet": "0x..."
}
```

#### Schedule Auction
```bash
POST /admin/compliance/schedule-auction
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "assetId": "uuid",
  "startDelayMinutes": 5
}
```

### Public APIs

#### Get All Announcements
```bash
GET /announcements?type=AUCTION_LIVE&status=ACTIVE&page=1&limit=20
```

Response:
```json
{
  "announcements": [...],
  "pagination": {
    "total": 5,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

#### Get Announcements by Asset
```bash
GET /announcements/asset/550e8400-e29b-41d4-a716-446655440000
```

#### Archive Announcement
```bash
PATCH /announcements/550e8400-e29b-41d4-a716-446655440000/archive
```

## Next Steps (For Scripts)

Once this implementation is reviewed and approved, the following scripts will be created:

1. **scripts/admin-login.sh**: Bash script for admin authentication
   - Takes admin private key as environment variable
   - Gets challenge from `/auth/challenge?role=ADMIN`
   - Signs the message
   - Calls `/auth/login`
   - Returns access token

2. **scripts/approve-asset.sh**: Approve an asset
   - Takes asset ID as parameter
   - Uses admin access token
   - Calls `POST /admin/compliance/approve`

3. **scripts/schedule-auction.sh**: Schedule auction with timing control
   - Takes asset ID and delay (in minutes) as parameters
   - Uses admin access token
   - Calls `POST /admin/compliance/schedule-auction`
   - Displays scheduled start time and announcement details

## Testing Recommendations

1. **Unit Tests**:
   - AnnouncementService methods
   - AuctionStatusProcessor.activateAuction()
   - AuctionStatusProcessor.checkAuctionStatus()
   - AssetLifecycleService.scheduleAuction()

2. **Integration Tests**:
   - Approval flow for AUCTION assets
   - Scheduling with different delays (1 min, 5 min, 60 min)
   - Delayed job execution timing
   - Announcement creation and retrieval

3. **E2E Tests**:
   - Upload AUCTION asset → Admin approve → Admin schedule (5 min delay) → Verify AUCTION_SCHEDULED announcement
   - Wait 5 minutes → Verify auction activated
   - Wait 1 more minute → Verify AUCTION_LIVE announcement created
   - Query announcements via API endpoints

## Key Design Decisions

1. **Admin Controls Timing**: Auction doesn't start immediately on approval - admin decides when
2. **Two-Step Process**: Approval (attestation) and Scheduling are separate operations
3. **Flexible Delay**: Admin can schedule auction to start in any number of minutes
4. **Announcements as Separate Collection**: Enables public announcement board
5. **Rich Metadata**: Announcements include all info needed for UI display
6. **Two-Job Pattern**:
   - First job activates auction at scheduled time
   - Second job verifies activation 1 minute later
7. **Forward References**: Avoid circular dependencies between modules

## Files Created

- `packages/backend/src/database/schemas/announcement.schema.ts`
- `packages/backend/src/modules/announcements/services/announcement.service.ts`
- `packages/backend/src/modules/announcements/controllers/announcement.controller.ts`
- `packages/backend/src/modules/announcements/processors/auction-status.processor.ts`
- `packages/backend/src/modules/announcements/announcements.module.ts`

## Files Modified

- `packages/backend/src/modules/assets/services/asset-lifecycle.service.ts`
  - Added `scheduleAuction(assetId, startDelayMinutes)` method
  - Removed automatic scheduling from `approveAsset()`
- `packages/backend/src/modules/admin/controllers/compliance.controller.ts`
  - Added `POST /admin/compliance/schedule-auction` endpoint
- `packages/backend/src/modules/assets/assets.module.ts`
  - Added auction-status-check queue registration
- `packages/backend/src/app.module.ts`
  - Added AnnouncementsModule import
