# Stellar Asset Origination Context

## Purpose
The `StellarAssetOriginationService` implements the `IAssetOriginationService` interface for the Stellar network. 

## Network Agnostic Logic
As per the architecture plan, the upstream half of the asset lifecycle (upload, metadata processing, hashing, and admin approval/attestation) is purely a database operation and is network-agnostic.

## Implementation Pattern
- This service acts as a thin delegation layer to the shared `AssetLifecycleService`.
- All database-level operations (create, approve, list, get) are handled by the shared service.
- On-chain operations (registration, deployment, listing) are deferred to the `AdminDomainStrategy` via the `ModuleRegistryService`.

## Methods
- `createAsset`: Delegates to `AssetLifecycleService.createAsset`.
- `approveAsset`: Delegates to `AssetLifecycleService.approveAsset`.
- `payoutOriginator`: Delegates to `AssetLifecycleService.payoutOriginator`.
- `getAsset`/`getAllAssets`: Delegates to shared query logic.
