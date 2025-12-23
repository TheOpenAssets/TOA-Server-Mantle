You're absolutely right - I apologize. You explicitly said **"no code"** multiple times, and I started including full code implementations instead of just architectural plans.

Let me correct this and provide the **Notification Service Plan** the way you requested - **architectural design only, no code**.

---

## **Notification Service - Architecture Plan**

---

## **System Overview**

**Purpose:** Real-time notification system using Server-Sent Events (SSE) for instant alerts, with MongoDB storage for notification history and user management.

**Core Components:**
1. **SSE Emitter Service** - Injectable provider for real-time event emission
2. **Notification Service** - Main service (used like Logger across codebase)
3. **REST API** - Fetch, filter, mark read/unread
4. **Database Collections** - Notifications + UserNotifications

---

## **Architecture Pattern**

### **Two-Tier Notification Delivery**

**Tier 1: Real-Time Toast (SSE)**
- User receives instant brief notification via SSE
- Shows as toast/banner: "Asset Approval Granted - Check notifications for details"
- Dismissible, non-blocking
- No persistent storage on frontend

**Tier 2: Persistent Notification Center (REST)**
- User clicks bell icon → Fetches full notification list
- Supports filtering: All, Unread, Read, By Type
- Pagination support
- Displays full details + action buttons

---

## **Database Design**

### **Collection 1: notifications**

**Purpose:** Store the actual notification content (shared, reusable)

**Fields:**
- Notification ID (auto-generated)
- Header (5-10 words, e.g., "Asset Approval Granted")
- Detail (full paragraph explanation)
- Type (enum: ASSET_STATUS, YIELD_DISTRIBUTED, TOKEN_PURCHASED, KYC_STATUS, etc.)
- Action (enum: VIEW_ASSET, VIEW_PORTFOLIO, CLAIM_YIELD, VIEW_MARKETPLACE, NONE)
- Action Metadata (assetId, tokenAddress, amount - for constructing action links)
- Icon (icon name or URL for frontend display)
- Severity (info, success, warning, error)
- Timestamps (created, updated)

**Why Separate Collection?**
- Allows system-wide announcements (single notification → many users)
- Reduces storage redundancy
- Easier to update notification content if needed

### **Collection 2: usernotifications**

**Purpose:** Link users to their notifications with read status

**Fields:**
- User ID (reference to users collection)
- Wallet Address (indexed for quick lookup)
- Notifications Array:
  - Notification ID (reference to notifications collection)
  - Read Flag (boolean)
  - Read At (timestamp)
  - Received At (timestamp)
- Meta Object:
  - Unread Count (integer)
  - Total Count (integer)
  - Last Fetched At (timestamp)

**Indexes:**
- userId (primary lookup)
- walletAddress (SSE connection mapping)
- notifications.notificationId (for updates)
- notifications.read (for filtering)

---

## **Service Architecture**

### **Service 1: NotificationService (Core)**

**Responsibility:** Create and manage notifications (injectable everywhere)

**Usage Pattern:**
```
Like Logger:
this.notificationService.create({...})

Can be called from any service:
- AssetLifecycleService
- YieldDistributionService
- ComplianceService
- KycService
- etc.
```

**Key Operations:**

**Operation: Create Notification**
- Input: userId, walletAddress, header, detail, type, action, actionMetadata
- Steps:
  1. Create notification document in notifications collection
  2. Add reference to user's usernotifications document
  3. Increment unreadCount in meta
  4. Emit SSE event to frontend (via SseEmitter)
  5. Log audit trail
- Output: Notification ID

**Operation: Create System Announcement (All Users)**
- Input: Same as above minus userId/wallet (broadcast)
- Steps:
  1. Create single notification document
  2. Add reference to ALL users' usernotifications
  3. Emit SSE broadcast to all connected users
- Use Case: Platform maintenance, new features, important updates

**Helper Methods:**
- Get default icon by notification type
- Get default severity by notification type
- Validate action metadata
- Format notification for SSE (compact version)

---

### **Service 2: SseEmitterService**

**Responsibility:** Manage SSE connections and emit real-time events

**Connection Management:**

**Data Structure:**
- Map: walletAddress → Response[] (array supports multiple tabs)
- Each connection has keepalive interval (30s ping)
- Auto-cleanup on disconnect

**Operations:**

**Add Connection:**
- Input: walletAddress, HTTP Response object
- Register connection in map
- Setup keepalive interval
- Setup disconnect handler
- Log connection established

**Remove Connection:**
- Triggered on client disconnect
- Clear keepalive interval
- Remove from map
- Log connection closed

**Emit to User:**
- Input: walletAddress, event object
- Find all connections for user
- Send SSE formatted message to each
- Format: `event: notification\ndata: {json}\n\n`
- Handle send failures gracefully

**Broadcast to All:**
- Iterate all connected users
- Send same message to each
- Use for system-wide announcements

**Get Statistics:**
- Return: Total connected users, total connections
- Use for monitoring dashboard

---

## **REST API Endpoints**

### **Endpoint Structure**

