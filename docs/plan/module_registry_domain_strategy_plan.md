# Module Registry — Domain Strategy Architecture Plan

**Author:** Architecture Planning
**Date:** February 13, 2026
**Status:** Proposed — addresses gap identified after commit 5471a8e

---

## The Gap: Two Levels of Network Abstraction, Only One Implemented

The work done so far correctly establishes what can be called **Level 1 abstraction** — the Blockchain Adapter layer. This layer solves the question: "when we need to call the blockchain, how do we call Mantle versus Stellar?" It routes individual operations — `registerAsset`, `deployToken`, `listOnMarketplace` — to either a viem-based EVM implementation or a stellar-sdk-based Soroban implementation. This is a clean, well-designed piece of work.

What is entirely absent is **Level 2 abstraction** — the Domain Strategy layer. This layer answers a different and more fundamental question: "when a business operation arrives (asset origination, KYC verification, token deployment), which FLOW should handle it for the current network?"

The distinction is critical. The adapter layer handles individual atomic operations. The domain strategy layer handles entire orchestrated business processes that involve multiple steps, database updates, event handling decisions, and conditional sub-operations. These flows differ substantially between Mantle and Stellar — not just in the individual calls they make, but in their sequencing, their database interaction patterns, their event-handling requirements, and in some cases their conceptual model of what an operation means.

### A Concrete Illustration

When an admin approves an asset and triggers token deployment on **Mantle**, the flow is:

The admin module calls into the blockchain layer, which calls the TokenFactory contract to deploy a new ERC-20. The system then waits. The blockchain event listener polling loop picks up the `TokenDeployed` event from the contract after some block delay. That event triggers a BullMQ job. The job processor updates MongoDB with the deployed token address. Only at that point is the asset considered deployed in the system's view.

The same business operation on **Stellar** looks entirely different:

The admin module orchestrates native Stellar asset creation on the issuer account by setting account flags directly. No factory contract exists. There is no ERC-20. The system then calls the Soroban AssetCoordinator contract to register the asset metadata. The database is updated immediately after the transaction confirms — there is no event listener needed because Stellar's transaction model gives synchronous confirmation. The flow then generates a trustline approval operation so investors can receive the asset. None of this sequence exists or makes sense on Mantle.

A single `AssetService` calling through an adapter cannot capture this difference. The orchestration logic — the sequence of calls, the database update timing, the conditional trustline step — is inherently network-specific. Shoving network type conditionals into a single service produces exactly the unmaintainable if-else sprawl that the architecture set out to avoid.

---

## The Solution: Module Registry with Domain Strategy Services

### What the Module Registry Is

A new, globally-scoped NestJS module located at `modules/registry`. Its central service — called the `ModuleRegistryService` — is the runtime authority on which network-specific implementation of a domain service should handle any given operation.

The Module Registry is not a config reader. Any service can read `NetworkConfig` directly. The registry's unique responsibility is acting as the **domain service factory and orchestration broker** for the entire application. When any part of the system needs to perform a domain operation, it asks the registry. The registry returns the correct implementation for the current network. The caller knows only the interface — it never knows whether it is talking to the Mantle implementation or the Stellar implementation.

The Module Registry is also not the same thing as the `NetworkRegistryService` that currently lives in `modules/blockchain/services/`. That service is a blockchain-layer coordinator — it holds adapter references and routes low-level on-chain operations. The Module Registry sits above that. It routes high-level business processes. The two coexist and serve different levels of the stack.

### The Two-Layer Stack After This Plan

```
Domain Layer (Controllers, Business Logic)
        ↓
Module Registry          ← THIS PLAN INTRODUCES THIS LAYER
(selects which domain strategy to use)
        ↓
Domain Strategy Services (MantleAssetService | StellarAssetService)
(contain full business flow for their network)
        ↓
NetworkRegistryService   ← ALREADY EXISTS (blockchain module)
(routes individual on-chain operations to correct adapter)
        ↓
Blockchain Adapters      ← ALREADY EXISTS (evm / stellar)
(perform individual network calls)
```

---

## Architecture Details

### modules/registry — The New Module

This module is created at `packages/backend/src/modules/registry/`. It is marked as global so it is injectable everywhere without re-importing.

The module contains:

**The ModuleRegistryService** — The central service. At initialization (`OnModuleInit`), it reads `NetworkConfig` to determine the active network type, then resolves the correct implementation token for each domain using NestJS's `ModuleRef`. It memoizes these resolutions in a private typed map. After initialization, every lookup is a map read — zero overhead.

**Domain Interface Definitions** — Each domain that has network-varying behavior is described by a TypeScript interface living in `modules/registry/interfaces/`. These interfaces define the contract that all implementations of that domain must fulfill. An interface describes the business operations the domain can perform — not how it performs them, not what adapter it uses internally. The interface is permanent and network-agnostic. Implementations are transient and network-specific.

