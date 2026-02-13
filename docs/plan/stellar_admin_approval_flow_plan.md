# Stellar Admin Approval Flow — Implementation Plan

## Document Purpose

This plan covers the implementation of the admin-facing asset approval workflow for the Stellar network, using the module registry architecture already established. It also confirms why asset origination from the originator is network-agnostic and requires no Stellar-specific changes.

---

## Part 1 — Asset Origination Is Network-Agnostic (Confirmation)

When a real-world asset originator submits an asset for tokenization, the entire process up to admin approval is purely a database operation. The originator fills in their asset metadata — invoice number, face value, currency, token supply, pricing parameters — and uploads a document file. The system stores this in MongoDB with status `UPLOADED`, queues a hash computation job to produce the SHA-256 fingerprint of the document. None of these steps touch a blockchain.

When the admin subsequently reviews the asset and clicks "Approve," the `approveAsset()` method in the shared `AssetLifecycleService` runs. It generates a cryptographic attestation over the asset's content hash (currently using the same ECDSA signature format), stores the attestation payload and hash in MongoDB. The asset's status moves to `ATTESTED`. Again, no blockchain interaction.

This entire upstream half of the lifecycle — from originator upload through admin database approval and attestation generation — is completely network-agnostic. The `AssetLifecycleService` owns this logic and will serve both Mantle and Stellar deployments without any modification.

**The originator side of the module registry interface (`IAssetOriginationService`) is therefore largely a thin delegation layer to `AssetLifecycleService` that works identically for Mantle and Stellar.** The `StellarAssetOriginationService` only needs to implement the database-level operations (create, approve, list, get) and does not need any Stellar SDK calls for asset origination.

---

## Part 2 — Where Stellar Diverges: The Admin On-Chain Approval Flow

The divergence starts the moment the admin wants to register the asset on-chain after it has been attested. From this point forward, the Stellar and Mantle flows are fundamentally different in their mechanics, even though the conceptual steps appear similar:

1. Register the attestation on-chain
2. Deploy a token representing the asset
3. List the token on the primary marketplace

What makes these steps different is that Stellar has no concept of deploying smart contracts for individual assets (no `TokenFactory`), no ERC-20 allowance model (no `approveMarketplace()`), no event-driven token address discovery, and a multi-contract dependency chain that must be honored in the correct order. The following sections explain each admin operation in full detail.

---

## Part 3 — Stellar Admin Strategy: Step-by-Step Breakdown

### Operation 1: registerAsset

**Goal**: Anchor the asset's attestation hash permanently on the Stellar blockchain, making it provably immutable.

**What happens on Mantle**: The `MantleAdminStrategy` calls `BlockchainService.registerAsset()`, which invokes a single EVM transaction to the `AttestationRegistry` contract and returns a transaction hash. The asset status moves to `REGISTERED`.

**What needs to happen on Stellar**: The Stellar approach requires two sequential on-chain transactions instead of one, because the Stellar contract architecture has the `AttestationRegistry` and `AssetRegistry` as separate, composable contracts.

First, the strategy must call the `AttestationRegistry` Soroban contract's `register_asset_direct` function. This stores the attestation — a mapping of the asset's UUID string to its 32-byte attestation hash — on-chain. The admin keypair signs this transaction, and the contract verifies that the admin is a registered trusted issuer in the `TrustedIssuersRegistry` before accepting the call.

Second, immediately after the attestation is confirmed on-chain, the strategy must call the `AssetRegistry` Soroban contract's `register_asset` function. This is necessary because the `PrimaryMarket` contract — which is needed at the listing step — validates asset legitimacy by querying `AssetRegistry.is_asset_valid()`, which in turn queries `AttestationRegistry.is_asset_valid()`. If the asset is not registered in `AssetRegistry`, the listing step will fail. The `AssetRegistry.register_asset()` call takes the asset's code (the Stellar token ticker, explained in Part 4), the asset's UUID, the total supply, and the same attestation hash and blob ID. The contract internally verifies the attestation exists before registering.

