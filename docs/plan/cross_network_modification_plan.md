# Network-Agnostic Architecture Plan — Adding Stellar Support

## Project Summary

Open Assets is a Real-World Asset (RWA) tokenization platform that enables the full lifecycle of bringing real-world assets on-chain — from originator onboarding and KYC verification, through asset attestation and token deployment, to primary marketplace listing (static pricing and auctions), secondary P2P trading, yield distribution, and settlement.

The platform is built as a NestJS monorepo with three packages: a backend REST API, Solidity smart contracts, and shared TypeScript types. The backend orchestrates 17 domain modules — Auth, Admin, Assets, Blockchain, KYC, Marketplace, Secondary Market, Yield, Leverage, Solvency, Partners, Notifications, Announcements, Changelog, Compliance Engine, Faucet, and Typeform — all communicating through NestJS dependency injection with MongoDB for persistence, Redis/BullMQ for async event processing, and a global Blockchain module that handles all on-chain interactions.

The on-chain layer consists of 17 deployed smart contracts on Mantle Sepolia covering asset attestation (AttestationRegistry), identity verification (IdentityRegistry, OAID), token lifecycle (TokenFactory, RWAToken, PrivateAssetToken), marketplace operations (PrimaryMarket, SecondaryMarket), financial infrastructure (YieldVault, SolvencyVault, LeverageVault, SeniorPool), and integrations (FluxionDEX, MockUSDC, MockMETH, Faucet). The backend listens for contract events via block polling every 3 seconds, processes them through BullMQ queues, and synchronizes on-chain state with the MongoDB database.

Key platform capabilities include: originator-driven asset creation with admin approval workflows, ERC-20 token deployment per asset, dual marketplace model (fixed-price and Dutch auctions), investor KYC with on-chain identity registration, automated yield distribution to token holders, a leverage system allowing mETH-collateralized positions for amplified RWA exposure, a solvency vault for borrowing against RWA collateral with OAID credit lines, partner API integrations for external lending, and a secondary P2P order book for token trading.

Currently, every blockchain interaction is tightly coupled to the Mantle/EVM ecosystem through the `viem` library and a hardcoded Mantle Sepolia chain definition imported across 5 service files. This plan introduces a network-agnostic architecture to support Stellar (and future networks) alongside Mantle through adapter patterns, a config-driven service registry, and conditional module loading — all without code changes between deployments.

---

## Context

The Open Assets platform is currently hardwired to the Mantle (EVM) ecosystem. Every blockchain service — wallet management, contract interaction, event listening, price feeds — imports `mantleSepolia` from `config/mantle-chain.ts` and uses `viem` (an EVM-only library) directly. This makes it impossible to deploy the same codebase against a non-EVM network like Stellar without code changes.

The goal is to introduce a **network-agnostic layer** so that the same codebase can be deployed for **Mantle** or **Stellar** (and future networks) with **only config changes**. One deployment always serves one network — the network is selected at startup via environment variables and never changes at runtime.

**Philosophy**: Plug-and-play architecture where a config registry governs which services are active, which adapters are loaded, and which cross-service interactions are permitted.

---

## Part 1 — Network Config & Service Registry

### 1.1 New Environment Variable: `NETWORK_TYPE`

Introduce a single env var `NETWORK_TYPE` that takes values like `mantle`, `stellar`, etc. This is the master switch. Every conditional decision in the system branches on this value.

Add it to `.env.example` with a default of `mantle` (backward compatible).

### 1.2 New Config File: `network.config.ts`

Create `packages/backend/src/config/network.config.ts` to replace/extend the current `blockchain.config.ts`. This config will be the single source of truth for:

- **`networkType`**: The active network (`mantle` | `stellar`)
- **`networkName`**: Human-readable name for logging
- **`services`**: A map of service feature flags — which domain modules/features are available on this network

The services map will look conceptually like:
- `leverage: true/false` — Is the mETH leverage system available?
- `faucet: true/false` — Is the faucet available?
- `solvency: true/false` — Is the solvency vault available?
- `secondaryMarket: true/false` — Is the P2P secondary market available?
- `oaid: true/false` — Is the OAID credit line system available?
- `methPrice: true/false` — Is the mETH price feed needed?
- `fluxionDex: true/false` — Is the FluxionDEX swap service needed?

For **Mantle**, all are `true` (current behavior). For **Stellar**, things like `leverage`, `methPrice`, `fluxionDex`, and `faucet` would be `false` initially, while core services like `solvency`, `secondaryMarket`, and `oaid` would be `true` (assuming Stellar contracts support them).

