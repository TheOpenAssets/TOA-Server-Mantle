# Registry Module Context

## Responsibilities
This module is the central service registry for multi-network domain implementations. It resolves which concrete implementation of a domain service (e.g. `IAssetOriginationService`) to use for the current HTTP request, based on the `X-Network` header carried in the request's `AsyncLocalStorage` context.

## Core Components

### `ModuleRegistryService`
- **Startup phase (`onModuleInit`):** Reads `ENABLED_NETWORKS` from config (falls back to `network.networkType`, then `mantle`). For each enabled network, looks up the pair of NestJS injection tokens from `NETWORK_TOKEN_MAP` and resolves the concrete implementation via `ModuleRef`. Results are stored in a nested map: `Map<NetworkType, Map<domainToken, implementation>>`. If a token cannot be resolved (implementation not loaded), a warning is logged and the entry is skipped — no crash.
- **Request phase (`getAssetOriginationService`, `getAdminDomainStrategy`, `getService`):** Reads the current network from `NetworkContextService.getNetwork()` (backed by `AsyncLocalStorage`). Looks up the inner map for that network and returns the registered implementation. If no implementation is found for the requested network, throws an error (the controller translates this to 503).

## Public Interface
- `getAssetOriginationService(): IAssetOriginationService` — returns the asset origination impl for the current request's network
- `getAdminDomainStrategy(): IAdminDomainStrategy` — returns the admin strategy impl for the current request's network
- `getService<T>(token: string): T` — generic resolver by domain token and current network

## Invariants
- The `implementationMap` is populated once at startup and is read-only at request time.
- Only networks listed in `ENABLED_NETWORKS` (or the fallback) are populated in the map at startup.
- All per-request lookups use `AsyncLocalStorage` via `NetworkContextService` — never `process.env`.
- Missing implementations for a network cause a warn-and-skip at startup, not a crash. They cause a thrown error at request time.

## Dependencies
- `NetworkContextService` (from `BlockchainModule`) — per-request network context via `AsyncLocalStorage`
- `ConfigService` — reads `ENABLED_NETWORKS` at startup
- `ModuleRef` — resolves NestJS-injected instances by token
- `NETWORK_TOKEN_MAP` in `registry.constants.ts` — maps `NetworkType` → domain token pair

## Constants (`registry.constants.ts`)
- Domain role tokens: `ASSET_ORIGINATION_SERVICE`, `ADMIN_DOMAIN_STRATEGY`
- Per-network implementation tokens: `MANTLE_*`, `STELLAR_*`, `ARBITRUM_*`, `CREDITCOIN_*`
- `NETWORK_TOKEN_MAP` — static mapping from `NetworkType` to its pair of domain tokens; this is the authoritative routing table for the registry
