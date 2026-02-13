# Chain-Agnostic Backend — Phase 1: Asset Issuance Through Marketplace Registration

**Author:** Architecture Planning
**Date:** February 13, 2026
**Scope:** Asset lifecycle from originator upload through marketplace listing — the first concrete backend implementation of the network-agnostic architecture. This document is the ground truth for all engineering decisions in this phase.

---

## Preamble: Why This Is The Hardest Step

Every subsequent phase of the multi-network rollout gets easier because the scaffolding will exist. This phase installs that scaffolding from scratch while simultaneously keeping the existing Mantle deployment alive and unbroken. This dual mandate — build new architecture AND don't break anything — is the source of complexity here.

The three pillars that must be established correctly now, because every downstream module will depend on them:

1. **The Network Config System** — The single source of truth for "what network are we on and what is available."
2. **The Module Registry** — The globally injectable brain that mediates all cross-service operations and owns availability semantics.
3. **The Adapter Abstraction** — The interface layer that lets the rest of the application be permanently ignorant of which network it's running against.

Get these three things right, and adding Stellar support for yield, solvency, or secondary market in later phases becomes a matter of implementing new adapter methods and updating a config map. Get them wrong, and every subsequent phase inherits the debt.

---

## Part 1: The Network Configuration System

### 1.1 The Master Switch

A single environment variable `NETWORK_TYPE` with values `mantle` or `stellar` (and future network identifiers) controls everything downstream. It defaults to `mantle` to ensure zero disruption to the current deployment.

This variable is the first thing read at application bootstrap, before any module is loaded. All conditional logic — which modules to import, which adapters to register, which features are available — derives from this one value.

### 1.2 The network.config.ts File

A new configuration file that is the single source of truth for runtime network identity. It lives alongside the existing `blockchain.config.ts` in the config folder. It reads `NETWORK_TYPE` and produces a structured config object containing:

**Network Identity:** The type string, a human-readable display name for logs and error messages, and a boolean indicating whether this is a testnet deployment (affects certain safety checks).

**Feature Availability Map:** A flat map of string keys to booleans. Each key names a backend service domain. The value tells the application whether that domain is active and safe to use on the current network. This map is what the Module Registry reads when deciding what to load and what to skip.

For the Mantle network, every feature flag is true — this is the full feature set, and the existing behavior must be preserved without any deviation. For the Stellar network in this phase, only the core asset issuance flow features are true. Specifically: the attestation and registration pipeline, token deployment, identity registration (KYC on-chain), and primary marketplace listing are active. Everything that depends on mETH, FluxionDEX, the leverage system, the faucet, or the solvency vault is false. Secondary market starts as false on Stellar for this phase — it will be enabled when the Stellar DEX integration is designed.

**Network Connection Parameters:** For Mantle, these are the existing blockchain config values (RPC URL, WSS URL, chain ID, admin key, platform key, contract addresses). For Stellar, new fields are introduced: the Soroban RPC endpoint, the Horizon API base URL, the network passphrase (which distinguishes testnet from mainnet in the Stellar ecosystem), the admin secret key (a Stellar Ed25519 keypair secret), the platform secret key, and the Soroban contract IDs for each deployed contract (AttestationRegistry, IdentityRegistry, AssetCoordinator, PrimaryMarket, YieldVault, etc.).

The existing `blockchain.config.ts` is not deleted — it remains as the Mantle-specific connection config. The `network.config.ts` wraps it, pulling in blockchain config for Mantle deployments and Stellar-specific fields for Stellar deployments.

### 1.3 Environment Variable Additions

The `.env.example` file gains two sections. The first section is the existing Mantle variables, now clearly labeled as "Mantle/EVM Configuration." The second section, clearly labeled "Stellar Configuration (only needed when NETWORK_TYPE=stellar)," contains all the Stellar-specific variables. No existing variable names change. Existing deployments add only `NETWORK_TYPE=mantle` and continue working.

---

## Part 2: The Module Registry — The Central Brain

This is the most architecturally important service in the entire network-agnostic system. It deserves the most careful design.

### 2.1 What the Module Registry Is

A globally scoped, injectable NestJS service that is the **only place** in the entire codebase where "is this feature available on the current network?" is decided. It is instantiated once at startup, reads the network config, and is then available for injection into any module throughout the application's lifetime.

It lives in the blockchain module's services folder because the blockchain module is already global. This ensures it is available everywhere without any additional module imports.

### 2.2 What the Module Registry Is Not

It is not a simple config reader. Any service can read the config directly. The registry's unique value is that it holds **typed domain operations** — named methods representing cross-service business actions — and resolves the correct service to delegate to, checks availability, and returns standardized results. The caller never needs to know whether the operation is available or how to find the service that handles it.