The existing `blockchain.config.ts` will remain but be nested under the network config — the RPC URLs, chain IDs, wallet keys, and contract addresses are still needed, they just become network-specific.

### 1.3 Stellar-Specific Config

For Stellar deployments, the config will need different fields:
- `STELLAR_RPC_URL` (Soroban RPC)
- `STELLAR_NETWORK_PASSPHRASE` (e.g., "Test SDF Network ; September 2015")
- `STELLAR_ADMIN_SECRET` (Stellar secret key instead of EVM private key)
- `STELLAR_PLATFORM_SECRET`
- Contract IDs (Soroban contract addresses, which are different format from 0x hex)

These will only be read when `NETWORK_TYPE=stellar`.

### 1.4 The Network Registry — Cross-Service Orchestration Layer

Create `packages/backend/src/modules/blockchain/services/network-registry.service.ts` — a **global injectable service** that acts as the **typed mediator** for all cross-service interactions. This is NOT just a config checker — it is the orchestration layer that owns service instances and brokers interactions between modules.

**Core Responsibilities:**

1. **Service Availability**: Knows which services are active for the current network
2. **Service Instance Management**: Holds references to registered service instances (injected via NestJS DI using ModuleRef or explicit registration)
3. **Typed Cross-Service Operations**: Exposes domain-specific methods that internally resolve the target service, check availability, and either delegate or gracefully skip

**Why this matters:**
- Eliminates the `forwardRef()` circular dependency chains currently plaguing YieldModule, SolvencyModule, LeverageModule, and PartnersModule
- Modules never import each other directly — they talk through the registry
- "Service not available" is handled in ONE place (the registry) instead of scattered `if` checks in every caller
- Adding/removing services for a new network means updating the registry, not rewiring imports across 5 modules

**How it works:**

The registry exposes typed domain methods for every cross-service operation. For example:
- `processLeverageSettlement(positionId, settlementUSDC)` — internally checks if leverage is active, gets the LeverageBlockchainService instance, calls processSettlement, or returns a skip result
- `registerUserInOAID(walletAddress)` — checks if OAID is active, delegates to SolvencyBlockchainService, or skips
- `getOAIDCreditLines(walletAddress)` — same pattern
- `claimLeverageYieldFromBurn(positionId, tokenAmount)` — checks leverage availability, delegates or skips
- `getMethPrice()` — checks if methPrice service is active, returns current price or null

Each method returns a typed result that includes a `skipped: boolean` flag so the caller knows whether the operation was actually performed or gracefully bypassed.

**Service Registration Pattern:**
Services register themselves with the registry at initialization. The registry uses NestJS's `ModuleRef` to lazily resolve service instances when first needed, avoiding circular dependency issues entirely. Only services that are actually loaded (based on conditional module loading) will be resolvable — if a service's module wasn't imported, `ModuleRef.resolve()` simply won't find it, and the registry knows to skip.

**What this replaces:**
- All `forwardRef(() => LeverageBlockchainService)` injections across modules
- All `forwardRef(() => SolvencyBlockchainService)` injections
- All manual `isServiceAvailable()` checks scattered in caller code
- Direct cross-module service injections that created the circular dependency web

---

## Part 2 — Blockchain Adapter Abstraction

### 2.1 Define Adapter Interfaces

Create a folder `packages/backend/src/modules/blockchain/adapters/` with interface files:

**`blockchain-adapter.interface.ts`** — Defines the unified contract that all network adapters must satisfy. This interface mirrors the methods currently on `BlockchainService`:
- `registerAsset(...)` → returns a transaction identifier (string, not necessarily a hex hash)
- `deployToken(...)` → returns transaction identifier + token address
- `listOnMarketplace(...)` → returns transaction identifier
- `depositYield(...)` → returns transaction identifier
- `distributeYield(...)` → returns transaction identifier
- `approveMarketplace(...)` → returns transaction identifier
- `endAuction(...)` → returns transaction identifier
- `revokeAsset(...)` → returns transaction identifier
- `burnUnsoldTokens(...)` → returns burn details
- `isVerified(...)` → returns boolean

The key insight: return types must be **network-agnostic**. Instead of returning `Hash` (a viem type), return `string`. Instead of `Address`, return `string`. The unified outputs should carry the same semantic meaning across networks.

**`wallet-adapter.interface.ts`** — Defines unified wallet operations:
- `getAdminWallet()` → returns a network-specific wallet client (opaque to consumers)
- `getPlatformWallet()` → same
- `getAdminAddress()` → returns the admin's address as string
- `getPlatformAddress()` → same

