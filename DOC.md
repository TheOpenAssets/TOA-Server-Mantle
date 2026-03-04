# Network Header to Asset Origination Mapping — Implementation Plan

**Author:** Architecture Planning
**Date:** March 4, 2026
**Status:** Proposed — addresses the per-request network context gap in the originator-facing asset origination flow. Companion to `creditcoin_asset_origination_backend_plan.md`. Must be implemented before any multi-network asset origination works correctly for any network, including Credit Coin.

---

## The Problem in Plain Terms

The network context pipeline is half-built. The `X-Network` header arrives at the middleware, the `NetworkContextService` stores it correctly in `AsyncLocalStorage`, and the value is available throughout the async call chain. But nothing downstream actually reads it. Two services that must be network-aware are both ignoring the context entirely:

The `ModuleRegistryService` resolves which `IAssetOriginationService` implementation to return at application startup — once — based on the `NETWORK_TYPE` environment variable. Every call to `getAssetOriginationService()` for the lifetime of the process returns the same pre-baked instance, regardless of which `X-Network` header the current request carried. A `POST /assets` with `X-Network: creditcoin` receives the Mantle implementation because that is what the startup-time env var said. The header is silently ignored.

The `AssetLifecycleService.createAsset()` method calls `getConfiguredNetworkType()`, which reads `process.env.NETWORK_TYPE` — a plain synchronous environment variable read that has no connection to `AsyncLocalStorage` whatsoever. Every asset document created in this process gets stamped with the same network field value regardless of which network header the originator sent. A Credit Coin originator's asset ends up tagged `network: 'mantle'` in MongoDB.

Both problems have the same root cause: they were written before the multi-network per-request model existed, and they use the startup-time network config as a substitute for the per-request context. Fixing them is the minimum required change to make the header actually do what it promises.

---

## The Two Problems and Their Exact Fix Points

### Problem 1 — ModuleRegistryService: Startup Resolution vs. Per-Request Resolution

**Where the code lives:** `packages/backend/src/modules/registry/services/module-registry.service.ts`

**What it does today:** `onModuleInit()` reads `network.networkType` from `ConfigService` (which comes from `NETWORK_TYPE` env var), applies a binary `isEvm` check to decide between Mantle and Stellar tokens, resolves the matching implementations via `ModuleRef`, and stores them in a `serviceMap` keyed by generic domain tokens (`ASSET_ORIGINATION_SERVICE`, `ADMIN_DOMAIN_STRATEGY`). `getAssetOriginationService()` reads from this map — there is only one entry per key, so it always returns the same thing.

**What needs to change:** The registry must hold all enabled network implementations simultaneously at startup, keyed by `NetworkType`. `getAssetOriginationService()` must read the current network from `NetworkContextService` at call time and use it as the lookup key to return the right implementation for the current request.

This means the `serviceMap` structure changes from `Map<domainToken, implementation>` to `Map<NetworkType, Map<domainToken, implementation>>`. At startup, the registry resolves every implementation it can for every enabled network and populates all entries. At request time, the `getAssetOriginationService()` call reads `NetworkContextService.getNetwork()`, looks up the matching inner map, and returns the entry for `ASSET_ORIGINATION_SERVICE`. If no entry exists for the requested network (because it was not in `ENABLED_NETWORKS` or its module was not loaded), the registry throws a descriptive error that the controller translates into a `503 Network Not Available` response.

**The per-request lookup chain:** A request carrying `X-Network: creditcoin` arrives. The middleware already stored `NetworkType.CREDITCOIN` in `AsyncLocalStorage`. The controller calls `moduleRegistryService.getAssetOriginationService()`. Inside that method, `networkContextService.getNetwork()` returns `NetworkType.CREDITCOIN` from the storage. The registry looks up `serviceMap.get(NetworkType.CREDITCOIN).get(ASSET_ORIGINATION_SERVICE)` and returns the `CreditCoinAssetOriginationService` instance. The controller calls `createAsset()` on that instance. Everything proceeds on the Credit Coin path.

### Problem 2 — AssetLifecycleService: Environment Read vs. Context Read

**Where the code lives:** Line 109 of `packages/backend/src/modules/assets/services/asset-lifecycle.service.ts`

