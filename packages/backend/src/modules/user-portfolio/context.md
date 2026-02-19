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

### UserPortfolioController
- `GET /portfolio`: Returns the full enriched portfolio for the authenticated user.
- `GET /portfolio/summary`: Returns only the dashboard summary (aggregate totals and activity tail).
- `POST /portfolio/rebuild/:walletAddress`: (Admin) Triggers a manual rebuild of a user's portfolio.

## Invariants
- All token arithmetic uses `BigInt` to prevent precision loss.
- `tokenBalance` reflects the net balance across all relevant operations (purchases, sales, burns).
- The portfolio document is eventually consistent for async events (leverage, solvency) but should be updated synchronously for the primary purchase path.
- One portfolio document exists per `(walletAddress, network)` pair.

## Dependencies
- `KYCModule`: The portfolio is initialized when an investor is KYC-verified. KYC module calls `initializePortfolio()` after successful blockchain identity registration.
- `MarketplaceModule`: For purchase, yield claim, and asset records. Calls `updateOnPurchase()` after recording each purchase.
- `LeverageModule`: For leverage position data. Calls `updateOnLeverageEvent()` after position state changes.
- `SolvencyModule`: For solvency position data. Calls `updateOnSolvencyEvent()` after position state changes.
- `BlockchainModule`: For network context and event processing. Event processor calls update methods when processing on-chain events (OrderFilled, OrderCancelled, etc.).
- `AssetsModule`: For asset metadata enrichment during portfolio building.
