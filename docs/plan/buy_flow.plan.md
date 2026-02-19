# Stellar Trustline Approval Workflow Implementation Plan

## Context

### Problem
Currently, the Stellar token purchase flow requires three manual script executions:
1. Investor runs `register-investor.js` to add a trustline to an RWA token
2. Admin manually runs `approve-trustline.js` to authorize the trustline
3. Investor runs `buy-tokens.js` to purchase tokens

This manual process lacks:
- Backend awareness of trustline requests
- Admin visibility into pending approvals
- State tracking in investor portfolios
- Purchase eligibility validation
- Automated notifications

Without these capabilities, investors encounter confusing errors when attempting purchases with unapproved trustlines, and admins have no systematic way to manage approval requests.

### Solution Overview
Integrate the trustline approval workflow into the backend by:
- Creating a `TrustlineRequest` collection to track approval requests
- Extending `UserPortfolio` schema with `requested_trustlines` and `approved_trustlines` arrays
- Adding **notification endpoint** for investors (frontend executes trustline transaction, then notifies backend)
- Adding investor endpoints for checking eligibility and viewing request history
- Adding admin endpoints for viewing and approving requests
- Integrating with existing notification system for real-time alerts
- Leveraging existing `NetworkRegistryService.approveTrustlineForUser()` method for blockchain execution

**Key Pattern**: Follows existing `bid-placed-notify` and `purchase-notify` pattern where frontend handles investor transactions (requires private key), then notifies backend.

This feature is **Stellar-specific** and will not affect EVM/Mantle asset flows.

---

## Implementation Steps

### Step 1: Create TrustlineRequest Schema

