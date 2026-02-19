# User Portfolio Module

## Responsibilities
- Maintain a persistent, chain-agnostic record of user holdings across the platform.
- Provide a high-performance dashboard summary with cached aggregate totals.
- Enrich persistent holdings with live data (yield, asset metadata, etc.) for runtime consumption.
- Maintain a recent activity tail for fast activity feed rendering.
- Provide a rebuild mechanism to ensure data integrity.

## Public Interfaces

### UserPortfolioService
- `initializePortfolio(walletAddress: string, network: string)`: Creates an empty portfolio document when an investor is KYC-verified and registered on-chain. Called by KYC module. Idempotent (no-op if portfolio already exists).
- `getPortfolio(walletAddress: string, network: string)`: Builds the full runtime portfolio for a user.
- `updateOnPurchase(purchase: any, network: string)`: Atomic update triggered by a new purchase (primary market, auction, or secondary P2P trade).
- `updateOnYieldClaim(claim: any, network: string)`: Atomic update triggered by a yield claim.
- `updateOnLeverageEvent(positionId: number, network: string)`: Atomic update triggered by leverage position changes.
- `updateOnSolvencyEvent(positionId: number, network: string)`: Atomic update triggered by solvency position changes.
- `rebuildPortfolio(walletAddress: string, network: string)`: Reconstructs the portfolio document from source-of-truth records.
- `addRequestedTrustline(walletAddress: string, network: string, assetId: string)`: (Stellar-specific) Adds assetId to requested_trustlines array when investor requests trustline approval.
- `approveTrustline(walletAddress: string, network: string, assetId: string)`: (Stellar-specific) Moves assetId from requested_trustlines to approved_trustlines when admin approves.
- `hasTrustlineApproved(walletAddress: string, network: string, assetId: string)`: (Stellar-specific) Checks if investor has an approved trustline for an asset.

### UserPortfolioController
- `GET /portfolio`: Returns the full enriched portfolio for the authenticated user.
- `GET /portfolio/summary`: Returns only the dashboard summary (aggregate totals and activity tail).
- `POST /portfolio/rebuild/:walletAddress`: (Admin) Triggers a manual rebuild of a user's portfolio.

### TrustlineController (Stellar-specific)
- `POST /trustline/add-trustline-notify`: Investor notifies backend after adding trustline (frontend executes changeTrust transaction).
- `GET /trustline/check-ability-to-buy/:assetId`: Check if investor can purchase tokens based on trustline approval status.
- `GET /trustline/my-requests`: Get investor's trustline request history with optional status filter.

## Invariants
- All token arithmetic uses `BigInt` to prevent precision loss.
- `tokenBalance` reflects the net balance across all relevant operations (purchases, sales, burns).
- The portfolio document is eventually consistent for async events (leverage, solvency) but should be updated synchronously for the primary purchase path.
- One portfolio document exists per `(walletAddress, network)` pair.
- (Stellar-specific) The `requested_trustlines` and `approved_trustlines` arrays track trustline approval state per assetId for fast O(1) eligibility checks.

## Stellar Trustline State Tracking

### Responsibilities
- Track requested trustlines per investor (requested_trustlines array in UserPortfolio schema).
- Track approved trustlines per investor (approved_trustlines array in UserPortfolio schema).
- Provide fast eligibility checks for token purchases without querying TrustlineRequest collection.
- Expose investor-facing endpoints for trustline request notification and status checks.

### Schema Changes
- `UserPortfolio.requested_trustlines`: Array of assetIds (UUIDs) with pending trustline approval requests.
- `UserPortfolio.approved_trustlines`: Array of assetIds (UUIDs) with approved trustlines.

### Workflow
1. Investor frontend executes `changeTrust` transaction on Stellar using private key.
2. Frontend notifies backend via `POST /trustline/add-trustline-notify` with txHash and assetId.
3. Backend creates TrustlineRequest record and adds assetId to `requested_trustlines`.
4. Admin approves request via `POST /admin/trustline-requests/approve`.
5. Backend moves assetId from `requested_trustlines` to `approved_trustlines`.
6. Investor can check eligibility via `GET /trustline/check-ability-to-buy/:assetId`.

## Dependencies
- `KYCModule`: The portfolio is initialized when an investor is KYC-verified. KYC module calls `initializePortfolio()` after successful blockchain identity registration.
- `MarketplaceModule`: For purchase, yield claim, and asset records. Calls `updateOnPurchase()` after recording each purchase.
- `LeverageModule`: For leverage position data. Calls `updateOnLeverageEvent()` after position state changes.
- `SolvencyModule`: For solvency position data. Calls `updateOnSolvencyEvent()` after position state changes.
- `BlockchainModule`: For network context and event processing. Event processor calls update methods when processing on-chain events (OrderFilled, OrderCancelled, etc.).
- `AssetsModule`: For asset metadata enrichment during portfolio building.