**Transaction confirmation**: Unlike EVM where a transaction hash maps directly to a mined receipt, on Stellar the `sendTransaction()` RPC call returns a `PENDING` status immediately. The strategy must then poll the `getTransaction()` RPC method using the transaction hash until the status is either `SUCCESS` or `ERROR`. This polling must happen before proceeding to the second contract call, and again before updating MongoDB, to ensure consistency between the on-chain and off-chain state.

**MongoDB update**: After both transactions confirm, the strategy updates the asset document to set status `REGISTERED`, records both transaction hashes under the `registry` subdocument, sets `registry.registeredAt` to the current time, and sets `checkpoints.registered` to true. The asset's code (ticker) derived during this step should also be stored in the registry subdocument for use in subsequent steps.

**Notification**: The originator receives a notification informing them that their asset has been registered on-chain.

---

### Operation 2: deployToken

**Goal**: Create the on-chain representation of the asset's tokens, making them transferable to investors.

**What happens on Mantle**: The `MantleAdminStrategy` calls `BlockchainService.deployToken()`, which invokes the `TokenFactory` contract to deploy a new ERC-20 `RWAToken` contract. The factory emits an event containing the newly deployed token's Ethereum address. The event listener service picks up this event asynchronously, puts it in a BullMQ queue, and the event processor writes the token address to MongoDB.

**What needs to happen on Stellar**: Stellar has no `TokenFactory` contract and no ERC-20 contracts. Instead, the platform itself — through the platform (issuer) keypair — creates a native Stellar asset. Native Stellar assets are defined by two values: an asset code (the ticker) and an issuer address (the platform's public key). The combined `assetCode:issuerPublicKey` string is the token's canonical identifier in our system.

The creation process works as follows:

The strategy calls the `StellarBlockchainAdapter.deployToken()` method, which uses the platform keypair to submit a `setOptions` operation to the Stellar network. This operation sets three authorization flags on the issuer account for this asset: `AUTH_REQUIRED` (investors must have trustlines approved before receiving tokens), `AUTH_REVOCABLE` (the platform can revoke a trustline, enabling compliance-driven token freezes), and `AUTH_CLAWBACK` (the platform can claw back tokens in enforcement scenarios). These flags are the Stellar equivalent of the `ComplianceModule` transfer hook on Mantle — but instead of running on every transfer, compliance is enforced once when the trustline is approved, and can be enforced retroactively via revocation or clawback.

Once the flags are set, the native asset effectively exists on Stellar. No factory call, no event, no waiting for discovery. The token identifier is immediately known: it is the asset code concatenated with the platform's public key.

**AssetRegistry call in this step**: Since `register_asset` in `AssetRegistry` requires a `total_supply` value that is only relevant when the token is being created, and since calling it in the `registerAsset` step would require knowing the supply before deciding on token parameters, the strategy must call `AssetRegistry.register_asset()` during the `deployToken` phase, not the `registerAsset` phase. This call registers the assetCode, the asset's UUID, the total supply, and the attestation hashes in the AssetRegistry. The contract verifies the attestation is valid before accepting this registration.

Wait — this conflicts with what was described in Operation 1. The plan must choose: does `AssetRegistry.register_asset()` happen in `registerAsset()` (step 1) or `deployToken()` (step 2)?

**Resolution**: `AssetRegistry.register_asset()` must happen in `deployToken()`, for one pragmatic reason: the `assetCode` (the Stellar ticker) is derived from the UUID and is stable, but the `asset_issuer` address stored in `PrimaryMarket.list_asset()` is the platform keypair's public key. The AssetRegistry only stores the assetCode and asset_id mapping — it does not store the issuer. So the AssetRegistry registration can legitimately happen in either step. However, since the registry needs `total_supply` which is a token deployment concern, it belongs in `deployToken()`. The `registerAsset()` step therefore only calls `AttestationRegistry`.

**MongoDB update**: After confirming the `setOptions` transaction, the strategy updates the asset document to set status `TOKENIZED`, sets `token.address` to the `assetCode:issuerPublicKey` string, sets `token.deployedAt` to the current time, sets `token.supply` to the total supply from the DTO, and sets `checkpoints.tokenized` to true. The transaction hash is stored in `token.transactionHash`.

**No event listener needed**: This is a fundamental simplification over Mantle. The Mantle system requires an event listener to discover the deployed token address asynchronously. For Stellar, the token address is deterministic and known immediately — it's the asset code derived from the UUID plus the platform public key. The `TOKENIZED` status can be set synchronously in the strategy, without waiting for any event to propagate through BullMQ.

**Notification**: The originator is notified that their asset has been tokenized, including the token's identifier.

---

### Operation 3: listOnMarketplace

**Goal**: Make the asset available for investors to discover and purchase through the primary marketplace.

**What happens on Mantle**: The `MantleAdminStrategy` calls `BlockchainService.listOnMarketplace()`, which calls the `PrimaryMarket` EVM contract's listing function. The token must first have been approved (via `approveMarketplace()`) to allow the PrimaryMarket contract to spend ERC-20 tokens on behalf of the platform.

**What needs to happen on Stellar**: The strategy calls `StellarBlockchainAdapter.listOnMarketplace()`, which calls the `PrimaryMarket` Soroban contract's `list_asset` function. This function takes: the admin address, the asset code, the asset issuer address (platform's public key), the listing type (`Static` or `Auction` as a Soroban symbol), the price or reserve price, the minimum price (for auctions, as an option), the duration in seconds, and the total supply.

