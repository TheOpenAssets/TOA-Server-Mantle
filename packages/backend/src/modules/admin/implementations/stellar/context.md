# Stellar Admin Strategy Context

## Purpose
The `StellarAdminStrategy` implements the `IAdminDomainStrategy` interface for the Stellar network. It orchestrates the multi-step on-chain process required for asset registration, tokenization, and marketplace listing on Stellar.

## Key Flows

### 1. Asset Registration
- Calls the Soroban `AttestationRegistry` to anchor the asset's attestation hash.
- The attestation hash (keccak256 of the asset's merkle root, metadata, and admin signature) is the sole data integrity anchor — EigenDA has been removed from the pipeline.
- Assets transition directly from `ATTESTED` to `REGISTERED` status; the `DA_ANCHORED` intermediate status no longer exists.
- The `blobId` parameter passed to contracts is set to the attestation hash itself (content-addressed reference). // To be deprecated soon. (blob id will be deprecated)
- Uses transaction confirmation polling to ensure on-chain immutability before updating MongoDB.

### 2. Token Deployment (Native Asset Creation)
- Two-step process:
  1. Registers the asset code, UUID, and total supply in the Soroban `AssetRegistry`.
  2. Sets `AUTH_REQUIRED`, `AUTH_REVOCABLE`, and `AUTH_CLAWBACK` flags on the platform (issuer) account.
- Token identifier is deterministic: `assetCode:platformPublicKey`.

### 3. Marketplace Listing
- Calls the Soroban `PrimaryMarket` contract.
- Handles both `Static` and `Auction` listing types.
- Passes `minPrice` for auctions.

### 4. Auction Finalization
- Deactivates the listing on-chain via `PrimaryMarket.deactivate_listing`.
- Delegates settlement logic to the shared `AssetLifecycleService`.

## Dependencies
- `NetworkRegistryService`: Routes calls to the `StellarBlockchainAdapter`.
- `AssetLifecycleService`: Shared database-level asset management logic.
- `NotificationService`: Sends updates to originators and admins.

## Implementation Details
- Uses deterministic asset codes derived from UUIDs (e.g., `RWA123E4567`).
- Transaction hashes are recorded for every step to maintain an audit trail.
- Explorer links point to `stellar.expert`.