**Injection Token Manifest** — A static object mapping domain names to their per-network injection tokens. This is the registry's lookup table: for any domain, it knows which token to resolve for Mantle and which for Stellar. The manifest is the single file an engineer touches when adding support for a new network or a new domain — nothing else needs to change in the registry itself.

**context.md** — Documenting which domains the registry owns, how to add a new domain, and how implementations register themselves.

### Domain Interfaces

Each domain service that has network-varying logic defines its interface in `modules/registry/interfaces/`. Key domains for this plan:

**IAssetOriginationService** — Covers the full asset lifecycle: creating a draft, submitting for attestation, executing deployment on admin approval (this is where flows diverge most), and querying current state.

**IMarketplaceListingService** — Covers listing an asset on the primary marketplace after token deployment. On Mantle this calls the EVM PrimaryMarket contract via viem. On Stellar this calls the Soroban PrimaryMarket contract and additionally handles the asset's distribution account setup.

**IKycRegistrationService** — Covers on-chain identity registration after a user passes KYC review. On Mantle this calls the IdentityRegistry contract. On Stellar this calls the Soroban IdentityRegistry contract AND issues a trustline authorization for the user against the platform account.

**ITokenDeploymentService** — Covers the token creation step specifically, separated from broader asset management because its divergence is the deepest. On Mantle it calls TokenFactory and waits for an event. On Stellar it performs native asset creation synchronously.

### Network-Specific Implementation Structure

Each domain module that requires network-varying logic gains a subdirectory called `implementations/` containing two services: one for Mantle, one for Stellar. Both implement the same domain interface.

For the Assets module, the structure becomes:

`modules/assets/implementations/mantle/` holds a `MantleAssetOriginationService`. This contains the current EVM logic as it exists today — calling the attestation registry, delegating to TokenFactory via the blockchain adapter, and relying on the event processor to update MongoDB after block confirmation.

`modules/assets/implementations/stellar/` holds a `StellarAssetOriginationService`. This contains the Stellar-specific flow — calling the NetworkRegistryService to issue the native asset, setting account authorization flags, calling the Soroban AssetCoordinator directly, and updating MongoDB synchronously (since Stellar transactions confirm in seconds with deterministic results, event-driven DB sync is unnecessary and adds complexity for no reason on this network).

Both are registered as providers inside `AssetsModule`. Both are exported with their respective injection tokens so the Module Registry can resolve either via `ModuleRef`. The `AssetsModule` itself remains the module boundary — the registry does not import these services, it resolves them at runtime.

The same pattern applies to:

`modules/admin/implementations/mantle/` and `modules/admin/implementations/stellar/` — Admin approval and token deployment triggering differs per network.

`modules/kyc/implementations/mantle/` and `modules/kyc/implementations/stellar/` — On-chain identity registration and trustline approval.

`modules/marketplace/implementations/mantle/` and `modules/marketplace/implementations/stellar/` — Marketplace listing and price feed handling.

`modules/yield/implementations/mantle/` and `modules/yield/implementations/stellar/` — Yield distribution mechanics are fundamentally different (contract-based on EVM vs. native payment operations on Stellar).

### How Controllers Use the Registry

Controllers change in one important way: instead of injecting a concrete domain service directly, they inject the `ModuleRegistryService`. When handling a request, they call a typed factory method on the registry — for example `registry.getAssetOriginationService()` — and receive back the correct implementation for the current network. They then call the interface method they need on the returned service.

Alternatively, for domain modules where the controller's role is thin and the service layer is the primary actor, the domain's main service (e.g., `AssetsService`) can inject the registry and delegate internally. The controller continues to inject only `AssetsService` as it does today. This is preferred for domains where the controller logic is already established and minimal disruption is desired.

The key invariant is: **no controller and no service ever directly instantiates or injects a `Mantle*Service` or `Stellar*Service` by name**. The implementation is always retrieved through the registry's typed method.

### What Happens for Mantle-Only Domains

Modules that are conditionally loaded only on Mantle (leverage, faucet, solvency, secondary market, partners) do not need the two-implementation pattern. They have a single implementation, and the Module Registry simply marks them as unavailable on Stellar. Any call to `registry.getLeverageService()` on a Stellar deployment returns a null-safe wrapper that responds with a typed skip result rather than a service instance. The module was never loaded, so there is nothing to resolve — the registry handles this gracefully at initialization time by checking `ModuleRef.resolve()` results and building the availability map accordingly.

---

## Cross-Service Orchestration (Eliminating forwardRef)

The Module Registry also serves as the mediator for all cross-module communication. This is the second major function, already described in the existing plan for the `NetworkRegistryService`, but which belongs at the Module Registry level rather than purely in the blockchain module.

The registry exposes named cross-service methods for every interaction that currently requires one module to import another:

For yield distribution that touches leveraged positions — the yield module calls the registry with a method specifically for this operation. The registry checks leverage availability, resolves the leverage service if available, and delegates. On Stellar where leverage is not available, it returns the standard skip result.