**What it does today:** `createAsset()` calls `getConfiguredNetworkType()`, which is a plain module-level function that executes `process.env.NETWORK_TYPE`. This has no awareness of `AsyncLocalStorage`, no knowledge of the current HTTP request, and no connection to the middleware pipeline. The result is stored in a local variable named `network` and stamped onto the new asset document.

**What needs to change:** `AssetLifecycleService` must inject `NetworkContextService` (already a globally available provider from the blockchain module). The `getConfiguredNetworkType()` call on line 109 must be replaced with `this.networkContextService.getNetwork()`. This single change makes the `network` field on the asset document reflect the actual `X-Network` header from the originator's request.

The import of `getConfiguredNetworkType` from the auth utils folder can be removed from this file entirely once this change is made. If `getConfiguredNetworkType` is used nowhere else in `AssetLifecycleService`, the entire import line is cleaned up.

---

## Problem 3 — Query Filtering: Missing Network Scope on Read Operations

The two write-side problems above are the most critical — they determine whether data is stamped correctly. But there are also read-side problems in `AssetLifecycleService` that produce incorrect results in a multi-network deployment.

**`getAllAssets()`** builds a MongoDB query with optional `status` and `originator` filters but no `network` filter. When a Credit Coin originator calls `GET /assets` with `X-Network: creditcoin`, they receive every asset in the database regardless of which chain it belongs to — Mantle assets, Stellar assets, and Credit Coin assets all come back. This is wrong. The query must include `network: networkContextService.getNetwork()` as a mandatory condition.

**`getAssetsByOriginator()`** queries by `{ originator }` only. Same problem — no network scoping. Must include `network` in the query.

**`getAsset()`** queries by `{ assetId }` only. In the multi-network world, the same real-world asset can be tokenized independently on Mantle and Credit Coin, producing two distinct asset documents with the same UUID but different network fields. The query for a specific asset must be `{ assetId, network }` to unambiguously identify which chain's version is being requested.

**`approveAsset()`** fetches the asset to generate attestation. Same single-field lookup issue — it should use the composite `{ assetId, network }` filter so that an admin approving on the Credit Coin context modifies the Credit Coin version of the asset, not the Mantle version.

In all of these cases, the fix is the same pattern: inject `NetworkContextService`, call `getNetwork()` at the start of the method, include the result as a filter condition in every MongoDB query that touches network-sensitive collections.

---

## Problem 4 — Registry Constants: Missing Credit Coin Tokens

**Where the code lives:** `packages/backend/src/modules/registry/registry.constants.ts`

**What it contains today:** Constants for `MANTLE_ASSET_ORIGINATION_TOKEN`, `STELLAR_ASSET_ORIGINATION_TOKEN`, `MANTLE_ADMIN_STRATEGY_TOKEN`, `STELLAR_ADMIN_STRATEGY_TOKEN`. No Arbitrum token, no Credit Coin token.

**What must be added:** `CREDITCOIN_ASSET_ORIGINATION_TOKEN` and `CREDITCOIN_ADMIN_STRATEGY_TOKEN` constants. Optionally `ARBITRUM_ASSET_ORIGINATION_TOKEN` and `ARBITRUM_ADMIN_STRATEGY_TOKEN` if the Arbitrum implementations exist and need routing. These constants are the strings that `ModuleRef.get(token)` uses to resolve the NestJS-injected instances of the Credit Coin strategy classes.

The naming convention matches the existing pattern: the network name in uppercase as a prefix, then the domain role, then `_TOKEN` as the suffix.

---

## Problem 5 — ModuleRegistryService: The isEvm Binary Branch Must Die

**Where the code lives:** `resolveServices()` in `module-registry.service.ts`

**What it does today:** It applies `const isEvm = networkType === MANTLE || networkType === ARBITRUM` and then uses `isEvm ? MANTLE_ADMIN_STRATEGY_TOKEN : STELLAR_ADMIN_STRATEGY_TOKEN` to pick the admin strategy token. This means every EVM chain (Mantle, Arbitrum, Credit Coin) maps to the Mantle implementation. Credit Coin on EVM would silently get Mantle's strategy, which calls Mantle's chain manager and Mantle's contracts. This would produce wrong transactions on the wrong chain.

