# User Portfolio Module

## Responsibilities
- Maintain a persistent, chain-agnostic record of user holdings across the platform.
- Provide a high-performance dashboard summary with cached aggregate totals.
- Enrich persistent holdings with live data (yield, asset metadata, etc.) for runtime consumption.
- Maintain a recent activity tail for fast activity feed rendering.
- Provide a rebuild mechanism to ensure data integrity.

## Public Interfaces

### UserPortfolioService
- `getPortfolio(walletAddress: string, network: string)`: Builds the full runtime portfolio for a user.
- `updateOnPurchase(purchase: any)`: Atomic update triggered by a new purchase.
- `updateOnYieldClaim(claim: any)`: Atomic update triggered by a yield claim.
- `updateOnLeverageEvent(event: any)`: Atomic update triggered by leverage position changes.
- `updateOnSolvencyEvent(event: any)`: Atomic update triggered by solvency position changes.
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
- `MarketplaceModule`: For purchase, yield claim, and asset records.
- `LeverageModule`: For leverage position data.
- `SolvencyModule`: For solvency position data.
- `BlockchainModule`: For network context and event processing.
- `AssetsModule`: For asset metadata.
