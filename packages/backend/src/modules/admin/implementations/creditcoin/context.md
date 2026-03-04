# Credit Coin Admin Implementation

## Responsibilities
- Implements the `IAdminDomainStrategy` interface for Credit Coin.
- Handles on-chain admin operations for Credit Coin:
  - Registering assets on `AttestationRegistry`.
  - Deploying tokens via `TokenFactory`.
  - Listing assets on `PrimaryMarket`.
  - Revoking assets.
  - Ending auctions.
  - Approving marketplace for token spending.
  - Supplying yield settlements.

## Implementation Details
- Credit Coin is EVM-compatible and uses the same core contract architecture as Mantle.
- All on-chain calls are routed through the `BlockchainService`, which uses the `CreditCoinChainManager`'s adapter when the network context is set to Credit Coin.
- Database updates mirror the Mantle implementation to maintain state consistency across networks.

## Dependencies
- `AssetModel`, `SettlementModel`: MongoDB access for relevant documents.
- `BlockchainService`: Interface for on-chain interactions.
- `NetworkRegistryService`: Higher-level blockchain operations (fee transfers, yield deposits).
- `AssetLifecycleService`: Shared business logic for asset-related tasks.
- `NotificationService`: Creating user and originator notifications.