**Base Path:** `/api/notifications`

**Authentication:** All endpoints protected by JwtAuthGuard

**Endpoints:**

**1. Establish SSE Connection**
- Method: GET
- Path: `/stream`
- Purpose: Open SSE connection for real-time notifications
- Headers: Content-Type: text/event-stream, Cache-Control: no-cache
- Response: Stream (keeps connection open)
- Frontend Usage: EventSource('/api/notifications/stream')

**2. Fetch Notifications**
- Method: GET
- Path: `/`
- Query Params:
  - filter: 'all' | 'unread' | 'read'
  - type: NotificationType (optional)
  - limit: number (default 20)
  - offset: number (default 0)
- Response: { notifications[], meta: { unreadCount, totalCount, hasMore } }
- Logic:
  1. Get user's usernotifications document
  2. Filter by read status if specified
  3. Filter by type if specified
  4. Sort by receivedAt (newest first)
  5. Paginate
  6. Fetch full notification details (join)
  7. Merge with read status
  8. Return enriched list

**3. Get Unread Count**
- Method: GET
- Path: `/unread-count`
- Purpose: Display badge on bell icon
- Response: { unreadCount: number }
- Logic: Query meta.unreadCount from usernotifications

**4. Mark as Read**
- Method: PATCH
- Path: `/:notificationId/read`
- Purpose: Mark single notification read
- Logic:
  1. Find notification in user's array
  2. Update read flag to true
  3. Set readAt timestamp
  4. Decrement unreadCount in meta
- Response: { success: boolean }

**5. Mark All as Read**
- Method: POST
- Path: `/mark-all-read`
- Purpose: Bulk read operation
- Logic:
  1. Set all notifications.read = true
  2. Set readAt for all
  3. Set meta.unreadCount = 0
- Response: { success: boolean }

**6. Delete Notification**
- Method: DELETE
- Path: `/:notificationId`
- Purpose: Remove notification from user's list
- Logic:
  1. Pull notification from array
  2. Decrement totalCount
  3. Decrement unreadCount if was unread
- Response: { success: boolean }

---

## **Integration Points**

### **Where to Inject NotificationService**

**Module 1: Asset Lifecycle**

**Trigger: Asset Uploaded**
- Notify: Originator
- Header: "Asset Upload Successful"
- Detail: "Your invoice has been uploaded and queued for processing..."
- Action: VIEW_ASSET

**Trigger: Asset Status Changes**
- HASHED → "Document Processing Complete"
- MERKLED → "Cryptographic Verification Complete"
- PROOF_GENERATED → "Asset Ready for Compliance Review"
- ATTESTED → "Asset Approved by Compliance"
- DA_ANCHORED → "Asset Anchored to EigenDA"
- REGISTERED → "Asset Registered On-Chain"
- TOKENIZED → "Token Deployment Complete"

**Trigger: Asset Rejected**
- Notify: Originator
- Header: "Asset Rejected"
- Detail: Include rejection reason
- Severity: error
- Action: VIEW_ASSET

---

**Module 2: KYC Service**

**Trigger: KYC Approved**
- Notify: User
- Header: "KYC Verification Successful"
- Detail: "Your identity has been verified. You can now invest in RWA tokens."
- Action: VIEW_MARKETPLACE

**Trigger: KYC Rejected**
- Notify: User
- Header: "KYC Verification Failed"
- Detail: Include specific reason
- Severity: warning
- Action: VIEW_KYC (to retry)

---

**Module 3: Yield Distribution**

**Trigger: Yield Distributed**
- Notify: Each token holder who received yield
- Header: "Yield Payment Received"
- Detail: "You received $X.XX from Asset Y. Total claimable: $Z.ZZ"
- Action: CLAIM_YIELD
- Severity: success

**Trigger: Distribution Failed (for specific holder)**
- Notify: Affected holder
- Header: "Yield Distribution Pending"
- Detail: "Your yield of $X.XX is pending. Please claim manually."
- Action: CLAIM_YIELD
- Severity: warning

---

**Module 4: Marketplace**

**Trigger: Listing Created**
- Notify: All users (if general) OR followers (future feature)
- Header: "New Asset Listed"
- Detail: "Invoice #123 is now available for investment..."
- Action: VIEW_MARKETPLACE

**Trigger: Token Purchase Success**
- Notify: Buyer
- Header: "Token Purchase Successful"
- Detail: "You purchased X tokens of Asset Y for $Z"
- Action: VIEW_PORTFOLIO
- Severity: success

**Trigger: Token Purchase Failed**
- Notify: Buyer
- Header: "Token Purchase Failed"
- Detail: Include failure reason (insufficient funds, compliance check, etc.)
- Severity: error
- Action: VIEW_MARKETPLACE

**Trigger: Auction Price Update (if applicable)**
- Notify: Users who have this asset in watchlist (future)
- Header: "Price Drop Alert"
- Detail: "Asset X price dropped to $Y"
- Action: VIEW_MARKETPLACE

---

**Module 5: Admin Operations**

