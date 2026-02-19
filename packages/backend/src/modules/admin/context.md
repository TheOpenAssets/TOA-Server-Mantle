# Admin Module

## Responsibilities
- Provide administrative controls for asset lifecycle management (approval, rejection, auction scheduling).
- Execute admin-privileged blockchain operations (asset approval, auction management, yield distribution).
- Manage trustline approval workflow for Stellar assets (approval, rejection, tracking).
- Synchronize on-chain state with off-chain database for admin-initiated operations.
- Provide admin dashboard endpoints for monitoring and operations.

## Public Interfaces

### AdminController
- `POST /admin/sync/:assetId`: Manually trigger sync for a specific asset.
- `POST /admin/sync-all`: Trigger sync for all assets.
- `GET /admin/stats`: Get platform-wide statistics.

### ComplianceController
- `POST /admin/compliance/approve`: Approve an asset for deployment.
- `POST /admin/compliance/reject`: Reject an asset.
- `POST /admin/compliance/schedule-auction`: Schedule an auction for an approved asset.
- `GET /admin/compliance/auction-clearing-price/:assetId`: Get suggested clearing price for auction.
- `POST /admin/compliance/end-auction`: End an auction with clearing price.

### AssetOpsController
- `GET /admin/assets`: Query all assets with filters.
- `GET /admin/assets/:assetId`: Get detailed asset information.
- `POST /admin/assets/deploy`: Manually trigger asset deployment.

### YieldOpsController
- `POST /admin/yield/schedule`: Schedule yield distribution for an asset.
- `POST /admin/yield/distribute`: Execute yield distribution.
- `GET /admin/yield/pending`: Get pending yield distributions.

### TrustlineOpsController (Stellar-specific)
- `GET /admin/trustline-requests`: Query trustline requests with filters (status, investor, asset, date range).
- `GET /admin/trustline-requests/:requestId`: Get detailed information for a specific trustline request.
- `POST /admin/trustline-requests/approve`: Approve a trustline request and execute blockchain transaction.

## Stellar Trustline Approval Operations

### Responsibilities
- Track pending trustline approval requests via TrustlineRequest collection.
- Provide admin dashboard endpoints for viewing pending, approved, and rejected requests.
- Execute trustline approval transactions via NetworkRegistryService blockchain adapter.
- Orchestrate state updates across TrustlineRequest collection and UserPortfolio.
- Send real-time notifications to investors upon approval.

### TrustlineApprovalService
- `notifyTrustlineAdded(investorAddress, assetId, network, txHash, blockNumber?)`: Creates pending trustline request after investor adds trustline on-chain.
- `approveTrustline(requestId, adminWallet)`: Approves trustline request and executes blockchain transaction.
- `getPendingRequests(filters, pagination)`: Query trustline requests with filters and pagination.
- `getRequestById(requestId)`: Get detailed information for a specific request.

### Workflow
1. Investor frontend executes `changeTrust` transaction on Stellar.
2. Frontend notifies backend via investor endpoint: `POST /trustline/add-trustline-notify`.
3. Backend creates TrustlineRequest with status=PENDING and notifies all admins.
4. Admin views pending requests via `GET /admin/trustline-requests?status=PENDING`.
5. Admin approves via `POST /admin/trustline-requests/approve` with requestId and adminWallet.
6. Backend executes blockchain approval via `NetworkRegistryService.approveTrustlineForUser()`.
7. On success: updates TrustlineRequest status to APPROVED, moves assetId in portfolio arrays, notifies investor.
8. On failure: keeps status as PENDING for retry.

### Dependencies
- `UserPortfolioService`: For updating requested_trustlines and approved_trustlines arrays.
- `NetworkRegistryService`: For executing blockchain approval transactions.
- `NotificationService`: For sending notifications to admins and investors.
- `AssetModule`: For fetching asset metadata.

## Invariants
- All admin operations require JWT authentication with AdminRoleGuard.
- Asset approval operations are network-aware and delegate to appropriate blockchain adapter.
- Trustline approval is Stellar-specific and validates network before processing.
- Admin notifications are sent to all wallets listed in `configs/approved_admins.json`.

## Dependencies
- `AssetModule`: For asset lifecycle operations.
- `BlockchainModule`: For executing on-chain transactions.
- `YieldModule`: For yield distribution operations.
- `LeverageModule`: For leverage position monitoring.
- `UserPortfolioModule`: For portfolio state updates (trustline arrays).
- `NotificationsModule`: For sending notifications to admins and users.
- `AuthModule`: For admin authentication and authorization.
- `RegistryModule`: For network-specific admin strategy providers.