**`event-adapter.interface.ts`** — Defines unified event listening:
- `startListening()` → begins watching for on-chain events
- `stopListening()` → stops
- Event types remain the same (asset registered, token deployed, etc.) — the adapter translates network-specific events into unified event payloads before pushing to the BullMQ queue

**`contract-adapter.interface.ts`** — Defines how contracts are loaded:
- `getContractAddress(name: string): string`
- `getContractInterface(name: string): any` (ABI for EVM, Soroban contract spec for Stellar)
- `hasContract(name: string): boolean`

### 2.2 EVM Adapter (Mantle)

Create `packages/backend/src/modules/blockchain/adapters/evm/` folder containing:

- **`evm-blockchain.adapter.ts`** — Implements `BlockchainAdapter` interface. This is essentially the current `BlockchainService` code, moved here and implementing the interface. Uses `viem`, `createPublicClient`, `mantleSepolia` chain (or dynamically loaded chain definition from config). All existing logic stays the same.

- **`evm-wallet.adapter.ts`** — Implements `WalletAdapter`. Current `WalletService` code moved here. Uses `viem/accounts`, `privateKeyToAccount`, `createWalletClient`.

- **`evm-event.adapter.ts`** — Implements `EventAdapter`. Current `EventListenerService` code moved here. Block-based polling with `getLogs`, `decodeEventLog`.

- **`evm-contract-loader.adapter.ts`** — Implements `ContractAdapter`. Current `ContractLoaderService` code moved here. Loads Solidity ABIs from artifacts, addresses from `deployed_contracts.json`.

The chain definition will become dynamic instead of hardcoded. Instead of importing `mantleSepolia`, the EVM adapter will construct the chain from config values (RPC URL, chain ID, currency symbol, explorer URL). This means the `mantle-chain.ts` file becomes a default fallback rather than a hardcoded dependency.

### 2.3 Stellar Adapter (New)

Create `packages/backend/src/modules/blockchain/adapters/stellar/` folder containing:

- **`stellar-blockchain.adapter.ts`** — Implements `BlockchainAdapter` using `@stellar/stellar-sdk`. Uses Soroban smart contract invocations instead of EVM contract writes. Transaction submission uses Stellar's transaction builder pattern instead of wallet.writeContract.

- **`stellar-wallet.adapter.ts`** — Implements `WalletAdapter` using Stellar Keypairs instead of EVM private keys. Transaction signing uses Stellar's native signing.

- **`stellar-event.adapter.ts`** — Implements `EventAdapter` using Soroban's `getEvents` RPC method with cursor-based pagination instead of EVM block-range polling.

- **`stellar-contract-loader.adapter.ts`** — Implements `ContractAdapter`. Loads Soroban contract IDs from config/env. Contract specs (the Stellar equivalent of ABIs) loaded differently — possibly from WASM metadata or stored JSON specs.

### 2.4 Adapter Factory & Dynamic Module Registration

The `BlockchainModule` will become a **dynamic module** using NestJS's `forRoot()` pattern. At startup, it inspects `NETWORK_TYPE` and registers the correct adapter implementations under the interface injection tokens.

All existing services that currently inject `BlockchainService`, `WalletService`, `ContractLoaderService`, or `EventListenerService` will instead inject the **interface token** (e.g., `BLOCKCHAIN_ADAPTER`, `WALLET_ADAPTER`). The module wires the correct implementation at boot.

This means:
- `BlockchainModule.forRoot()` reads `NETWORK_TYPE` from config
- If `mantle` → registers EVM adapters as providers for the interface tokens
- If `stellar` → registers Stellar adapters
- The `@Global()` decorator stays, so all modules get the right adapter automatically

---

## Part 3 — Conditional Module Loading

### 3.1 Dynamic App Module

The `app.module.ts` currently imports all 17 domain modules unconditionally. This must become conditional based on the network config's service availability map.

Approach: Use NestJS dynamic module patterns. The `AppModule` will read the network config at initialization and only import modules whose services are marked as available.

For example:
- `LeverageModule` → only imported if `services.leverage === true`
- `FaucetModule` → only imported if `services.faucet === true`
- `SolvencyModule` → imported if `services.solvency === true`

Core modules that work on all networks (Auth, Admin, Assets, Marketplace, KYC, Yield, Notifications, Changelog, Announcements, Typeform, ComplianceEngine, Redis) are always imported.

### 3.2 Guard Against Missing Services

When a service is disabled for a network, its API endpoints should return appropriate responses (like 404 or 501 "Not Available on this Network") rather than crashing.

Two approaches (use the simpler one):
- **Module-level**: Don't register the module at all. NestJS won't create routes for unregistered controllers. API calls to those routes will naturally 404.
- **Guard-level**: Create a `NetworkFeatureGuard` that checks the NetworkRegistry before allowing controller method execution. This is more granular but only needed if a module is partially available.