The Soroban contract internally verifies that the asset code is registered and valid in `AssetRegistry` before creating the listing. Since `AssetRegistry` in turn verifies the attestation in `AttestationRegistry`, the entire chain of trust is validated at listing time.

**Listing type mapping**: Stellar's PrimaryMarket contract uses `Static` and `Auction` as listing type symbols. Our database uses `STATIC` and `AUCTION`. The adapter handles this mapping when constructing the Soroban call.

**For auction listings**: The `min_price` field in the contract is an `Option<i64>`. For static listings, it should be `None`. For auction listings, it should be set to the minimum bid price from the asset's price range (`listing.priceRange.min`).

**MongoDB update**: After the listing transaction confirms, the strategy updates the asset to set status `LISTED`, sets `listing.type`, `listing.price`, `listing.active` to true, `listing.listedAt`, `listing.sold` to zero, and for auctions, `listing.phase` to `BIDDING`. The transaction hash is stored in the listing subdocument.

**Notification**: The originator is notified that their asset is now live on the marketplace.

---

### Operation 4: revokeAsset

**Goal**: Invalidate an asset's attestation on-chain, marking it as non-tradeable.

**What happens on Mantle**: A single call to the EVM AttestationRegistry sets the attestation's `isValid` flag to false.

**What happens on Stellar**: The strategy must call `AttestationRegistry.revoke_asset()` on the Soroban contract, which sets the attestation's `is_valid` field to false. If the asset has already been registered in `AssetRegistry`, the strategy should also call `AssetRegistry.revoke_asset()` to mark the asset code as invalid there too, preventing any future listing. If the asset has been listed in `PrimaryMarket`, the strategy should also call `PrimaryMarket.deactivate_listing()` to remove it from the active marketplace.

The strategy determines which contracts need revocation calls based on the asset's current status in MongoDB — if status is `REGISTERED`, only AttestationRegistry and AssetRegistry need revoking; if status is `LISTED` or beyond, PrimaryMarket also needs deactivation.

**MongoDB update**: Status moves to `REVOKED`.

---

### Operation 5: endAuctionOnChain

**Goal**: Finalize an auction with a clearing price, distributing results to bidders.

**What happens on Mantle**: The `MantleAdminStrategy` calls `BlockchainService.endAuction()` which calls the EVM PrimaryMarket contract's auction-end function, then delegates to `AssetLifecycleService.endAuction()` for the database-level settlement logic.

**What happens on Stellar**: The strategy calls the Soroban `PrimaryMarket.deactivate_listing()` function for the asset, which marks the listing as inactive. Then it delegates to `AssetLifecycleService.endAuction()` for all the bid settlement logic — calculating winning and losing bids, updating bid statuses, creating announcements, notifying bidders. This database-level settlement logic is completely shared with Mantle and lives in `AssetLifecycleService`.