For solvency vault operations during secondary market settlement — same pattern. The secondary market module never imports solvency. It calls the registry.

For OAID credit line queries from solvency — registry mediates.

Every cross-service call returns the same typed result shape described in the existing plan: `completed`, `skipped`, optional `txId`, optional `data`. The caller always checks `completed` before using any data. Skips are not errors — they are expected outcomes on networks where a feature is not present.

---

## What This Plan Does NOT Change

The Blockchain Adapter layer (Level 1) is untouched. All `EvmBlockchainAdapter`, `StellarBlockchainAdapter`, and adapter interface definitions remain exactly as implemented.

The `BlockchainModule.forRoot()` dynamic pattern is untouched.

Conditional module loading in `AppModule` is untouched — it remains the gating mechanism for Mantle-only modules.

`NetworkConfig` is untouched.

The existing `NetworkRegistryService` in `modules/blockchain/services/` is retained but its scope narrows. It handles low-level adapter routing and cross-module orchestration of blockchain-specific operations. It does NOT handle domain business logic orchestration — that moves to the `ModuleRegistryService`.

The existing service files (`AssetsService`, `AdminService`, etc.) are not deleted — they become thin delegators. Their public APIs do not change. Controllers do not change. DTOs do not change. Only the internal delegation chain deepens by one level.

---

## Migration Order

This work proceeds in phases to minimize disruption to the existing Mantle deployment at every step.

**Phase A — Registry Scaffolding (no behavior changes)**

Create `modules/registry` with the `ModuleRegistryService`, the injection token manifest, and the domain interfaces. Wire it into `AppModule` as a global module. The module is fully injectable at this point but all factory methods return null stubs — no actual service resolution yet. The existing behavior is completely unchanged. This phase exists to prove the module compiles and the wiring is correct.

**Phase B — Asset Domain (first concrete domain)**

Introduce `implementations/mantle/` and `implementations/stellar/` inside the Assets module. Move the existing EVM asset logic into `MantleAssetOriginationService`. Implement `StellarAssetOriginationService` with the Stellar-specific flow. Register both in `AssetsModule` with their tokens. Update `ModuleRegistryService.getAssetOriginationService()` to resolve correctly. Update `AssetsService` or its controller to use the registry. Verify existing Mantle behavior is unchanged. Verify Stellar flow is logically correct.

**Phase C — Admin and Token Deployment**

Same pattern for the Admin module's token deployment and marketplace listing triggers. Admin approval of an asset must route through the registry so the correct deployment flow runs per network.

**Phase D — KYC and Identity**

Same pattern for the KYC module's on-chain registration step and (Stellar-only) trustline approval step.

**Phase E — Marketplace**

Same pattern for the Marketplace module's listing operations.

**Phase F — Yield**

Same pattern for yield distribution, which has the most complex network differences. Soroban payment primitives vs. EVM contract-based distribution.

**Phase G — Cross-Module Orchestration Cleanup**

Remove all remaining `forwardRef()` usages. Move all cross-module calls to go through the registry's named orchestration methods. Confirm no circular dependency warnings at module init.

**Phase H — context.md Updates**

Update `context.md` in every folder touched by this plan. The Module Registry's `context.md` must document every registered domain and every cross-service method. Each domain module's `context.md` must document which implementations exist and which injection tokens they use.

---

## What Must Be True When This Plan Is Done

Any engineer looking at `AssetsController` can tell in one glance that asset operations route through `ModuleRegistryService`. They can then look at `ModuleRegistryService.getAssetOriginationService()` and see clearly that it returns either the Mantle or Stellar implementation. They can then look at each implementation in isolation without any network conditionals cluttering the business logic.

Switching the system from Mantle to Stellar requires only changing `NETWORK_TYPE` in the environment. No code changes. The registry initialization selects the correct implementations. The adapters route to the correct blockchain. The database is updated by the correct flow. Everything works or fails clearly — no mixed-network state is possible.

Adding a third network in the future requires: adding a new implementation folder per domain, registering the tokens in the manifest, adding the network type to the config. The registry, the adapters, and the existing implementations are untouched.

---

## Clarification on the Existing NetworkRegistryService

The `NetworkRegistryService` already in `modules/blockchain/services/` is **not replaced** by this plan — it is **complemented**. Its responsibility is specifically:
- Routing individual blockchain operations to the correct adapter
- Managing adapter instance references
- Checking individual operation availability based on feature flags

The new `ModuleRegistryService` in `modules/registry/` is responsible for:
- Routing entire domain business processes to the correct network-specific service implementation
- Managing domain service instance references
- Mediating cross-domain service calls

Think of it as: `NetworkRegistryService` is the blockchain plumbing coordinator. `ModuleRegistryService` is the domain business logic coordinator. They operate at different altitudes and never need to know about each other.