**Trigger: Admin Action Required**
- Notify: All admins
- Header: "Asset Pending Review"
- Detail: "Asset X requires compliance approval"
- Type: ADMIN_ALERT
- Action: NONE (handled in admin dashboard)

**Trigger: System Alert**
- Notify: All admins
- Header: "System Alert"
- Detail: EigenDA failure, blockchain sync lag, etc.
- Severity: error
- Type: ADMIN_ALERT

---

## **Frontend Integration Flow**

### **Real-Time Toast Flow**

**Step 1: Establish SSE Connection**
- On app load (after authentication)
- Open EventSource to `/api/notifications/stream`
- Listen for 'notification' events
- Listen for 'connected' event (connection confirmation)

**Step 2: Receive Event**
- SSE emits: `{ type: 'notification', data: { header, severity, notificationId } }`
- Frontend displays toast with header + severity styling
- Auto-dismiss after 5 seconds OR user dismisses
- Increment bell badge count

**Step 3: User Action**
- If user clicks toast → Navigate to notification center
- If user ignores → Toast dismissed, notification persists in center

---

### **Notification Center Flow**

**Step 1: User Clicks Bell Icon**
- Fetch: GET `/api/notifications?filter=unread&limit=20`
- Display in dropdown/modal

**Step 2: User Scrolls (Pagination)**
- Fetch next batch: GET `/api/notifications?offset=20&limit=20`
- Append to list

**Step 3: User Clicks Notification**
- Mark as read: PATCH `/api/notifications/:id/read`
- Decrement badge count
- Execute action:
  - VIEW_ASSET → Navigate to `/assets/:assetId`
  - VIEW_PORTFOLIO → Navigate to `/portfolio`
  - CLAIM_YIELD → Navigate to `/portfolio/yield`
  - etc.

**Step 4: Filtering**
- User selects filter (All, Unread, Read)
- Fetch: GET `/api/notifications?filter=unread`
- Replace list

**Step 5: Mark All Read**
- POST `/api/notifications/mark-all-read`
- Reset badge to 0
- Update all notification states in UI

---

## **Module Configuration**

### **File Structure**

```
packages/backend/src/modules/notifications/
├── notifications.module.ts
├── controllers/
│   └── notifications.controller.ts
├── services/
│   ├── notification.service.ts
│   └── sse-emitter.service.ts
├── schemas/
│   ├── notification.schema.ts
│   └── user-notification.schema.ts
├── dto/
│   ├── create-notification.dto.ts
│   └── fetch-notifications.dto.ts
└── enums/
    ├── notification-type.enum.ts
    └── notification-action.enum.ts
```

### **Module Registration**

**NotificationsModule:**
- Imports: MongooseModule (schemas)
- Providers: NotificationService, SseEmitterService
- Controllers: NotificationsController
- Exports: NotificationService, SseEmitterService (global usage)

**AppModule:**
- Import NotificationsModule as global
- Makes services available everywhere

---

## **Performance Considerations**

### **SSE Connection Management**

**Problem:** Many concurrent connections consume memory

**Solution:**
- Implement connection pooling
- Set maximum connections per user (e.g., 5 tabs max)
- Auto-disconnect inactive connections after 30 minutes
- Monitor active connection count

### **Database Queries**

**Problem:** Notification fetching with joins can be slow

**Solution:**
- Index walletAddress and userId
- Index notifications array
- Cache unread count in Redis (TTL 1 minute)
- Paginate aggressively (20 per page max)

### **Bulk Operations**

**Problem:** System announcements to 10,000+ users

**Solution:**
- Use MongoDB bulkWrite operations
- Process in batches of 1000
- Queue SSE emissions (don't block)
- Run as background job

---

## **Error Handling**

### **SSE Connection Failures**

**Scenario:** Client disconnects, reconnects

**Handling:**
- Auto-reconnect on frontend (exponential backoff)
- Backend cleanup on disconnect
- No data loss (notifications stored in DB)

### **Notification Creation Failures**

**Scenario:** MongoDB write fails

**Handling:**
- Log error with full context
- Don't crash service that triggered notification
- Retry 3 times
- Alert admin if all retries fail
- User can still fetch via REST

### **SSE Send Failures**

**Scenario:** Response stream closed mid-send

**Handling:**
- Catch error, don't crash
- Remove connection from pool
- User will fetch via REST on next bell click

---

## **Monitoring & Analytics**

### **Metrics to Track**

**Real-Time:**
- Active SSE connections count
- SSE messages sent per minute
- SSE send failure rate

**Notifications:**
- Notifications created per type (daily)
- Average read time (receivedAt → readAt)
- Read rate per notification type
- Unread notification accumulation per user

**API:**
- Notification fetch endpoint latency
- Mark read success rate

### **Admin Dashboard Widgets**

- Active connections graph (real-time)
- Notification types distribution (pie chart)
- User engagement: Read rate per type
- Failed SSE sends log

---

This is the **architectural plan** for the notification service without any code implementation. It defines responsibilities, flows, integration points, and design decisions that developers can use to implement the service.