The module-level approach is preferred — it's cleaner and aligns with the "if config says false, it doesn't exist" philosophy.

### 3.3 Cross-Service Safety (Handled by Network Registry)

All cross-module communication goes through the Network Registry's typed domain methods. The registry internally resolves availability, delegates or skips, and returns typed results with a `skipped` flag. No module ever needs to manually check availability or handle missing services — the registry does it all.

Example flow: YieldDistributionService calls `networkRegistry.processLeverageSettlement(positionId, amount)`. The registry checks if leverage is active, resolves the LeverageBlockchainService instance via ModuleRef, calls it, or returns `{ skipped: true }`. YieldDistributionService just checks the `skipped` flag and moves on.

---

## Part 4 — Handling Mantle-Specific Services

### 4.1 MethPriceService

This service tracks mETH prices from CSV data and is only meaningful on Mantle. On Stellar, it simply won't be loaded (its module won't be imported). Any service that currently uses MethPriceService must first check `networkRegistry.isServiceAvailable('methPrice')`.

### 4.2 LeverageModule (mETH Leverage)

The entire leverage system (LeverageBlockchainService, FluxionDEXService, HarvestKeeperService, HealthMonitorService) is Mantle-specific. On Stellar, the `LeverageModule` is not imported, its controllers don't exist, and its endpoints return 404.

### 4.3 FaucetModule

Mantle testnet faucet. Not imported on Stellar.

### 4.4 FluxionDEX Integration

Part of the leverage module. Not loaded on Stellar.

---

## Part 5 — Handling Stellar-Specific Services

### 5.1 Stellar-Specific Modules (Future)

If Stellar has unique services not present on Mantle (e.g., a Stellar liquidity pool integration, or Stellar-native token wrapping), they will be created as new modules and added to the service map with `mantle: false, stellar: true`.

### 5.2 Stellar SDK Integration

Add `@stellar/stellar-sdk` as a dependency in `packages/backend/package.json`. This is a peer of `viem` — both are installed, but only one is used at runtime based on the adapter that gets loaded.

---

## Part 6 — Migration Path for Existing Consumers

### 6.1 Services That Import Blockchain Directly

These files currently import directly from blockchain services and must be updated to use adapter interfaces:

- `leverage-blockchain.service.ts` → Uses `WalletService`, `ContractLoaderService`, `MethPriceService` — will inject `WALLET_ADAPTER`, `CONTRACT_ADAPTER`. MethPriceService remains a direct import (only loaded on Mantle).
- `solvency-blockchain.service.ts` → Uses `WalletService`, `ContractLoaderService` — will inject adapter tokens.
- `event.processor.ts` → Uses many database models and cross-module services — doesn't directly use blockchain adapters, so minimal changes needed.
- Any controller or service that calls `BlockchainService` methods (registerAsset, deployToken, etc.) will inject `BLOCKCHAIN_ADAPTER` instead.

### 6.2 Injection Token Strategy

Define injection tokens as string constants or Symbol tokens in a shared file like `packages/backend/src/modules/blockchain/blockchain.constants.ts`:
- `BLOCKCHAIN_ADAPTER`
- `WALLET_ADAPTER`
- `EVENT_ADAPTER`
- `CONTRACT_ADAPTER`

Services inject using `@Inject(BLOCKCHAIN_ADAPTER)` with the interface type.

### 6.3 Backward Compatibility

The Mantle deployment must work exactly as before. The EVM adapters are literally the current service code behind the interface. No behavioral changes. The only difference is the indirection through the interface — same code, same logic, same outputs.

---

## Part 7 — Implementation Sequence

The work is ordered to maintain a working system at every step. Each phase is independently deployable.

### Phase 1: Foundation — Config & Registry (No Breaking Changes)
1. Create `network.config.ts` with `NETWORK_TYPE` env var (default: `mantle`) and service availability map
2. Create `NetworkRegistryService` — reads config, exposes `isServiceAvailable()` and `getNetworkType()`
3. Add `NETWORK_TYPE=mantle` to `.env.example`
4. Register `NetworkRegistryService` globally
5. Verify existing Mantle deployment still works identically

### Phase 2: Define Interfaces
1. Create the `adapters/` folder structure
2. Define `BlockchainAdapter`, `WalletAdapter`, `EventAdapter`, `ContractAdapter` interfaces
3. Define injection token constants
4. No services are changed yet — interfaces are just defined