**File to create:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/database/schemas/trustline-request.schema.ts`

Define a new collection for tracking trustline approval requests:

```typescript
TrustlineRequest:
  - requestId: string (UUID, unique, indexed)
  - investorAddress: string (wallet address, lowercase, indexed)
  - assetId: string (UUID, indexed)
  - assetCode: string (Stellar asset code, e.g., "RWA5BD056A9")
  - issuerAddress: string (Platform public key)
  - network: string ('stellar', indexed)
  - status: enum (PENDING | APPROVED | REJECTED)
  - trustlineTransactionHash: string (investor's changeTrust txHash from frontend)
  - requestedAt: Date
  - reviewedBy?: string (admin wallet address)
  - reviewedAt?: Date
  - rejectionReason?: string
  - approvalTransactionHash?: string (admin's allowTrust txHash)
  - metadata?: Object
  - createdAt, updatedAt: Date (Mongoose timestamps)
```

**Indexes:**
- `{ requestId: 1 }` - unique
- `{ investorAddress: 1 }`
- `{ assetId: 1 }`
- `{ status: 1 }`
- `{ createdAt: -1 }`
- `{ investorAddress: 1, assetId: 1 }` - compound for duplicate detection

**Pattern reference:** Follow `PrivateAssetRequest` schema at `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/database/schemas/private-asset-request.schema.ts`

---

### Step 2: Extend UserPortfolio Schema

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/user-portfolio/schemas/user-portfolio.schema.ts`

Add two new fields to the `UserPortfolio` class (after line 127):

```typescript
@Prop({ type: [String], default: [] })
requested_trustlines!: string[]; // Array of assetIds with pending trustline requests

@Prop({ type: [String], default: [] })
approved_trustlines!: string[]; // Array of assetIds with approved trustlines
```

These arrays enable fast O(1) eligibility checks without querying the TrustlineRequest collection.

---

### Step 3: Create TrustlineApprovalService

**File to create:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/admin/services/trustline-approval.service.ts`

Implement core orchestration service with methods:

**`notifyTrustlineAdded(investorAddress, assetId, network, txHash)`**
- **Important**: Frontend already executed the `changeTrust` transaction using investor's private key. This method just records it.
- Validate network is 'stellar' (throw BadRequestException if not)
- Fetch asset from Assets collection, verify it exists
- Extract `assetCode` and `issuerAddress` from asset
- Check for duplicate request: query TrustlineRequest with `{ investorAddress, assetId, status: PENDING }`
- If duplicate exists, return existing request (idempotent)
- Generate UUID for requestId
- Create TrustlineRequest with status=PENDING, trustlineTransactionHash=txHash
- Update portfolio: add assetId to `requested_trustlines` using `$addToSet`
- Notify all admins via `notifyAllAdmins()` helper
- Return `{ success: true, requestId, status: 'PENDING' }`

**`approveTrustline(requestId, adminWallet)`**
- Fetch TrustlineRequest by requestId
- Validate status is PENDING (throw BadRequestException if not)
- Call `NetworkRegistryService.approveTrustlineForUser(investorAddress, assetIdentifier)`
- If blockchain call succeeds:
  - Update TrustlineRequest: set status=APPROVED, reviewedBy=adminWallet, reviewedAt=now, approvalTransactionHash
  - Update portfolio: remove assetId from `requested_trustlines` ($pull), add to `approved_trustlines` ($addToSet)
  - Notify investor via NotificationService
  - Return `{ success: true, transactionHash, request }`
- If blockchain call fails:
  - Keep request status as PENDING (admin can retry)
  - Throw ServiceUnavailableException with blockchain error details

**`getPendingRequests(filters, pagination)`**
- Build MongoDB query with optional filters: status, investorAddress, assetId, dateFrom, dateTo
- Sort by createdAt descending
- Apply pagination (skip/limit)
- Populate with asset metadata (name, assetCode, industry)
- Return `{ requests: [...], totalCount, page, limit }`

**`getRequestById(requestId)`**
- Fetch single request with full details
- Return enriched with asset metadata

**`notifyAllAdmins(header, detail, metadata)`**
- Load admin wallets from config (`approved_admins.json`)
- Create notification for each admin with type=TRUSTLINE_REQUEST, severity=INFO, action=VIEW_TRUSTLINE_REQUESTS
- Use existing NotificationService.create() method

**Dependencies:**
- InjectModel for TrustlineRequest and Asset
- UserPortfolioService
- NetworkRegistryService
- NotificationService
- ConfigService

**Pattern reference:** Follow `AssetLifecycleService` at `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/assets/services/asset-lifecycle.service.ts`

---

### Step 4: Extend UserPortfolioService

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/user-portfolio/services/user-portfolio.service.ts`

Add new methods (after existing methods):

**`addRequestedTrustline(walletAddress, network, assetId)`**
- Use `updateOne()` with `$addToSet` to add assetId to requested_trustlines array
- Create portfolio if doesn't exist (upsert: true)

**`approveTrustline(walletAddress, network, assetId)`**
- Use `updateOne()` with `$pull` to remove from requested_trustlines
- Use `$addToSet` to add to approved_trustlines

**`hasTrustlineApproved(walletAddress, network, assetId): Promise<boolean>`**
- Find portfolio, check if assetId exists in approved_trustlines array
- Return boolean

---

### Step 5: Create Investor Controller

**File to create:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/user-portfolio/controllers/trustline.controller.ts`

Implement investor-facing endpoints:

**POST `/trustline/add-trustline-notify`**
- **Pattern**: Follows existing `/marketplace/purchases/notify` and `/marketplace/bids/notify` endpoints
- **Flow**: Frontend executes `changeTrust` transaction with investor's private key, then notifies backend
- Guards: JwtAuthGuard
- Body DTO: `{ txHash: string, assetId: string, network: string, blockNumber?: string }`
- Extract investorAddress from JWT token (req.user.walletAddress)
- Call `TrustlineApprovalService.notifyTrustlineAdded(investorAddress, assetId, network, txHash)`
- Response: `{ success: boolean, requestId: string, status: string }`
- Swagger: Full documentation with examples

**GET `/trustline/check-ability-to-buy/:assetId`**
- Guards: JwtAuthGuard
- Params: assetId (UUID)
- Extract investorAddress from JWT token
- Query portfolio for requested_trustlines and approved_trustlines
- Logic:
  - If assetId in approved_trustlines: `{ canBuy: true, trustlineStatus: 'APPROVED' }`
  - If assetId in requested_trustlines: `{ canBuy: false, trustlineStatus: 'PENDING', reason: 'Trustline approval pending' }`
  - Otherwise: `{ canBuy: false, trustlineStatus: 'NOT_REQUESTED', reason: 'Trustline not yet requested' }`
- Swagger: Document all response scenarios

**GET `/trustline/my-requests`**
- Guards: JwtAuthGuard
- Query params: status?, limit?, offset?
- Extract investorAddress from JWT token
- Query TrustlineRequest collection filtered by investorAddress
- Response: Paginated list of investor's requests

**DTOs to create:**
- `NotifyTrustlineDto`: txHash (IsString), assetId (IsUUID), network (IsString, IsEnum), blockNumber? (IsNumberString, IsOptional)
- `CheckAbilityResponseDto`: canBuy, trustlineStatus, reason?

**Pattern reference:** Follow `/marketplace/purchases/notify` at line 346-351 in `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/marketplace/controllers/marketplace.controller.ts`

---

### Step 6: Create Admin Controller

**File to create:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/admin/controllers/trustline-ops.controller.ts`

Implement admin-facing endpoints:

**GET `/admin/trustline-requests`**
- Guards: JwtAuthGuard, AdminRoleGuard
- Query params: status?, investorAddress?, assetId?, dateFrom?, dateTo?, limit?, offset?, sortBy?, sortOrder?
- Call `TrustlineApprovalService.getPendingRequests()`
- Response: Paginated list with asset metadata

**GET `/admin/trustline-requests/:requestId`**
- Guards: JwtAuthGuard, AdminRoleGuard
- Params: requestId (UUID)
- Call `TrustlineApprovalService.getRequestById()`
- Response: Full request details with asset metadata

**POST `/admin/trustline/approve`**
- Guards: JwtAuthGuard, AdminRoleGuard
- Body DTO: `{ requestId: string, adminWallet: string }`
- Call `TrustlineApprovalService.approveTrustline()`
- Response: `{ success: boolean, transactionHash?: string, request: TrustlineRequest }`

**DTOs to create:**
- `ApproveTrustlineDto`: requestId (IsUUID), adminWallet (IsString)
- `TrustlineRequestQueryDto`: status?, investorAddress?, assetId?, dateFrom?, dateTo?, limit?, offset?, sortBy?, sortOrder?

**Pattern reference:** Follow `ComplianceController` at `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/admin/controllers/compliance.controller.ts`

---

### Step 7: Extend Notification Enums

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/notifications/enums/notification-type.enum.ts`

Add new notification types:
```typescript
TRUSTLINE_REQUEST = 'TRUSTLINE_REQUEST',
TRUSTLINE_APPROVED = 'TRUSTLINE_APPROVED',
TRUSTLINE_REJECTED = 'TRUSTLINE_REJECTED',
```

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/notifications/enums/notification-action.enum.ts`

Add new action:
```typescript
VIEW_TRUSTLINE_REQUESTS = 'VIEW_TRUSTLINE_REQUESTS',
```

---

### Step 8: Update Module Imports

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/admin/admin.module.ts`

- Import TrustlineApprovalService in providers
- Import TrustlineOpsController in controllers
- Import UserPortfolioModule (forwardRef if needed)
- Import NotificationModule

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/user-portfolio/user-portfolio.module.ts`

- Import TrustlineController in controllers
- Export UserPortfolioService for use by admin module

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/database/database.module.ts`

- Register TrustlineRequest schema with MongooseModule.forFeature()

---

### Step 9: Update Context Files

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/admin/context.md`

Add section:
```markdown
## Trustline Approval Operations (Stellar)

### Responsibilities
- Track pending trustline approval requests via TrustlineRequest collection
- Provide admin dashboard endpoints for viewing pending requests
- Execute trustline approval via blockchain adapter
- Orchestrate state updates across portfolio and request collections
- Send notifications to investors upon approval

### Public Interfaces
- GET /admin/trustline-requests - Query pending/approved/rejected requests
- GET /admin/trustline-requests/:requestId - Get single request details
- POST /admin/trustline/approve - Approve trustline and execute on-chain

### Dependencies
- TrustlineApprovalService (orchestration)
- NetworkRegistryService (blockchain execution)
- UserPortfolioService (state updates)
- NotificationService (investor alerts)
```

**File to modify:** `/Users/deadbytes/Documents/Hackathons/Mantle/rwa/packages/backend/src/modules/user-portfolio/context.md`

Add section:
```markdown
## Trustline State Tracking (Stellar)

### Responsibilities
- Track requested trustlines per investor (requested_trustlines array)
- Track approved trustlines per investor (approved_trustlines array)
- Provide fast eligibility checks for token purchases
- Expose investor-facing endpoints for trustline requests and status checks

### Public Interfaces
- POST /trustline/request - Investor requests trustline approval
- GET /trustline/check-ability-to-buy/:assetId - Check purchase eligibility
- GET /trustline/my-requests - View investor's request history

### Schema Changes
- UserPortfolio.requested_trustlines: string[] (assetIds)
- UserPortfolio.approved_trustlines: string[] (assetIds)
```

---

## Critical Files Reference

### New Files
1. `/packages/backend/src/database/schemas/trustline-request.schema.ts` - TrustlineRequest collection
2. `/packages/backend/src/modules/admin/services/trustline-approval.service.ts` - Core orchestration
3. `/packages/backend/src/modules/admin/controllers/trustline-ops.controller.ts` - Admin endpoints
4. `/packages/backend/src/modules/user-portfolio/controllers/trustline.controller.ts` - Investor endpoints

### Modified Files
1. `/packages/backend/src/modules/user-portfolio/schemas/user-portfolio.schema.ts` - Add trustline arrays
2. `/packages/backend/src/modules/user-portfolio/services/user-portfolio.service.ts` - Add trustline methods
3. `/packages/backend/src/modules/notifications/enums/notification-type.enum.ts` - Add notification types
4. `/packages/backend/src/modules/notifications/enums/notification-action.enum.ts` - Add notification actions
5. `/packages/backend/src/modules/admin/admin.module.ts` - Register service and controller
6. `/packages/backend/src/modules/user-portfolio/user-portfolio.module.ts` - Register controller
7. `/packages/backend/src/database/database.module.ts` - Register schema
8. `/packages/backend/src/modules/admin/context.md` - Document new responsibilities
9. `/packages/backend/src/modules/user-portfolio/context.md` - Document new responsibilities

### Existing Files (No Changes Required)
- `/packages/backend/src/modules/blockchain/services/network-registry.service.ts` - Already has `approveTrustlineForUser()` at line 123
- `/scripts/stellar/register-investor.js` - Script for adding trustline (unchanged)
- `/scripts/stellar/approve-trustline.js` - Script reference for understanding approval logic
- `/scripts/stellar/buy-tokens.js` - Script for purchasing tokens (unchanged)

---

## Verification Steps

### Step 1: Schema Verification
```bash
# Start MongoDB and verify collections exist
mongo
> use openassets
> db.trustlinerequests.getIndexes()  # Verify indexes created
> db.userportfolios.findOne()  # Verify new fields present
```

### Step 2: API Testing (Investor Flow)
```bash
# 1. Frontend executes changeTrust transaction (using scripts/stellar/register-investor.js or frontend wallet)
# This returns txHash from Stellar network

# 2. Frontend notifies backend of trustline addition
curl -X POST http://localhost:3000/trustline/add-trustline-notify \
  -H "Authorization: Bearer <INVESTOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "<STELLAR_TX_HASH>", "assetId": "<UUID>", "network": "stellar" }'
# Expected: { success: true, requestId: "<UUID>", status: "PENDING" }

# 3. Check ability to buy (should be false - pending)
curl -X GET http://localhost:3000/trustline/check-ability-to-buy/<ASSET_ID> \
  -H "Authorization: Bearer <INVESTOR_JWT>"
# Expected: { canBuy: false, trustlineStatus: "PENDING", reason: "Trustline approval pending" }

# 4. View own requests
curl -X GET http://localhost:3000/trustline/my-requests \
  -H "Authorization: Bearer <INVESTOR_JWT>"
# Expected: Paginated list with the request
```

### Step 3: API Testing (Admin Flow)
```bash
# 1. Admin views pending requests
curl -X GET http://localhost:3000/admin/trustline-requests?status=PENDING \
  -H "Authorization: Bearer <ADMIN_JWT>"
# Expected: List of pending requests with asset metadata

# 2. Admin approves request
curl -X POST http://localhost:3000/admin/trustline/approve \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "requestId": "<UUID>", "adminWallet": "<ADMIN_WALLET>" }'
# Expected: { success: true, transactionHash: "...", request: {...} }
```

### Step 4: Notification Verification
```bash
# 1. Check admin received notification (after investor request)
curl -X GET http://localhost:3000/notifications \
  -H "Authorization: Bearer <ADMIN_JWT>"
# Expected: Notification with type=TRUSTLINE_REQUEST

# 2. Check investor received notification (after admin approval)
curl -X GET http://localhost:3000/notifications \
  -H "Authorization: Bearer <INVESTOR_JWT>"
# Expected: Notification with type=TRUSTLINE_APPROVED
```

### Step 5: Database State Verification
```bash
# After approval, verify state changes
mongo
> use openassets
> db.trustlinerequests.findOne({ requestId: "<UUID>" })
# Verify: status=APPROVED, reviewedBy set, approvalTransactionHash set

> db.userportfolios.findOne({ walletAddress: "<INVESTOR>", network: "stellar" })
# Verify: assetId moved from requested_trustlines to approved_trustlines
```

### Step 6: Purchase Eligibility Check
```bash
# After approval, check ability to buy (should be true)
curl -X GET http://localhost:3000/trustline/check-ability-to-buy/<ASSET_ID> \
  -H "Authorization: Bearer <INVESTOR_JWT>"
# Expected: { canBuy: true, trustlineStatus: "APPROVED" }
```

### Step 7: Network Isolation Check
```bash
# Verify Mantle assets are unaffected
curl -X POST http://localhost:3000/trustline/add-trustline-notify \
  -H "Authorization: Bearer <INVESTOR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "txHash": "<TX_HASH>", "assetId": "<MANTLE_ASSET_UUID>", "network": "mantle" }'
# Expected: 400 Bad Request - "Trustline approval only available on Stellar"
```

### Step 8: Error Handling Verification
```bash
# Test duplicate request (idempotent)
# Repeat Step 2.2 with same assetId and txHash
# Expected: Same requestId returned, no duplicate created

# Test approving non-PENDING request
# Attempt to approve already-approved request
# Expected: 400 Bad Request

# Test approving non-existent request
curl -X POST http://localhost:3000/admin/trustline/approve \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{ "requestId": "non-existent-uuid", "adminWallet": "<ADMIN_WALLET>" }'
# Expected: 404 Not Found
```

---

## Success Criteria

**Functional Requirements:**
- ✅ Investor can request trustline approval for Stellar assets
- ✅ Backend creates TrustlineRequest record with PENDING status
- ✅ All admins receive real-time notification
- ✅ Admin can view all pending requests via dashboard endpoint
- ✅ Admin can approve request, triggering blockchain transaction
- ✅ On approval success: state updates atomically (portfolio + request)
- ✅ Investor receives approval notification
- ✅ Investor can check purchase eligibility before buying
- ✅ Only Stellar network assets trigger this workflow
- ✅ EVM/Mantle assets are unaffected

**Non-Functional Requirements:**
- ✅ API response times < 2s (p95)
- ✅ Proper database indexes for query performance
- ✅ Complete Swagger API documentation
- ✅ DTOs with class-validator validation
- ✅ Enums for status fields
- ✅ UUID identifiers for requestId
- ✅ context.md files updated
- ✅ Error messages are clear and actionable
- ✅ Idempotent request creation (duplicate detection)

**Code Quality:**
- ✅ Follows CLAUDE.md modular architecture principles
- ✅ Separation of concerns (controller → service → repository)
- ✅ No circular dependencies
- ✅ Uses existing patterns (PrivateAssetRequest, AssetLifecycleService)
- ✅ Proper guard usage (JwtAuthGuard, AdminRoleGuard)
- ✅ Network-aware operations via NetworkRegistryService

---

## Notes

- The blockchain method `NetworkRegistryService.approveTrustlineForUser()` already exists at line 123 and is production-ready
- The three scripts (`register-investor.js`, `approve-trustline.js`, `buy-tokens.js`) remain unchanged - this feature integrates the approval step into the backend
- Future enhancement: Add rejection workflow with POST `/admin/trustline/reject` endpoint
- Future enhancement: Add expiration for stale PENDING requests (e.g., auto-expire after 7 days)
- Future enhancement: Bulk approval operations for admins