It is not a service locator anti-pattern. The registry does not expose a generic "get me service X" method. Every method on the registry is a named domain operation with a clear business meaning. This preserves the expressiveness of the domain model.

### 2.3 The Availability API

Every module that might be conditionally unavailable has a corresponding `isAvailable(domainName)` method on the registry. But this is a low-level API meant for the registry's internal use and for places where a feature check is truly all that's needed. The preferred API is the typed domain method.

### 2.4 Typed Domain Methods for the Asset Issuance Flow

For this phase, the registry exposes methods relevant to the asset issuance and approval pipeline:

**registerIdentityOnChain(walletAddress):** Delegates to the identity registration path. Used by the KYC module after approving a user. Returns a typed result with the transaction identifier and a `completed` flag. On Stellar, calls the IdentityRegistry Soroban contract via the blockchain adapter.

**deployAssetToken(assetId, totalSupply, attestationHash, blobId):** Delegates to the token deployment path. Used by the admin module when triggering token deployment after asset approval. Returns a typed result with the on-chain identifier for the deployed token and a `completed` flag. On Stellar, this method understands that "deploying a token" means coordinating native asset creation plus an AssetCoordinator contract call — the adapter handles the semantics; the registry just delegates.

**registerAssetOnChain(dto):** Delegates to asset attestation registration. Returns transaction identifier. Used by the admin/compliance pipeline.

**listAssetOnMarketplace(tokenIdentifier, listingType, price, minInvestment, duration, totalSupply):** Delegates to marketplace listing. Returns transaction identifier. Used by the admin module at the final step of the issuance pipeline.

**approveTrustlineForUser(userAddress, assetIdentifier):** Stellar-specific. On Mantle, this operation does not exist (the EVM compliance module handles transfer gating). The registry returns `{ skipped: true, reason: 'NOT_APPLICABLE_ON_NETWORK' }`. On Stellar, this delegates to the Stellar blockchain adapter which issues the SetTrustlineFlags operation on the Stellar network. This is called after KYC approval so the user can receive the asset.

### 2.5 The Result Type Contract

