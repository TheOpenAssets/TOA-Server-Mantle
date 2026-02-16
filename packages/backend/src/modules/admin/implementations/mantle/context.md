# Mantle Admin Domain Context

## Responsibilities
This folder contains the Mantle-specific implementation of the admin domain strategy. It orchestrates administrative operations like asset registration, token deployment, and marketplace listing specifically for EVM-based networks.

## Core Implementation

### `MantleAdminStrategy`
- Implements `IAdminDomainStrategy`.
- **Asset Registration**: Uses `BlockchainService` to register asset attestations.
- **Token Deployment**: Uses `BlockchainService` to deploy ERC-20 RWA tokens.
- **Marketplace Listing**: Uses `BlockchainService` to list tokens on the EVM PrimaryMarketplace.
- **Auction Flow**: `endAuctionOnChain` uses `NetworkRegistryService.endAuctionOnMarketplace` to set clearing prices and deactivate listings on-chain, then delegates database settlement to `AssetLifecycleService`.

## Dependencies
- `BlockchainService`: For legacy EVM contract interactions.
- `NetworkRegistryService`: For chain-agnostic on-chain operations (transitioning away from `BlockchainService`).
- `AssetLifecycleService`: For shared database state management.
- `NotificationService`: For alerting originators of status changes.
- `AssetModel`: For database persistence.