**What must replace it:** A per-network map that is explicit about which token corresponds to which network. The startup resolution loop iterates over the enabled networks and for each one, looks up the correct pair of tokens (asset origination token and admin strategy token) from a static mapping table defined in the registry constants file. The mapping table entries are:
- `NetworkType.MANTLE` → `MANTLE_ASSET_ORIGINATION_TOKEN` and `MANTLE_ADMIN_STRATEGY_TOKEN`
- `NetworkType.STELLAR` → `STELLAR_ASSET_ORIGINATION_TOKEN` and `STELLAR_ADMIN_STRATEGY_TOKEN`
- `NetworkType.ARBITRUM` → (its own tokens when those implementations exist)
- `NetworkType.CREDITCOIN` → `CREDITCOIN_ASSET_ORIGINATION_TOKEN` and `CREDITCOIN_ADMIN_STRATEGY_TOKEN`

For any network where a token is not yet defined (because the implementation does not exist yet), the registry logs a warning and skips that entry rather than crashing. The implementation is only required for networks that are in `ENABLED_NETWORKS`.

---

## Problem 6 — ENABLED_NETWORKS Guard in the Middleware

**Where the code lives:** `packages/backend/src/modules/blockchain/middleware/network-context.middleware.ts`

**What it does today:** It validates the `X-Network` header value against `Object.values(NetworkType)` and throws a `BadRequestException` (400) if the value is not a recognized enum member. It does not check whether the recognized network is actually enabled in this deployment.

**What must be added:** After determining the network value is a valid `NetworkType`, the middleware must check whether the `ChainManagerRegistry` has a running manager for that network (or equivalently, check the `ENABLED_NETWORKS` env var). If the network is recognized but not enabled, the middleware must return a `ForbiddenException` (403) — not a 400. A 400 says "you sent bad data." A 403 says "this network is not available in this deployment." The distinction matters for frontend error handling.

The middleware should inject the `ChainManagerRegistry` and call `getEnabledNetworks()` to get the list of active networks. The validation order is: first check format validity (still a 400), then check enabled status (a 403).

---

## Problem 7 — The Decimal Logic That Hard-Codes Network by Name

Scattered through `AssetLifecycleService` (lines 565, 616, 648, 709, 737, 992) there are decimal precision conditionals that read `asset.network === 'stellar'` to choose between 7 and 6 (or 18) decimal places. This is the right approach for a stored document — reading the network field off the document is correct because the document knows which chain it belongs to. This code does not need to change.

However, the logic of "if not Stellar, then 6 or 18" silently assumes that every non-Stellar network uses the same decimal precision as Mantle. Credit Coin uses 6 decimal places for USDC (same as Mantle) and 18 for ERC-20 tokens (same as Mantle), so this assumption happens to be correct for Credit Coin. No change is required here for the immediate scope, but a future chain with different decimal conventions would require this logic to be extended. A note should be added to the relevant code location documenting this assumption so it is not silently wrong when the next chain is added.

---

## The Complete Flow After These Fixes

An originator on Credit Coin calls `POST /assets` with `X-Network: creditcoin` and their JWT.

The `NetworkContextMiddleware` runs first. It reads `creditcoin` from the header. It validates that `creditcoin` is a member of `NetworkType`. It checks that `creditcoin` is in the enabled networks list from `ChainManagerRegistry`. Both checks pass. It calls `networkContextService.runWithNetwork(NetworkType.CREDITCOIN, () => next())`. The `AsyncLocalStorage` now holds `NetworkType.CREDITCOIN` for the entire async execution chain of this request.

The `JwtAuthGuard` and `OriginatorGuard` run. Auth is network-agnostic — the guards check the JWT and the user's role without caring about which network the request is for.

The `AssetsController.uploadAsset()` method executes. It calls `this.assetService` (the lazy getter), which calls `moduleRegistryService.getAssetOriginationService()`. Inside that method, `networkContextService.getNetwork()` reads the `AsyncLocalStorage` and returns `NetworkType.CREDITCOIN`. The registry looks up the inner map for Credit Coin and returns the `CreditCoinAssetOriginationService` instance.

The controller calls `createAsset(req.user.walletAddress, dto, file)` on the `CreditCoinAssetOriginationService`. That service delegates to `assetLifecycleService.createAsset(walletAddress, dto, file)`.