Every method the registry exposes returns a typed result object. All result objects share a common shape: a `completed` boolean indicating whether the operation actually ran, a `skipped` boolean indicating whether it was deliberately bypassed (network doesn't support it), an optional `txId` string for any on-chain transaction that was submitted, and an optional `data` object carrying operation-specific return values. Methods that return data — like `deployAssetToken` which must return the token identifier — put that in the `data` field. The caller destructures what it needs and checks `completed` before using the data.

### 2.6 Service Resolution via ModuleRef

The registry uses NestJS's `ModuleRef` to lazily resolve service instances the first time a method is called. This completely eliminates circular dependency issues. The module for a service must have been loaded at startup (via conditional module loading) for ModuleRef to resolve it. If the module wasn't loaded — because its feature flag was false — ModuleRef will fail to resolve it, and the registry catches that and returns `{ completed: false, skipped: true }` automatically.

This means the registry's "is available" logic is enforced at two levels: the config flag controls whether the module is loaded at all, and the ModuleRef resolution at runtime provides a safety net for any inconsistency.

### 2.7 What the Registry Replaces

All the `forwardRef()` chains that currently exist in the blockchain module's imports — needed because YieldModule, SolvencyModule, LeverageModule, and SecondaryMarketModule all depend on blockchain services while blockchain module also imports from them — are eliminated. Modules never need to import each other. They call the registry. The registry resolves the target. The circular dependency web dissolves.

---

## Part 3: The Adapter Abstraction Layer

### 3.1 The Four Adapter Interfaces

Four TypeScript interfaces define the complete contract that any network adapter must satisfy. These live in a dedicated `adapters` subfolder inside the blockchain module. The interfaces themselves contain no implementation, no network assumptions, and no library imports.

**The Blockchain Adapter Interface:** The primary operational interface. Defines methods for every on-chain write operation the backend performs. Critically, all parameters and return types are expressed in network-agnostic terms. Transaction identifiers are strings (not viem's `Hash` type). Contract/token addresses are strings (not EVM's `Address` type). The method names map directly to business concepts: `registerAsset`, `registerIdentity`, `deployToken`, `listOnMarketplace`, `depositYield`, `distributeYield`, `endAuction`, `revokeAsset`, `burnUnsoldTokens`. For read operations, methods like `isIdentityVerified`, `getTokenBalance`, `getTotalSupply`.

The most important design decision about this interface: the return types must carry enough information for any network while remaining independent of any network. A `deployToken` operation returns a `DeployedTokenResult` that contains a `primaryIdentifier` (the main way to refer to the deployed token — an EVM contract address on Mantle, a `assetCode:issuerPublicKey` string on Stellar), an optional `auxiliaryIdentifier` (for EVM, this is the compliance module address; for Stellar, nothing), and a `txId`. The caller stores whatever the `primaryIdentifier` is — the token's canonical database reference — and the adapter interface guarantees this is always populated.

**The Wallet Adapter Interface:** Abstracts wallet and key management. Provides `getAdminAddress()`, `getPlatformAddress()`, and the ability to sign operations. The concrete signing mechanism (signing a viem transaction for EVM, signing a Stellar transaction envelope for Stellar) is entirely inside the adapter's implementation — callers never see it.

**The Event Adapter Interface:** Abstracts on-chain event listening. Defines `startListening()`, `stopListening()`, and a unified event emitter that fires standardized events with the same payload shapes that the existing `EventProcessor` already handles. The EVM adapter polls blocks. The Stellar adapter uses Horizon streaming and Soroban getEvents with cursor tracking. The EventProcessor never changes — it receives the same logical events from either adapter.

**The Contract Adapter Interface:** Abstracts contract-level operations. Provides `hasContract(name)`, `getContractAddress(name)`, and a way to load contract interaction specs (ABIs for EVM, Soroban XDR specs for Stellar). The contract name is always the logical domain name (`attestationRegistry`, `tokenFactory`, etc.), not a network-specific term.

### 3.2 Injection Tokens

Four string constants — `BLOCKCHAIN_ADAPTER`, `WALLET_ADAPTER`, `EVENT_ADAPTER`, `CONTRACT_ADAPTER` — are defined in a `blockchain.constants.ts` file in the blockchain module. These tokens are what every consumer injects. Never the concrete class name.

### 3.3 The EVM (Mantle) Adapter Implementations

The existing four blockchain services — `BlockchainService`, `WalletService`, `EventListenerService`, `ContractLoaderService` — are refactored into adapter implementations living in `adapters/evm/`. Each implements its corresponding interface. The migration is a lift-and-shift: all the existing viem-based logic moves into the adapter class, which now implements the interface. The return types are wrapped in the new standardized shapes.

One critical change inside the EVM adapters: the chain definition is no longer hardcoded. Instead of importing `mantleSepolia` from the config file, the EVM adapter constructs the chain definition dynamically from the network config values (chain ID, RPC URL, native currency, explorer URL). The `mantle-chain.ts` file becomes a reference file with the default values rather than a compile-time constant imported across multiple files. This immediately reduces the hardcoded coupling from five import sites to zero.

The original service class files remain temporarily as thin pass-through wrappers that delegate to the EVM adapter — this preserves compatibility for any consumers that were injecting the concrete class name before the migration is complete. Once all consumers are updated to inject via the token constants, the wrapper files are deleted.

### 3.4 The Stellar Adapter Implementations

Four new files in `adapters/stellar/` implement the same interfaces using the Stellar SDK instead of viem. These are new code, not rewrites.

**The Stellar Blockchain Adapter** handles the core operations for this phase:

For `registerAsset`: The adapter builds a Stellar transaction that invokes the AttestationRegistry Soroban contract's register function. The attestor's Ed25519 signature — computed by the truth engine using the Stellar admin keypair — is passed alongside. The contract verifies the Ed25519 signature natively (Soroban supports this without additional libraries). The transaction is submitted and the transaction hash (a base64-encoded string on Stellar, not a hex hash) is returned as the `txId`.

For `deployToken`: This is the most complex operation and is fundamentally different from EVM. The adapter performs a sequential, atomic set of Stellar operations bundled into a single transaction where possible. First, it determines the asset code — a maximum 12-character string prefixed with "RWA-" followed by a truncated asset ID. Second, it constructs a Stellar transaction on the platform account that sets the account options to enable AUTH_REQUIRED, AUTH_REVOCABLE, and AUTH_CLAWBACK flags on the issuer account (the platform account acts as the issuing account for all RWA assets). Third, it calls the AssetCoordinator Soroban contract to record the asset metadata (off-chain asset ID, total supply, attestation hash). The return value is a `DeployedTokenResult` where `primaryIdentifier` is the canonical asset string in Stellar format (`assetCode:issuerPublicKey`). This string is what the database stores as the token's network address.

For `listOnMarketplace`: The adapter calls the PrimaryMarket Soroban contract with the asset code, listing type (static or auction), price in the Stellar-native amount format (7 decimal places, in stroops), minimum investment amount, duration, and total supply. Returns the Stellar transaction hash.

For `registerIdentity`: The adapter calls the IdentityRegistry Soroban contract. The wallet address on Stellar is a Stellar public key (G... format), not a 0x hex address. The adapter validates the format before calling.

For `isIdentityVerified`: A read-only Soroban simulation call to IdentityRegistry's `is_verified` function. Returns a boolean.

**The Stellar Wallet Adapter** manages Stellar keypairs. The admin and platform accounts are identified by Ed25519 keypairs loaded from environment variables (the `STELLAR_ADMIN_SECRET` and `STELLAR_PLATFORM_SECRET` values). The adapter provides the public keys as the "addresses" and handles transaction signing via the keypair's sign method. Unlike EVM wallets which use `createWalletClient`, Stellar keypairs directly sign transaction XDR envelopes.

**The Stellar Event Adapter** polls Soroban events using the `getEvents` RPC method on a configurable interval (default 5 seconds, matching Stellar's ~5-second ledger close time). It maintains a cursor — a ledger sequence number — so it never re-processes events after restart (the cursor is persisted in Redis). When Soroban events are received, the adapter translates them from Soroban event format (topic symbols + XDR-encoded values) into the same internal event payload shapes that the `EventProcessor` already handles. The mapping is one-to-one: `AssetRegistered` Soroban event → internal `AssetRegisteredEvent`, `TokenDeployed` Soroban event → internal `TokenDeployedEvent`, etc.

**The Stellar Contract Adapter** loads Soroban contract IDs from the network config (environment variables like `STELLAR_ATTESTATION_REGISTRY_CONTRACT_ID`). These are 32-byte hex strings representing the deployed Soroban contract addresses. Contract invocation specs (the Stellar equivalent of ABIs) are loaded from JSON files in the `stellar-contracts` deployment artifacts folder (which the Stellar contracts package will produce during deployment).

---

## Part 4: Dynamic BlockchainModule

### 4.1 Converting to forRoot() Pattern

The `BlockchainModule` is converted from a static `@Module` decorated class to a dynamic module with a `forRoot()` static method. This method receives the loaded network config and decides at startup time which adapter implementations to register as providers for the four injection tokens.

When `NETWORK_TYPE=mantle`, the four EVM adapters are registered under the four injection tokens. When `NETWORK_TYPE=stellar`, the four Stellar adapters are registered. The rest of the module — the event processor, the MongoDB schemas, the BullMQ queue — remains unconditional. Only the adapter provider registrations are conditional.

The `@Global()` decorator stays. The four adapter instances are globally available for injection anywhere via the token constants, exactly as the concrete service classes were before.

### 4.2 Startup Sequence

When NestJS bootstraps, the `AppModule` loads the network config first. This config is passed into `BlockchainModule.forRoot(networkConfig)` which registers the right adapters. The `NetworkRegistryService` is also registered in the blockchain module as a global provider. By the time any domain module initializes, the adapters are already wired and the registry is ready.

### 4.3 The Network Registry's Place in the Module

The `NetworkRegistryService` is a provider in the blockchain module — not a separate module. This keeps the architecture clean: the blockchain module is the global infrastructure module, and the registry is part of that infrastructure. It is exported alongside the adapter tokens, making it injectable everywhere.

---

## Part 5: Conditional AppModule

### 5.1 Conditional Import Strategy

The `AppModule` reads the network config at construction time and builds the import list dynamically. For this phase, the conditional imports relevant to asset issuance are:

**Always loaded (core, both networks):** RedisModule, AuthModule, KycModule, `BlockchainModule.forRoot(config)`, AssetModule, AdminModule, NotificationsModule, ComplianceEngineModule, TypeformModule, AnnouncementsModule, ChangelogModule.

**Loaded only when `services.marketplace === true`:** MarketplaceModule. On Stellar, primary marketplace is active from day one (the PrimaryMarket Soroban contract exists), so this is true.

**Loaded only when `services.leverage === true`:** LeverageModule. False on Stellar initially.

**Loaded only when `services.faucet === true`:** FaucetModule. False on Stellar (Stellar testnet has native XLM faucets; no equivalent custom faucet contract exists).

**Loaded only when `services.secondaryMarket === true`:** SecondaryMarketModule. Initially false on Stellar while the SDEX integration design is pending.

**Loaded only when `services.solvency === true`:** SolvencyModule. False on Stellar for this phase.

**Loaded only when `services.partners === true`:** PartnersModule. False on Stellar for this phase.

### 5.2 What "Not Loaded" Means for API Consumers

If a module is not imported, NestJS never registers its controller routes. HTTP calls to those routes return 404. This is intentional and clean. The API consumer calling a Stellar deployment of this platform and hitting `POST /leverage/positions` receives a 404 — not a cryptic error, not a 500. The 404 communicates "this endpoint does not exist in this deployment configuration," which is accurate.

For the asset issuance and approval flow specifically, every necessary route is on a module that is always loaded. There are no gaps.

---

## Part 6: Authentication Network Awareness

### 6.1 The Problem

Auth is currently EIP-191. The user signs a nonce with their Ethereum wallet. The backend recovers the signing address from the signature. This is pure EVM cryptography — secp256k1 ECDSA with the Ethereum personal sign prefix.

On Stellar, users have Ed25519 keypairs. They sign the same nonce using the Stellar SDK's built-in signing. The verification on the backend uses Ed25519 signature verification, not ECDSA recovery.

### 6.2 The Solution

An `AuthVerificationAdapter` interface with two implementations. The interface defines a single method: `verifySignatureAndExtractAddress(nonce, signature, claimedAddress)` which returns the verified wallet address (or throws if the signature is invalid).

The EVM implementation uses the existing `ecrecover`-based approach via the Stellar SDK or viem's `recoverAddress`. The Stellar implementation uses Ed25519 verification — the `claimedAddress` is the Stellar public key (G... format), and the method verifies that the provided signature on the provided nonce was produced by the private key corresponding to that public key. If verification succeeds, it returns the Stellar public key as the canonical wallet address.

The auth module injects this adapter via the blockchain module's globally exported `AUTH_VERIFICATION_ADAPTER` injection token. The nonce-challenge flow, JWT issuance, session storage, and role assignment are identical on both networks.

---

## Part 7: The Asset Issuance Flow — End to End, Network-Aware

This section traces the complete flow from originator upload to marketplace listing, showing exactly where each step is network-aware and where it is identical.

### Step 1: Originator Creates Asset

The originator calls `POST /assets` with the asset metadata. The controller delegates to `AssetLifecycleService`. A UUID is generated, the asset document is created in MongoDB with status `DRAFT`. Files are stored in GridFS. This step is entirely off-chain and entirely identical on both networks.

### Step 2: Truth Engine Processing

The asset processor (BullMQ consumer on the `asset-processing` queue) runs the asset through the truth engine: SHA-256 hashing, Merkle tree generation, Merkle proof computation. The Merkle proofs and hashes are pure cryptography with no network dependency. This step is identical on both networks. Asset status advances to `PENDING_APPROVAL` after hashing, to `MERKLE_COMPLETE` after the Merkle tree.

### Step 3: Admin Approval — Off-Chain

Admin calls the approval endpoint. The `AssetLifecycleService` validates that the asset is in the correct state and transitions it to `APPROVED`. This is a database operation. Network-agnostic.

### Step 4: Admin Triggers Attestation and On-Chain Registration

Admin calls the registration endpoint (currently something like `POST /admin/assets/:id/register`). The `AdminService` fetches the asset, constructs the `RegisterAssetDto`, and calls `networkRegistry.registerAssetOnChain(dto)`.

The registry delegates to the blockchain adapter. On Mantle, the EVM adapter submits the AttestationRegistry transaction via viem, exactly as today. On Stellar, the Stellar adapter constructs and submits a Soroban invocation transaction.

The event listener (EVM: block polling; Stellar: Soroban event cursor) detects the `AssetRegistered` event and pushes it to the `event-processing` BullMQ queue. The `EventProcessor` consumes it, updates the asset document's status to `REGISTERED`, and stores the `txId` (on Mantle, a hex hash; on Stellar, a base64 transaction hash). The asset's `networkTxId` field is a plain string in the database — it holds whatever format the network uses.

### Step 5: Admin Triggers Token Deployment

Admin calls the deploy token endpoint. The `AdminService` calls `networkRegistry.deployAssetToken(assetId, totalSupply, attestationHash, blobId)`.

On Mantle: the EVM adapter calls the TokenFactory. Two contracts are deployed. The event carries the token contract address and compliance module address. Asset document updated with `tokenAddress` (the EVM contract address) and `complianceAddress`.

On Stellar: the Stellar adapter creates the native Stellar asset (asset code + platform issuer), sets authorization flags on the issuer account, and calls the AssetCoordinator Soroban contract. The event from Soroban (AssetCoordinatorContractCalled or a custom AssetTokenized event) is translated by the event adapter to the internal `TokenDeployedEvent`. The asset document is updated with `tokenAddress` set to the canonical Stellar asset string (`RWA-XXXXX:G...publickey...`). The `complianceAddress` field is left null for Stellar (compliance is trustline-based, not a contract address).

This asymmetry — the `tokenAddress` field having different formats on different networks — is handled by treating it as an opaque string in the database. The application never parses the `tokenAddress` format; it always passes it through to the blockchain adapter which understands its own format.

### Step 6: KYC User — On-Chain Identity Registration

When an investor completes KYC and is approved, the KYC service calls `networkRegistry.registerIdentityOnChain(walletAddress)`.

On Mantle: the EVM adapter calls IdentityRegistry. The wallet address is a 0x hex string.

On Stellar: the Stellar adapter calls the IdentityRegistry Soroban contract. The wallet address is a Stellar G... public key.

Additionally on Stellar, the adapter calls `approveTrustline` as a follow-on step so the newly KYC'd user can actually hold the asset tokens they want to purchase. This step does not exist on Mantle (the ComplianceModule handles it automatically at transfer time). The KYC module calls `networkRegistry.approveTrustlineForUser(walletAddress, assetIdentifier)` — the registry checks `services.trustlineManagement` (true on Stellar, false on Mantle) and either delegates or skips.

### Step 7: Admin Lists Asset on Primary Marketplace

Admin calls the listing endpoint. The `AdminService` calls `networkRegistry.listAssetOnMarketplace(...)`.

On Mantle: the EVM adapter calls the PrimaryMarket contract with the token contract address, listing type, price (in wei), and duration.

On Stellar: the Stellar adapter calls the PrimaryMarket Soroban contract with the asset code, listing type, price (in stroops), and duration. The Soroban PrimaryMarket contract handles both static and auction listing types identically in terms of the contract function called — the `listingType` parameter controls behavior inside the contract.

The `AssetListedOnMarketplace` event is emitted. The event adapter translates it. The `EventProcessor` updates the asset's status to `LISTED`. The asset document stores the listing details. The originator and admin receive notifications.

**At this point, the asset is available for investor purchases on the primary marketplace.** The Phase 1 scope is complete.

---

## Part 8: What "Service Not Started" Looks Like

For any module that is excluded from the Stellar AppModule import list (LeverageModule, SolvencyModule, FaucetModule, SecondaryMarketModule, PartnersModule), the API routes simply do not exist. An investor on a Stellar deployment calling `POST /leverage/positions` receives a 404 HTTP response from NestJS's default 404 handler.

This is the deliberate, clean signal that the service isn't available on this network. No special error code, no custom middleware. The module not being loaded means the route doesn't exist.

For cross-service calls that flow through the Module Registry — calls that one domain module makes to another domain module's service — the registry returns `{ completed: false, skipped: true, reason: 'FEATURE_UNAVAILABLE_ON_NETWORK' }`. The calling service checks `result.completed` before using the result data and moves on without error.

---

## Part 9: The Event Processing Architecture — Unified by Design

The `EventProcessor` (the BullMQ consumer in `event.processor.ts`) processes the same 19 logical event types regardless of what network sent them. The event adapter translates network-specific events into these standard internal event payloads before they ever reach the queue. This is the key design that makes the EventProcessor truly network-agnostic without any modification.

The Stellar event adapter maps Soroban events by their topic symbols. Each Soroban contract emits events with a first-topic symbol identifying the event type (e.g., `"AssetRegistered"`, `"TokenDeployed"`, `"IdentityRegistered"`). The adapter maps these symbol strings to the internal event type enum. The event data (XDR-encoded values) is decoded and mapped to the same fields that the EVM adapter populates from decoded EVM log data.

This means the EventProcessor is a stable, unchanged service. It processes `AssetRegisteredEvent` whether the source was an EVM log or a Soroban event. It updates the same MongoDB documents, fires the same notifications, and maintains the same state machine logic.

---

## Part 10: The context.md Requirement

Every folder touched by this implementation must have a `context.md` file created or updated before any code in that folder is modified. This is a hard requirement from the project guidelines.

The following context.md files must be written as part of this phase:

**`modules/blockchain/context.md`** — Describes the blockchain module as the global network adapter infrastructure layer. Documents the four adapter interfaces, the injection tokens, the network registry, and how adapters are selected. Documents the event processing pipeline integration.

**`modules/blockchain/adapters/context.md`** — Describes the adapter directory structure, the EVM and Stellar subdirectories, and the interface contracts that all adapters must satisfy.

**`modules/blockchain/adapters/evm/context.md`** — Documents the EVM adapter implementations, their dependency on viem, how the chain definition is loaded dynamically from network config, and the backward compatibility guarantee.

**`modules/blockchain/adapters/stellar/context.md`** — Documents the Stellar adapter implementations, their dependency on the Stellar SDK, how Soroban contract invocations work, how native asset operations work (the non-contract parts of token deployment), and the cursor-based event polling mechanism.

**`config/context.md`** — Documents the configuration files, especially the new `network.config.ts` and its relationship to `blockchain.config.ts`.

**`modules/assets/context.md`** — Documents the asset lifecycle service and its responsibilities. Notes that the truth engine steps (hashing, Merkle) are network-agnostic. Notes that on-chain registration steps delegate through the Module Registry.

**`modules/admin/context.md`** — Documents the admin service's role in triggering on-chain operations (registration, token deployment, marketplace listing) via the Module Registry. Notes which admin operations are network-specific.

---

## Part 11: Implementation Sequence

The phases below represent the order of work. Each phase leaves the system in a deployable, working state for Mantle. Stellar functionality is additive.

### Phase A — Network Config and Registry (Foundation, No Breaking Changes)

Install the `NETWORK_TYPE` env var infrastructure. Create `network.config.ts`. Register it as a NestJS config factory in the AppModule. Create the `NetworkRegistryService` with only the availability map and `isAvailable()` at this stage — typed domain methods come later. Register it globally. Confirm that running `NETWORK_TYPE=mantle` produces an identical deployment to the current one. This phase touches only the config folder and the blockchain module's provider list.

### Phase B — Adapter Interfaces and Injection Tokens

Create the `adapters/` folder structure with all four interface files. Create `blockchain.constants.ts` with the four injection token constants. Create the `adapters/context.md` files. No implementations yet. No existing code changes. This is entirely additive.

### Phase C — EVM Adapter Implementations

Move the four blockchain service implementations into `adapters/evm/`. Each adapter implements its corresponding interface. Return types are wrapped in the new standardized shapes. The chain definition becomes dynamically constructed from network config instead of hardcoded. The original service class files become thin delegates that call through to the EVM adapter instances. All consumers continue working unchanged because the original class names still exist and are still injectable. Verify Mantle works identically.

### Phase D — Dynamic BlockchainModule and Consumer Migration

Convert `BlockchainModule` to `forRoot()` dynamic pattern. Register EVM adapters under injection tokens when `NETWORK_TYPE=mantle`. Update all consumers (the five service files that currently import `mantleSepolia` and use viem directly) to inject via `@Inject(BLOCKCHAIN_ADAPTER)` etc. with the interface type. Remove the thin wrapper service files once all consumers use the token. Verify Mantle works identically. This is the largest refactor in scope — all of the existing viem coupling is eliminated in this phase.

### Phase E — Conditional AppModule

Update `AppModule` to read network config and conditionally import modules based on feature flags. For `NETWORK_TYPE=mantle`, all modules load — identical to today. For `NETWORK_TYPE=stellar`, the reduced set loads. Add the typed domain methods to `NetworkRegistryService`. Update consumers of cross-service operations to call through the registry instead of injecting services directly. Eliminate remaining `forwardRef()` chains in blockchain module imports. Verify Mantle works identically. Verify that starting with `NETWORK_TYPE=stellar` (even without Stellar adapters yet) boots cleanly and Leverage/Faucet routes return 404.

### Phase F — Stellar Adapter Implementations for Asset Issuance Flow

Install `@stellar/stellar-sdk` as a backend dependency via bun. Implement the four Stellar adapters covering the operations needed for asset issuance: `registerAsset`, `deployToken`, `listOnMarketplace`, `registerIdentity`, `isIdentityVerified`, and `approveTrustline`. Implement the Stellar event adapter with Soroban event polling and cursor tracking. Implement the Stellar wallet adapter with Stellar keypair management. Register Stellar adapters in `BlockchainModule.forRoot()` when `NETWORK_TYPE=stellar`. Implement the Auth verification adapter for both networks.

### Phase G — Integration and Verification

Test the complete asset issuance flow against Stellar testnet with `NETWORK_TYPE=stellar`. Document any behavioral differences discovered. Write `context.md` files for all touched folders. Confirm Mantle deployment still works identically with `NETWORK_TYPE=mantle`. Write Stellar-specific environment variable documentation. Define the Stellar-specific contract ID environment variables for all deployed Soroban contracts.

---

## Part 12: Key Invariants and Guard Rails

These rules must hold throughout the implementation:

**Mantle Backward Compatibility is Absolute.** Every test that passes today against a Mantle deployment must pass after every phase. No regressions. If a phase introduces a regression, the phase is not complete.

**The Module Registry is the Sole Availability Authority.** No module except the blockchain module and `network.config.ts` ever calls `process.env.NETWORK_TYPE` directly. Availability decisions flow exclusively through the registry. Scattered `if (network === 'stellar')` checks across domain modules are expressly forbidden.

**Adapters are Opaque to Consumers.** A consumer that injects `@Inject(BLOCKCHAIN_ADAPTER)` and calls `adapter.registerAsset()` must work on both Mantle and Stellar without any conditional logic in the consumer. The adapter is responsible for translating the call. The consumer is responsible for nothing more than calling the method and handling the result.

**The EventProcessor Never Changes in This Phase.** The event processing pipeline must work on both networks through adapter-level translation only. If an event needs a code change in `event.processor.ts`, it means the adapter's event translation is incomplete.

**Database Schema Fields Are Network-Agnostic Strings.** Fields like `tokenAddress`, `txHash`, `networkTxId`, and `walletAddress` in MongoDB schemas are plain strings. They carry whatever the active network stores. No schema field is typed to a specific network's format (no `0x${string}` types in schema definitions). This ensures the schema works for both Mantle and Stellar addresses and transaction IDs without modification.

**context.md Before Code.** No file in a touched folder is modified before that folder's `context.md` is written. No PR is complete without updated `context.md` files.

---

## Part 13: Files Created and Modified

### New Files

- `packages/backend/src/config/network.config.ts` — Master network configuration and feature flag map
- `packages/backend/src/config/context.md` — Config folder documentation
- `packages/backend/src/modules/blockchain/blockchain.constants.ts` — Injection token constants
- `packages/backend/src/modules/blockchain/services/network-registry.service.ts` — The global module registry
- `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/wallet-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/event-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/contract-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/auth-verification-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-wallet.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-event.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-contract-loader.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-auth-verification.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-wallet.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-event.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-contract-loader.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-auth-verification.adapter.ts`
- `packages/backend/src/modules/blockchain/context.md`
- `packages/backend/src/modules/blockchain/adapters/context.md`
- `packages/backend/src/modules/blockchain/adapters/evm/context.md`
- `packages/backend/src/modules/blockchain/adapters/stellar/context.md`
- `packages/backend/src/modules/assets/context.md`
- `packages/backend/src/modules/admin/context.md`
- `packages/backend/.env.stellar.example`

### Modified Files

- `packages/backend/src/config/blockchain.config.ts` — Expanded with Stellar-specific fields, clearly sectioned
- `packages/backend/src/modules/blockchain/blockchain.module.ts` — Converted to dynamic `forRoot()` pattern
- `packages/backend/src/app.module.ts` — Conditional module imports based on network config
- `packages/backend/src/modules/blockchain/services/blockchain.service.ts` — Becomes thin delegate then removed
- `packages/backend/src/modules/blockchain/services/wallet.service.ts` — Same
- `packages/backend/src/modules/blockchain/services/contract-loader.service.ts` — Same
- `packages/backend/src/modules/blockchain/services/event-listener.service.ts` — Same
- `packages/backend/src/modules/leverage/services/leverage-blockchain.service.ts` — Injects via adapter tokens
- `packages/backend/src/modules/solvency/services/solvency-blockchain.service.ts` — Injects via adapter tokens
- `packages/backend/src/modules/kyc/services/*.ts` — Cross-service calls go through registry
- `packages/backend/src/modules/auth/services/auth.service.ts` — Uses auth verification adapter
- `packages/backend/.env.example` — Add NETWORK_TYPE and Stellar variables clearly separated

---

## Closing Notes for the Implementor

The hardest decision in this plan is the Module Registry's typed domain method API. There will be a temptation to make the registry generic — a `callService(domain, method, ...args)` style interface — because typed methods require more upfront work. Resist this temptation. The typed method API is what makes the registry valuable: it documents exactly what cross-service operations exist in the system, provides compile-time safety for callers, and makes the system self-documenting. A generic registry is just a service locator by another name, with all the same problems.

The second hardest decision is how to handle Stellar's fundamental asymmetry in token deployment — there is no contract address to return because no contract is deployed; instead, a Stellar native asset is created. The plan's answer is the `primaryIdentifier` abstraction in the return type — an opaque string that carries the canonical network-specific identifier. The database stores it as a string. The adapter that reads it understands the format. Nothing in between cares. This is the correct answer.

The Stellar event adapter's cursor management deserves special attention during implementation. Unlike EVM block polling where the starting block is clear and well-understood, Soroban event cursors are sequenced by ledger sequence numbers. The cursor must be persisted across restarts (Redis is the right choice, consistent with the existing event listener's design). On first startup with `NETWORK_TYPE=stellar`, the cursor should start from a configurable `STELLAR_START_LEDGER` environment variable — defaulting to the current ledger at startup — to avoid replaying all historical events.

When in doubt about a design decision, the tiebreaker is: "does this preserve the Mantle deployment's exact current behavior?" If yes, proceed. If no, find an alternative that does.