### Phase 3: Extract EVM Adapters
1. Move `BlockchainService` logic into `evm-blockchain.adapter.ts` implementing `BlockchainAdapter`
2. Move `WalletService` logic into `evm-wallet.adapter.ts` implementing `WalletAdapter`
3. Move `EventListenerService` logic into `evm-event.adapter.ts` implementing `EventAdapter`
4. Move `ContractLoaderService` logic into `evm-contract-loader.adapter.ts` implementing `ContractAdapter`
5. Make the original service files thin wrappers that delegate to the EVM adapter (for backward compat during transition)
6. Verify nothing breaks

### Phase 4: Dynamic BlockchainModule
1. Convert `BlockchainModule` to use `forRoot()` dynamic pattern
2. Register adapter providers based on `NETWORK_TYPE` from config
3. Update all consumers to inject via adapter tokens instead of concrete classes
4. Remove thin wrapper services from Phase 3 (consumers now use adapters directly)
5. Make the chain definition dynamic in EVM adapter (read from config instead of hardcoded `mantleSepolia`)
6. Verify Mantle deployment works

### Phase 5: Conditional Module Loading
1. Update `app.module.ts` to conditionally import modules based on `network.config` service map
2. Add safety checks in cross-service callers (YieldDistributionService, KYC, Partners) to check NetworkRegistry before calling optional services
3. Verify modules are correctly skipped when marked as unavailable
4. Verify Mantle deployment still loads all modules (all services true)

### Phase 6: Stellar Adapter Implementation
1. Install `@stellar/stellar-sdk`
2. Implement `stellar-blockchain.adapter.ts` — Soroban contract invocations for the unified interface methods
3. Implement `stellar-wallet.adapter.ts` — Stellar Keypair management
4. Implement `stellar-event.adapter.ts` — Soroban event subscription with cursor-based pagination
5. Implement `stellar-contract-loader.adapter.ts` — Load Soroban contract IDs and specs
6. Add Stellar contract deployment artifacts (separate from EVM contracts)
7. Create Stellar-specific `.env.stellar.example` documenting required variables
8. Test with `NETWORK_TYPE=stellar`

### Phase 7: Stellar-Specific Service Configuration
1. Define which services are available on Stellar (core RWA operations likely yes; leverage, faucet, mETH-related no)
2. Add Stellar-specific services if needed (Stellar DEX integration, Stellar token wrapping, etc.)
3. End-to-end testing of a Stellar deployment

---

## Files to Create (New)
- `packages/backend/src/config/network.config.ts`
- `packages/backend/src/modules/blockchain/blockchain.constants.ts`
- `packages/backend/src/modules/blockchain/services/network-registry.service.ts`
- `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/wallet-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/event-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/contract-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-wallet.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-event.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-contract-loader.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-wallet.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-event.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-contract-loader.adapter.ts`

## Files to Modify (Existing)
- `packages/backend/src/config/blockchain.config.ts` — Expand with Stellar fields, make network-aware
- `packages/backend/src/modules/blockchain/blockchain.module.ts` — Convert to dynamic module with forRoot()
- `packages/backend/src/app.module.ts` — Conditional module imports
- `packages/backend/src/modules/blockchain/services/blockchain.service.ts` — Becomes thin wrapper then removed
- `packages/backend/src/modules/blockchain/services/wallet.service.ts` — Same
- `packages/backend/src/modules/blockchain/services/contract-loader.service.ts` — Same
- `packages/backend/src/modules/blockchain/services/event-listener.service.ts` — Same
- `packages/backend/src/modules/leverage/services/leverage-blockchain.service.ts` — Inject adapter tokens
- `packages/backend/src/modules/solvency/services/solvency-blockchain.service.ts` — Inject adapter tokens
- `packages/backend/src/modules/yield/services/yield-distribution.service.ts` — Add NetworkRegistry checks
- `packages/backend/src/modules/partners/services/partner-loan.service.ts` — Add NetworkRegistry checks
- `packages/backend/src/modules/kyc/services/*.ts` — Add NetworkRegistry checks for OAID registration
- `packages/backend/.env.example` — Add NETWORK_TYPE and Stellar env vars

## Verification Plan
1. **Unit**: Each adapter implements the interface correctly (method signatures, return types)
2. **Integration**: With `NETWORK_TYPE=mantle`, every existing test and script works identically
3. **Conditional Loading**: With `NETWORK_TYPE=stellar`, leverage/faucet modules are not loaded, their API endpoints return 404
4. **Stellar Smoke Test**: With `NETWORK_TYPE=stellar` and Stellar testnet config, basic operations (register asset, deploy token) succeed against Soroban contracts
5. **Cross-Service Safety**: YieldDistributionService gracefully skips leverage paths when leverage is disabled