**Clearing price handling**: The clearing price (in USDC-equivalent atomic units) is passed directly to `AssetLifecycleService.endAuction()` just as it would be on Mantle. The settlement calculation is identical.

---

### Operation 6: approveMarketplace (No-Op on Stellar)

**Goal on Mantle**: Give the `PrimaryMarket` EVM contract an ERC-20 approval to spend tokens held by the platform, so the contract can transfer tokens to buyers during purchases.

**Why this does not exist on Stellar**: Stellar uses a trustline-based authorization model, not an ERC-20 allowance model. Buyers request trustlines to the platform-issued asset, and the platform approves those trustlines (which is a KYC-gated operation handled in the KYC domain). The PrimaryMarket contract on Stellar never needs permission to move tokens — instead, the compliance model is enforced at the trustline level. There is no equivalent of `token.approve(spender, amount)` on Stellar.

The `StellarAdminStrategy.approveMarketplace()` implementation should return a successful response immediately with a message explaining that this operation is not applicable for Stellar and is a no-op, so that callers routing through the module registry receive a clean response without errors.

---

## Part 4 — The Asset Code: Stellar's Token Identifier Strategy

On Mantle, a token's identity is an EVM contract address (a 0x-prefixed 40-character hex string). On Stellar, a token's identity is an asset code plus an issuer public key. The system stores these interchangeably in the `token.address` database field, treating it as an opaque string.

**Derivation**: The asset code is derived deterministically from the asset's UUID by taking the first 8 hex characters (after removing hyphens), converting to uppercase, and prepending `RWA`. For example, UUID `123e4567-e89b-12d3-a456-426614174000` becomes asset code `RWA123E4567`. This is 11 characters, within Stellar's 12-character limit for alphanumeric assets.

**Stability**: Since the UUID is generated once at asset creation and never changes, the asset code derived from it is also stable. Any Stellar strategy method can derive the code locally from the UUID rather than reading it from a stored field.

**Full token identifier**: The value stored in `token.address` is `assetCode:platformPublicKey` (e.g., `RWA123E4567:GDQP2KPQGKIHYJGXNUIYOMHARUARCA7DJT5FO2FFOOKY3B2WSQHG4W37`). This format is opaque to the application layer — it is only parsed by Stellar-specific code.

**Explorer URL**: For the Stellar testnet, the explorer URL format for transactions is `https://stellar.expert/explorer/testnet/tx/${txHash}`. This should be used in response objects from the `StellarAdminStrategy` in place of the Mantle Sepolia explorer URL.

---

## Part 5 — What the StellarBlockchainAdapter Needs

The current `StellarBlockchainAdapter` already has stubs or partial implementations for `registerAsset`, `deployToken`, `listOnMarketplace`, `registerIdentity`, `isVerified`, and `approveTrustline`. However, to support the full admin approval flow, the following gaps must be addressed:

**Transaction confirmation polling**: Currently, the adapter calls `sendTransaction()` and returns the hash immediately without waiting for the transaction to be confirmed. On Stellar Soroban, this is not safe — the transaction could fail even after being accepted into the mempool. The adapter needs a helper method that, after calling `sendTransaction()`, polls `getTransaction(hash)` with a configurable timeout (e.g., up to 30 seconds with polling every 2 seconds) and throws a clear error if the transaction ultimately fails. Every adapter method that writes to the blockchain must use this confirmation helper before returning.

**AssetRegistry registration method**: The adapter needs a method to call `AssetRegistry.register_asset()` with the asset code, asset UUID, total supply, attestation hash, and blob ID. This is a separate Soroban contract call from `AttestationRegistry.register_asset_direct()` and is required before listing can succeed.

**Revocation methods**: The adapter's `revokeAsset()` stub needs to be completed. It must call `AttestationRegistry.revoke_asset()` (and optionally `AssetRegistry.revoke_asset()` and `PrimaryMarket.deactivate_listing()` depending on the asset's stage).

