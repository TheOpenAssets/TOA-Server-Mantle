# Credit Coin Assets Implementation

## Responsibilities
- Implements the `IAssetOriginationService` interface for Credit Coin.
- Manages the asset lifecycle for Credit Coin assets.

## Implementation Details
- Asset origination on Credit Coin is currently a database-only operation.
- Most methods delegate directly to the shared `AssetLifecycleService`.
- On-chain operations (registering assets, deploying tokens, listing on marketplace) are handled by the `CreditCoinAdminStrategy`.

## Dependencies
- `AssetLifecycleService`: Shared business logic for asset lifecycle.
- `AssetModel`: MongoDB access for asset documents.
- `BlockchainService`: Shared blockchain interactions (for legacy support if needed).
- `NotificationService`: Creating user notifications.