Inside `AssetLifecycleService.createAsset()`, `networkContextService.getNetwork()` returns `NetworkType.CREDITCOIN`. The asset document is created with `network: 'creditcoin'`. The truth engine queue job is pushed. The notification is sent. The response returns. The asset is in MongoDB correctly tagged.

When the same originator calls `GET /assets` with `X-Network: creditcoin`, the `getAllAssets()` query includes `{ network: 'creditcoin', originator: walletAddress }`. Only their Credit Coin assets are returned. Their Mantle assets, if any, are invisible in this context — as intended.

---

## Implementation Sequence

This work has four steps, each of which can be done and verified independently.

**Step 1 — Constants and Token Map:** Add `CREDITCOIN_ASSET_ORIGINATION_TOKEN` and `CREDITCOIN_ADMIN_STRATEGY_TOKEN` to `registry.constants.ts`. Add a static `NETWORK_TOKEN_MAP` constant (also in the constants file or in a new `registry.token-map.ts` file in the registry folder) that maps each `NetworkType` to its pair of domain tokens. This step is purely additive — no existing behavior changes.

**Step 2 — ModuleRegistryService Refactor:** Replace the startup-time single-network resolution in `resolveServices()` with a loop over all networks in `ENABLED_NETWORKS`. For each network, use the `NETWORK_TOKEN_MAP` to find the correct tokens, resolve both implementations via `ModuleRef`, and store them in the nested map keyed by `NetworkType`. Inject `NetworkContextService` into the registry. Change `getAssetOriginationService()` and `getAdminDomainStrategy()` to call `networkContextService.getNetwork()` at call time. Add the nested map lookup and the graceful error for missing implementations. Verify that existing Mantle and Stellar behavior is unchanged with the appropriate `ENABLED_NETWORKS` setting.

**Step 3 — AssetLifecycleService Network Context:** Inject `NetworkContextService` into `AssetLifecycleService` constructor. Replace the `getConfiguredNetworkType()` call in `createAsset()` with `this.networkContextService.getNetwork()`. Add `network` as a filter condition in `getAllAssets()`, `getAssetsByOriginator()`, `getAsset()`, and `approveAsset()`. Remove the `getConfiguredNetworkType` import if it is no longer used elsewhere in this file. Verify that existing queries still return correct results for Mantle (because the context defaults to Mantle when no header is provided).

**Step 4 — Middleware ENABLED_NETWORKS Guard:** Inject `ChainManagerRegistry` into `NetworkContextMiddleware`. After the enum membership check, add the enabled-networks check. Return 403 with a clear message (`Network 'creditcoin' is not enabled in this deployment`) when the network is recognized but not enabled. Update the Swagger global parameter description to document this behavior.

---

## What Does Not Change

The `IAssetOriginationService` interface contract is unchanged. The controller code is unchanged. The queue job structure for the truth engine is unchanged. The MongoDB schema for the asset document is unchanged (the `network` field already exists on the schema per the multi-network schema evolution plan). The notification system is unchanged. The JWT auth flow is unchanged.

The only behavior difference visible to an existing Mantle deployment: `getAllAssets()` queries now include a `network: 'mantle'` filter. Existing Mantle documents that have been migrated by the schema migration script (which sets `network: 'mantle'` on all historical records) will continue to be returned correctly. Documents that predate the migration and have no `network` field will not be returned — this is the expected behavior once the migration has run. The migration must be run before deploying this code change.

---

## Files Modified

- `packages/backend/src/modules/registry/registry.constants.ts` — add Credit Coin tokens and the network-to-token map
- `packages/backend/src/modules/registry/services/module-registry.service.ts` — refactor to per-request resolution via `NetworkContextService`
- `packages/backend/src/modules/assets/services/asset-lifecycle.service.ts` — inject `NetworkContextService`, fix `createAsset()` network stamp, add network filter to all query methods
- `packages/backend/src/modules/blockchain/middleware/network-context.middleware.ts` — add ENABLED_NETWORKS guard, inject `ChainManagerRegistry`
- `packages/backend/src/modules/registry/context.md` — update to document per-request resolution model
- `packages/backend/src/modules/assets/context.md` — update to document that all queries are network-scoped