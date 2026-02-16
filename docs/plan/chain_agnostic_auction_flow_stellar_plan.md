# Chain-Agnostic Auction Flow — Stellar Analysis & Plan

**Author:** Architecture Planning
**Date:** February 16, 2026
**Scope:** Full audit of the auction lifecycle — origination (admin listing), bid placement, clearing price settlement, auction end, and token/refund claiming — through the Stellar lens. Identifies every coupling, architectural gap, and required change, then plans the work.

---

## Preamble: What Was Already Chain-Agnostic

Before documenting what is broken, it is important to acknowledge what already works correctly through the Stellar lens, established by previous phases:

**Auction Listing via Admin Strategy** — `StellarAdminStrategy.listOnMarketplace()` correctly handles both STATIC and AUCTION listing types. It routes through `NetworkRegistryService.listAssetOnMarketplace()` → `StellarBlockchainAdapter.listOnMarketplace()`, which passes the correct Soroban `Auction` listing type symbol. Price conversion from EVM's 18-decimal representation to Stellar's stroop format is handled. This path is complete and correct.

**Bid Placement Notify** — `BidTrackerService.notifyBid()` uses `BLOCKCHAIN_ADAPTER.verifyBidTransaction()`. The Stellar adapter's `verifyBidTransaction()` decodes `BidSubmitted` Soroban events. This path is chain-agnostic and complete.

**Settlement Notify (Win/Refund)** — `BidTrackerService.notifySettlement()` uses `BLOCKCHAIN_ADAPTER.verifyBidSettlement()`. The Stellar adapter's `verifyBidSettlement()` decodes `BidSettled` Soroban events. This path is chain-agnostic and complete.

**End Auction via Stellar Strategy** — `StellarAdminStrategy.endAuctionOnChain()` correctly calls `deactivateListingOnMarketplace` on the registry, then delegates DB settlement to `AssetLifecycleService`. This path exists and is correct.

---

## Part 1: The Critical Fault — `AuctionService` Is Fully EVM-Coupled

This is the single most important finding. `AuctionService` is the class that the admin controller actually calls for both creating and ending auctions. It is entirely bypassed by the admin strategy pattern. And it directly injects and calls `BlockchainService` — the legacy EVM service.

The admin controller at `POST /admin/assets/auctions/create` calls `auctionService.createAuction()`. That method calls `this.blockchainService.listOnMarketplace()`. On a Stellar deployment, this crashes because the EVM `BlockchainService` is not configured for Stellar.

The admin controller at `POST /admin/assets/auctions/end` calls `auctionService.calculateAndEndAuction()`. That method calls `this.blockchainService.endAuction()`. Same crash.

There are therefore TWO parallel paths for auction creation and ending, and the one actually wired to the API endpoints is the broken one:

**Path A (admin strategy — correct, not wired to the auction-specific API endpoints):**
- Create: `StellarAdminStrategy.listOnMarketplace()` → registry → `StellarBlockchainAdapter.listOnMarketplace()`
- End: `StellarAdminStrategy.endAuctionOnChain()` → registry → `StellarBlockchainAdapter.deactivateListing()`

**Path B (AuctionService — legacy, wired to the API endpoints, EVM-only):**
- Create: `AuctionService.createAuction()` → `BlockchainService.listOnMarketplace()`
- End: `AuctionService.calculateAndEndAuction()` → `BlockchainService.endAuction()`

The fix is not to create a third path. It is to redirect `AuctionService` to use Path A's infrastructure. The `AuctionService` itself has genuine value — it owns the Dutch auction clearing price calculation algorithm, which is business logic that should not live in the strategy. That algorithm stays. Only the on-chain dispatch must change.

---

## Part 2: The `endAuction` Method Is Not on the Adapter Interface

The `BlockchainAdapter` interface defines: `registerAsset`, `revokeAsset`, `deployToken`, `listOnMarketplace`, `verifyPurchaseTransaction`, `verifyBidTransaction`, `verifyBidSettlement`, `registerIdentity`, `isVerified`, and optionally `approveTrustline`. There is no `endAuction` or `deactivateListing` method on the interface.

