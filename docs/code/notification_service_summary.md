# Notification Service - Technical Summary

**Status:** Implemented (Phase 5)
**Location:** `packages/backend/src/modules/notifications`
**Type:** Hybrid (REST + Server-Sent Events)

---

## 1. Overview

The Notification Service provides a dual-channel communication system:
1.  **Real-Time:** Delivers instant alerts (toasts) to active users via **Server-Sent Events (SSE)**.
2.  **Persistent:** Stores notification history in MongoDB for a "Notification Center" experience (Bell icon).

It is designed as a **Global Module**, meaning any other service (Asset, KYC, Yield) can inject `NotificationService` to alert users without knowing the implementation details.

---

## 2. Architecture

### 2.1 Services
*   **`NotificationService`**: The core logic layer.
    *   Creates notification documents.
    *   Updates user read status.
    *   Triggers the SSE emitter.
*   **`SseEmitterService`**: Manages active HTTP connections.
    *   Maintains a map of `WalletAddress => Response[]`.
    *   Handles connection keep-alive (30s ping).
    *   Broadcasts events to specific users or globally.

### 2.2 Data Model (MongoDB)
We use a **Split-Collection Pattern** to optimize for storage and performance.

**Collection 1: `notifications`**
*   Stores the actual content (Header, Detail, Type, Metadata).
*   **Why?** Allows identical system messages (e.g., "System Maintenance") to be stored once and referenced by thousands of users.

**Collection 2: `usernotifications`**
*   Stores the relationship and status for each user.
*   **Structure:**
    ```typescript
    {
      userId: string,
      walletAddress: string,
      notifications: [
        {
          notificationId: ObjectId, // Ref to 'notifications'
          read: boolean,
          receivedAt: Date
        }
      ],
      meta: { unreadCount: number }
    }
    ```
*   **Why?** Fast lookups for "My Notifications" and "Unread Count" without joining huge tables.

---

## 3. API Endpoints

**Base URL:** `/api/notifications`

| Method | Path | Purpose |
| :--- | :--- | :--- |
| **GET** | `/stream` | Opens the SSE connection. Client listens for `message` events. |
| **GET** | `/` | Fetches paginated history. Supports filtering (`?filter=unread`). |
| **GET** | `/unread-count` | Lightweight endpoint for the Bell icon badge. |
| **PATCH** | `/:id/read` | Marks a specific notification as read. |
| **POST** | `/mark-all-read` | Bulk action to clear all unread badges. |

---

## 4. Notification Types

The system supports typed notifications to drive frontend UI (icons, colors, actions).

*   **`ASSET_STATUS`**: Updates on asset lifecycle (Uploaded -> Tokenized).
*   **`KYC_STATUS`**: Verification results (Approved/Rejected).
*   **`YIELD_DISTRIBUTED`**: Financial alerts when USDC is sent.
*   **`TOKEN_PURCHASED`**: Confirmation of marketplace activity.
*   **`SYSTEM_ALERT`**: Critical platform warnings.

---

## 5. Integration Guide

To send a notification from any other module:

1.  **Inject** the service:
    ```typescript
    constructor(private readonly notificationService: NotificationService) {}
    ```

2.  **Call** the create method:
    ```typescript
    await this.notificationService.create({
      userId: user.id,
      walletAddress: user.walletAddress,
      header: 'Asset Tokenized',
      detail: 'Asset #123 has been deployed on-chain.',
      type: NotificationType.ASSET_STATUS,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_ASSET,
      actionMetadata: { assetId: '123' }
    });
    ```

This single call will:
1.  Save to MongoDB.
2.  Increment the user's unread count.
3.  Push a real-time toaster to their browser if they are online.

---