**Marketplace deactivation**: The adapter needs a method to call `PrimaryMarket.deactivate_listing()` for use in the `endAuctionOnChain` operation.

**Note on the listOnMarketplace call**: The current adapter stub passes `null` for `min_price`. This needs to be corrected to pass the actual minimum price for auction-type listings, derived from the asset data provided by the strategy.

---

## Part 6 — MongoDB Field Strategy for Stellar Assets

The MongoDB schema does not need to change. The existing field structure accommodates Stellar's values:

- `token.address` stores `assetCode:issuerPublicKey` — a valid opaque string
- `token.transactionHash` stores the Soroban transaction hash — a valid string
- `registry.transactionHash` stores the attestation registration hash — a valid string
- `token.supply` stores the integer total supply — compatible with Soroban's `i64` range for practical token supplies

**One addition worth tracking**: It may be helpful to store the `assetCode` explicitly in `registry.assetCode` so that downstream operations do not need to re-derive it from the UUID. This is a minor convenience addition to the schema or can simply be derived on-demand from the UUID, keeping the schema unchanged.

---

## Part 7 — Module Registry Integration

The `ModuleRegistryService` already resolves `StellarAdminStrategy` when `NETWORK_TYPE` is set to `stellar`. The `AssetOpsController` already routes all admin operations through the registry. No changes to the registry module, the controller, or the routing layer are needed. The integration is already in place — only the strategy implementations need to be filled in.

---

## Part 8 — What the Implementation Adds Up To

When this plan is implemented, the full admin asset approval lifecycle on Stellar will work as follows:

An originator submits an asset. The system processes it identically to Mantle — hashing, attestation generation, EigenDA anchoring — all network-agnostic. An admin reviews and approves the asset in the database (again, network-agnostic).

Then the admin initiates on-chain registration: the `StellarAdminStrategy.registerAsset()` calls the Stellar AttestationRegistry Soroban contract, waits for confirmation, and updates MongoDB.

The admin then triggers token deployment: `StellarAdminStrategy.deployToken()` calls the Stellar AssetRegistry contract to register the asset code with the total supply and attestation, then sets the AUTH flags on the platform account to establish the native Stellar asset. Token address is immediately known and stored in MongoDB. No event listener needed.

The admin then lists the asset: `StellarAdminStrategy.listOnMarketplace()` calls the Stellar PrimaryMarket contract, which validates the full chain (PrimaryMarket → AssetRegistry → AttestationRegistry) before creating the listing. MongoDB is updated to `LISTED` status.

The module registry routes all these calls transparently. The controller has no knowledge of which network it's operating on. The Mantle path continues to function identically to how it worked before.

---

## Part 9 — Files That Will Change

- `packages/backend/src/modules/admin/implementations/stellar/stellar-admin-strategy.service.ts` — fully implemented (currently all stubs)
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts` — transaction confirmation polling, AssetRegistry method, revocation methods, auction deactivation method
- `packages/backend/src/modules/assets/implementations/stellar/stellar-asset-origination.service.ts` — database-level methods delegating to AssetLifecycleService (currently all stubs, but straightforward since no Stellar SDK calls needed)

**Context.md files that must be updated per project policy:**
- `packages/backend/src/modules/admin/implementations/stellar/context.md` (or create if absent)
- `packages/backend/src/modules/blockchain/adapters/stellar/context.md`
- `packages/backend/src/modules/assets/implementations/stellar/context.md` (or create if absent)

---

## Summary

Asset origination is the same across both chains — confirmed. The admin approval flow on Stellar is a three-phase on-chain process (attestation registration, native asset creation with AssetRegistry registration, marketplace listing) that replaces Mantle's factory-deployed ERC-20 model. The existing module registry infrastructure handles the dispatch transparently. The primary implementation work is in `StellarAdminStrategy` and filling the gaps in `StellarBlockchainAdapter`, particularly transaction confirmation polling and the AssetRegistry interaction. No schema changes, no controller changes, no registry changes — pure strategy implementation.