The `NetworkRegistryService.deactivateListingOnMarketplace()` method works around this by using a runtime duck-type check: it checks if the adapter object has a `deactivateListing` property and casts to `any`. This is a type safety hole — if the EVM adapter happens not to have this method (which it currently doesn't — the EVM adapter as implemented does not have `endAuction` or `deactivateListing`), the registry silently returns a skipped result rather than completing the auction end.

Digging further: the EVM adapter (`evm-blockchain.adapter.ts`) does NOT currently implement `endAuction`. The method only exists on the legacy `BlockchainService`. The EVM adapter is incomplete for the auction-end operation. Only the Stellar adapter has `deactivateListing`.

This means **the EVM path for `StellarAdminStrategy` equivalent (MantleAdminStrategy) also has a gap**: `MantleAdminStrategy.endAuctionOnChain()` calls `this.blockchainService.endAuction()` directly instead of going through the adapter — because the adapter doesn't have the method yet.

The fix requires:
1. Adding `endAuction(tokenIdentifier: string, clearingPrice: string): Promise<{ txId: string }>` to the `BlockchainAdapter` interface
2. Implementing it in the EVM adapter by extracting the logic from `BlockchainService.endAuction()`, adapting it to use `tokenAddress` instead of `assetId` (since the adapter works with token identifiers, not platform UUIDs)
3. The Stellar adapter maps `endAuction` → calls `deactivateListing` internally (clearing price is not sent on-chain in Stellar — it is handled in the DB settlement layer above)
4. `NetworkRegistryService` gets a properly typed `endAuctionOnMarketplace(tokenIdentifier, clearingPrice)` method replacing the duck-type workaround
5. `MantleAdminStrategy.endAuctionOnChain()` is updated to call the registry instead of `BlockchainService` directly

---

## Part 3: The `AuctionService.createAuction()` Architectural Question

Currently `AuctionService.createAuction()` takes a `CreateAuctionDto` with `assetId`, `reservePrice`, and `duration`, then calls `blockchainService.listOnMarketplace()` with `'AUCTION'` as the listing type. This endpoint exists in parallel to the admin strategy path.

The admin strategy's `listOnMarketplace()` reads the listing type and pricing from the asset document itself (`asset.listing.type`, `asset.tokenParams.pricePerToken`) and the DTO only carries `duration`. The `AuctionService.createAuction()` takes `reservePrice` from the DTO and reads `minPrice` from `asset.listing.priceRange.min`.

The redundancy needs to be resolved. The correct architecture has **one** path for listing an asset, and that path goes through the admin domain strategy. The admin controller currently has TWO separate auction-specific endpoints:
- `POST /admin/assets/auctions/create` (calls `AuctionService`)
- `POST /admin/assets/{assetId}/list` (calls strategy via `moduleRegistryService`)

The plan is to make `AuctionService.createAuction()` delegate to the admin strategy rather than calling `BlockchainService` directly. The auction-specific API endpoint continues to exist for backward compatibility, but its implementation routes through the strategy. The `reservePrice` from the DTO becomes an override for `asset.listing.priceRange.min` if provided.

This means `AuctionService` will need to inject the `ModuleRegistryService` to get the active admin strategy for the current network, and delegate the on-chain call to `strategy.listOnMarketplace()`.

---

## Part 4: `AuctionService.calculateAndEndAuction()` — The Fix

The clearing price calculation algorithm in `calculateAndEndAuction()` is pure business logic: it fetches all bids sorted by price descending, accumulates token demand, and finds the price at which cumulative demand meets total supply. This is a Dutch auction clearing mechanism and must remain in `AuctionService`.

What must change is only the on-chain dispatch. After computing `clearingPrice`, instead of calling `blockchainService.endAuction(assetId, clearingPrice)`, the service must call the active strategy's `endAuctionOnChain(assetId, clearingPrice)`.

The strategy then:
- On Mantle: calls the adapter's `endAuction(tokenAddress, clearingPrice)` which sets the clearing price in the EVM PrimaryMarket contract
- On Stellar: calls the adapter's `endAuction(tokenIdentifier, clearingPrice)` which calls `deactivateListing` on the Soroban contract and passes `clearingPrice` to `AssetLifecycleService.endAuction()` for the DB settlement record

This is exactly what the admin strategies already implement — `AuctionService` just needs to call them instead of bypassing them.

---

## Part 5: The Portfolio Update Gap in Auction Settlement

When `BidTrackerService.notifySettlement()` processes a winning bidder's settlement, it creates a `Purchase` record. But it does NOT call `userPortfolioService.updateOnPurchase()`. This is an inconsistency — the static purchase path (`PurchaseTrackerService.notifyPurchase()`) was already updated to call `updateOnPurchase()`, but the auction settlement path was not.

An investor who wins an auction will have their purchase recorded in the database but their portfolio document will not be updated. The next time they load their portfolio, the `UserPortfolioService.getPortfolio()` call would rebuild from the persistent document which is stale.

The fix is straightforward: inject `UserPortfolioService` into `BidTrackerService` and call `updateOnPurchase(purchase, asset.network)` after line 358 in `notifySettlement()` — the point where the purchase record is created for auction winners. The call is wrapped in the same try-catch pattern used in `notifyPurchase()` so a portfolio update failure never blocks the settlement itself.

---

## Part 6: The `Bid` Schema Network Field

Every `Bid` document records a bidder's wallet, the token amount, and the transaction hash — but not which chain the bid was placed on. This creates the same explorer link and portfolio-building gap that the Purchase schema has.

The `Bid` schema gains a `network` field (optional string, indexed) with the same backward-compatibility rule: existing records without the field are treated as `mantle` by all consumers.

`BidTrackerService.notifyBid()` populates the `network` field from the active deployment config when creating the bid record.

The `settlementTxHash` field on the Bid document is also a network-agnostic transaction identifier. Its field name is already generic (not called `evmSettlementHash`), so no renaming is needed. The documentation comment is updated to note it accepts both EVM and Stellar hash formats.

---

## Part 7: The Auction Settlement Purchase Record Network Field

In `BidTrackerService.notifySettlement()`, the purchase record created for auction winners does not populate the `network` field. After the `network` field is added to the Purchase schema (per the static models plan), this create call must be updated to include `network: asset.network || 'mantle'`.

This is a one-line addition identical to what was done in `PurchaseTrackerService.notifyPurchase()`.

---

## Part 8: Stellar Price Scaling — Invariant Verification Requirement

The `StellarAdminStrategy.listOnMarketplace()` converts the EVM-format price to Stellar's stroop format by dividing by `10^10`. This means the price stored in the Soroban `PrimaryMarket` contract for auction listings is in Stellar's unit system.

When a bid is placed on Stellar and `verifyBidTransaction()` decodes the `BidSubmitted` Soroban event, it returns the price and token amount as the values in the event. If the Soroban contract stores bid prices in Stellar's unit system (post-conversion), the returned `price` value would be in that system, not in the canonical 6-decimal USDC form that `BidTrackerService` expects.

`BidTrackerService.notifyBid()` computes:
```
usdcDeposited = (price * tokenAmount) / 10^18
```

This assumes `price` is in 6-decimal USDC per 18-decimal token unit. If Stellar returns Stellar-format values, this calculation will be wrong by a factor of `10^10`.

This is a critical invariant that the Soroban contract implementation must satisfy. The `PrimaryMarket` Soroban contract must emit `BidSubmitted` events with:
- `tokenAmount` in 18-decimal canonical form
- `price` in 6-decimal canonical USDC form

If the Soroban contract is designed with Stellar-native (7-decimal) amounts, the `StellarBlockchainAdapter.verifyBidTransaction()` must perform the normalization — multiplying token amounts by `10^11` to go from 7 to 18 decimals, and multiplying USDC price by `10^2`... but this isn't quite right either because the units interact.

**The resolution:** The plan mandates that the Soroban PrimaryMarket contract be written to store and emit prices and amounts in the same 18/6 canonical convention as the EVM contracts. The `STELLAR_PRICE_DIVISOR` conversion in `StellarAdminStrategy.listOnMarketplace()` must be matched by a corresponding inverse conversion when reading bid events. If the contract stores prices as `EVM_price / 10^10`, then the adapter must multiply back by `10^10` when reading bid events, to restore the canonical 6-decimal USDC form.

The plan documents this as a required verification step: before any Stellar auction goes live, verify that `(evtPrice × 10^10) / 10^6` equals the expected human-readable price in USDC. If it does, add the `× 10^10` normalization to `verifyBidTransaction()` and `verifyBidSettlement()` in the Stellar adapter. If the contract was designed differently, adjust accordingly. This verification step is documented as a mandatory pre-production check.

---

## Part 9: The Auction Status Processor

The announcement module contains an `AuctionStatusProcessor` that runs a background BullMQ job to check auction status, trigger live announcements, and process auction endings. Based on the grep results, it calls announcement service methods that are purely database and notification operations — no direct blockchain calls were found in the searched results.

This processor is assessed as already chain-agnostic. Its role is to detect that an auction's time window has passed and trigger the `announcements` flow. If it calls `calculateAndEndAuction()` or any on-chain operation, those calls would be affected by Part 4's fix. A full read of the processor is recommended before implementation to confirm no hidden on-chain calls exist.

---

## Part 10: Summary of Changes Required

### Must Fix (Blocking for Stellar Auctions)

**`blockchain-adapter.interface.ts`**
Add `endAuction(tokenIdentifier: string, clearingPrice: string): Promise<{ txId: string }>` to the interface. Remove or formalize `approveTrustline` as a properly optional method with a documented fallback signature.

**`evm-blockchain.adapter.ts`**
Implement `endAuction(tokenIdentifier, clearingPrice)` by extracting the `endAuction` logic from `BlockchainService`. The EVM adapter receives the EVM token address (not assetId) as `tokenIdentifier`, and converts the UUID-based assetId lookup internally (or the calling layer passes both — needs decision). The bytes32 encoding of assetId for the EVM contract call moves into the adapter from `BlockchainService`.

**`stellar-blockchain.adapter.ts`**
Implement `endAuction(tokenIdentifier, clearingPrice)` by calling `deactivateListing(tokenIdentifier)` internally. The `clearingPrice` parameter is intentionally unused at the on-chain level for Stellar — the Soroban contract just deactivates the listing. The clearing price is passed to the DB layer above via the strategy. The existing `deactivateListing()` method becomes private (implementation detail of the adapter).

**`network-registry.service.ts`**
Add `endAuctionOnMarketplace(tokenIdentifier: string, clearingPrice: string)` method, replacing the duck-type `deactivateListingOnMarketplace()` method. Feature flag check: `marketplace`.

**`auction.service.ts`**
Replace `BlockchainService` injection with `ModuleRegistryService` injection. Rewrite `createAuction()` to delegate the on-chain call to `strategy.listOnMarketplace()`. Rewrite `calculateAndEndAuction()` to keep the clearing price algorithm but delegate the on-chain call to `strategy.endAuctionOnChain(assetId, clearingPrice)`.

**`mantle-admin-strategy.service.ts`**
Update `endAuctionOnChain()` to call `networkRegistryService.endAuctionOnMarketplace()` instead of `blockchainService.endAuction()`. This removes the last `BlockchainService` usage in the Mantle strategy.

### Should Fix (Data Completeness)

**`bid.schema.ts`**
Add `network` field (optional string, indexed). Same backward-compat rule as Purchase schema.

**`bid-tracker.service.ts`** (notifyBid)
Populate `network` field from config when creating bid record.

**`bid-tracker.service.ts`** (notifySettlement)
Populate `network` field on the purchase record created for auction winners. Add `userPortfolioService.updateOnPurchase()` call after purchase creation.

**`bid-tracker.service.ts`** (constructor)
Inject `UserPortfolioService`.

### Verify (Invariant Check, Not Code Change)

**Stellar price scaling for bids**
Verify the `PrimaryMarket` Soroban contract emits bid amounts and prices in the canonical 18-decimal token / 6-decimal USDC format that the backend expects. If it emits Stellar-format values (post-conversion from the `STELLAR_PRICE_DIVISOR` applied on listing), add the inverse normalization to `verifyBidTransaction()` and `verifyBidSettlement()` in the Stellar adapter.

---

## Part 11: What Does NOT Need to Change

**`StellarAdminStrategy`** — The Stellar admin strategy is correct. `endAuctionOnChain()` already calls `deactivateListingOnMarketplace` (which will be replaced by the properly typed `endAuctionOnMarketplace`) and delegates DB settlement to `AssetLifecycleService`. Only a method name update is needed.

**`AssetLifecycleService.endAuction()`** — The DB-level auction settlement logic is already network-agnostic. No changes needed.

**`BidTrackerService.notifyBid()` and `notifySettlement()` core logic** — The verification calls already use the adapter and are chain-agnostic. Only the portfolio update and `network` field population are missing.

**Auction status processor (assumed)** — Announcement and DB-level status checks appear chain-agnostic. Verify before implementation.

**DTOs** — The bid and settlement DTOs already have `txHash` as a plain string without EVM-specific validation. The multi-format validation from the static models plan should be applied here too, but no structural DTO changes are needed.

---

## Part 12: context.md Requirements

The following context files must be read before modifying and updated after modifying:

- `modules/marketplace/context.md` — Update to document the auction service's delegation to admin strategy, the `network` field on Bid records, and the portfolio update in settlement
- `modules/blockchain/adapters/evm/context.md` — Document the new `endAuction` method
- `modules/blockchain/adapters/stellar/context.md` — Document the `endAuction` implementation (calls `deactivateListing` internally) and the price scaling invariant requirement
- `modules/admin/implementations/mantle/context.md` — Document the removed `BlockchainService` dependency and the routing to `NetworkRegistryService`

---

## Part 13: Implementation Sequence

Work is ordered so that each step is independently deployable and the Mantle deployment remains working throughout.

**Step 1 — Extend the adapter interface**
Add `endAuction` to `BlockchainAdapter`. At this point the EVM adapter and Stellar adapter no longer fully implement the interface — this gives a deliberate compile-time signal to track remaining work.

**Step 2 — Implement `endAuction` in EVM adapter**
Extract the logic from `BlockchainService.endAuction()`. The EVM adapter needs to accept both a token address and the clearing price. The bytes32 encoding of the assetId was inside `BlockchainService.endAuction()` — that logic must be moved to the adapter. Verify that existing Mantle auction end operations work identically through the adapter.

**Step 3 — Implement `endAuction` in Stellar adapter**
Map `endAuction` to the existing `deactivateListing` call. The `deactivateListing` method becomes private. No behavior change on Stellar.

**Step 4 — Update `NetworkRegistryService`**
Add `endAuctionOnMarketplace()` with proper typing. Remove the duck-type `deactivateListingOnMarketplace()` or keep it as a deprecated alias temporarily.

**Step 5 — Fix `MantleAdminStrategy.endAuctionOnChain()`**
Replace `blockchainService.endAuction()` with `networkRegistryService.endAuctionOnMarketplace()`. Verify Mantle end-auction flow works.

**Step 6 — Fix `AuctionService.calculateAndEndAuction()`**
Replace `blockchainService.endAuction()` with `strategy.endAuctionOnChain()`. The clearing price algorithm stays untouched. Inject `ModuleRegistryService` instead of `BlockchainService`.

**Step 7 — Fix `AuctionService.createAuction()`**
Delegate the on-chain call to `strategy.listOnMarketplace()`. The `reservePrice` from the DTO is applied as an override on the asset's listing price range before delegation. Remove `BlockchainService` injection from `AuctionService` entirely — both methods are now delegating to the strategy.

**Step 8 — Add `network` field to `Bid` schema**

**Step 9 — Update `BidTrackerService`**
Add `network` population in `notifyBid()`. Add `network` population and `updateOnPurchase()` call in `notifySettlement()`. Inject `UserPortfolioService`.

**Step 10 — Verify Stellar price scaling**
Test against deployed Soroban contracts. Apply normalization in adapter if needed.

**Step 11 — Update context.md files**

---

## Part 14: Invariants

- The clearing price calculation algorithm is and must remain pure business logic in `AuctionService`. It has no network dependency — it is arithmetic on bid records. It must never be moved to an adapter.
- `AuctionService` must never directly import or call `BlockchainService`, `viem`, or `@stellar/stellar-sdk` after this plan is implemented. All network interactions must flow through the strategy or registry layer.
- The `endAuction` method on the Stellar adapter does not call any DB layer. The clearing price is handled by `AssetLifecycleService` in the strategy layer above. The adapter's job is only the on-chain deactivation.
- On EVM, the clearing price IS sent on-chain as part of the `endAuction` contract call. On Stellar, it is not — only a deactivation signal is sent. Both paths result in the same DB state through `AssetLifecycleService.endAuction()`.
- The `network` field on `Bid` documents follows the same backward-compat rule as `Purchase`: missing = `mantle`.
