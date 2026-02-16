# User Portfolio — Persistent Schema & Runtime Type Plan

**Author:** Architecture Planning
**Date:** February 16, 2026
**Scope:** Defining a persistent MongoDB portfolio schema for each user and a runtime portfolio type that the portfolio service inflates at query time and delivers to the frontend.

---

## Preamble: The Problem With the Current Approach

The current `PurchaseTrackerService.getInvestorPortfolio()` method builds the entire portfolio from scratch on every API call. It reads all purchases, iterates through them to build a per-asset map, then asynchronously enriches each asset entry with a separate settlement query, a yield claim query, and finally a full leverage positions fetch. For a user with 10 assets and 50 purchases, this is potentially 30 to 40 database round trips per portfolio page load.

More critically, the portfolio has no memory. There is no persistent record of what a user holds. This makes the following impossible without re-aggregating from scratch every time: showing a user's total portfolio value, computing P&L over time, generating a historical snapshot at a given date, filtering positions by network, and providing a fast dashboard summary that does not require loading every position in full detail.

The fix is a two-layer architecture. The first layer is a persistent `UserPortfolio` document in MongoDB — compact, reference-rich, and updated event-driven whenever a relevant action occurs. This document is the ground truth for what a user holds and provides cached aggregate numbers for fast dashboard loads. The second layer is a runtime portfolio type that the portfolio service builds by populating the references in the persistent document, enriching each holding with live yield calculations and formatted display values, and returning the full shape the frontend needs.

---

## Part 1: Understanding What Belongs in the Persistent Document

A portfolio document must serve two purposes simultaneously. First, it must answer the question "what does this user hold right now?" without querying every other collection. Second, it must be the index from which full position details can be fetched efficiently via targeted lookups rather than full collection scans.

This means the document is neither fully denormalized (it does not copy all asset metadata into itself) nor a bare list of IDs (it holds enough cached state to render a dashboard summary card without additional queries). It is a deliberately designed middle layer.

The persistent document anchors itself to a single wallet address and contains three sections: the holdings registry, cached aggregate totals, and a short recent-activity tail.

---

## Part 2: The Holdings Registry — Core of the Schema

The holdings registry is an array of `PortfolioHolding` sub-documents. There is one entry per unique asset per position type. A user who bought the same asset on the primary market and also has an active leverage position on that same asset will have two separate holding entries for it — one with type `STATIC`, one with type `LEVERAGE`.

Each holding entry carries:

**Identity fields** — what the holding is and where it lives:
- The asset's UUID (`assetId`) as the primary business key
- The token address or identifier as an opaque string (this is a 0x EVM address for Mantle, a `CODE:ISSUER` Stellar asset string for Stellar — the portfolio schema does not interpret this)
- The network this holding lives on (`mantle` or `stellar`), so cross-network users (if they exist) can filter their holdings by chain
- The holding type: one of `STATIC`, `LEVERAGE`, or `SOLVENCY`

**Reference fields** — MongoDB ObjectIds pointing to the source-of-truth documents for this holding:
- For `STATIC` holdings: an array of Purchase document ObjectIds covering all purchase records for this asset by this user, plus the ObjectId of the latest YieldClaim document (if any yield has been claimed)
- For `LEVERAGE` holdings: a single ObjectId pointing to the LeveragePosition document
- For `SOLVENCY` holdings: a single ObjectId pointing to the SolvencyPosition document

The reference arrays exist so the portfolio service can do a single `find({ _id: { $in: purchaseIds } })` lookup to get all purchase records, rather than a full collection scan filtered by investorWallet and assetId.

**Cached state fields** — the values that allow the dashboard summary to render without additional queries:
- `tokenBalance`: the current net token balance in canonical 18-decimal string form (net of all purchases, sales, burns, and escrow locks)
- `totalInvested`: cumulative USDC spent in canonical 6-decimal string form (net of secondary market recoveries)
- `status`: the rolled-up status of this holding — `ACTIVE` (holding tokens, no settlement), `YIELD_CLAIMABLE` (settlement has been distributed, tokens can be burned), `CLAIMED` (tokens burned and yield received), `SETTLED` (leverage position settled), `LIQUIDATED` (position liquidated)
- `lastActivityAt`: timestamp of the most recent transaction affecting this holding
- `firstEntryAt`: timestamp of the first transaction

These cached values are the denormalized data the dashboard needs to show the summary card: "You hold 1,250.00 tokens of Invoice #INV-2024-001, invested $1,250.00, yield claimable."

---

## Part 3: Cached Aggregate Totals

Above the holdings array, the document stores top-level aggregate numbers computed from the holdings entries. These are the numbers that power the portfolio header: total value invested, total yield received, position counts.

The aggregate section contains:
- `totalUSDCInvested`: sum of `totalInvested` across all non-SOLVENCY holdings, in 6-decimal string form
- `totalYieldReceived`: sum of USDC received across all completed YieldClaim records linked from holdings, in 6-decimal string form
- `totalActivePositions`: count of holdings whose status is `ACTIVE` or `YIELD_CLAIMABLE`
- `totalCompletedPositions`: count of holdings whose status is `CLAIMED`, `SETTLED`, or `LIQUIDATED`
- `totalActiveLeveragePositions`: count of LEVERAGE type holdings with status `ACTIVE`
- `totalActiveSolvencyPositions`: count of SOLVENCY type holdings with status `ACTIVE`
- `networks`: an array of network strings this user has holdings on (`['mantle']`, `['stellar']`, or `['mantle', 'stellar']` for cross-network users)

---

## Part 4: Recent Activity Tail

The third section is a short tail of recent transaction references for quick activity feed rendering without loading full transaction history. This is a capped array of the last 20 transactions, each containing:

- The transaction identifier (`txHash` / Stellar transaction hash) as a string
- The holding type and source (PRIMARY_MARKET purchase, LEVERAGE harvest, SOLVENCY repayment, etc.)
- The asset UUID
- The amount as a string
- The timestamp

This tail is maintained as a LIFO array with the most recent entry first. When a new transaction is recorded, it is prepended and any entries beyond position 20 are dropped. This gives the activity feed endpoint a sub-millisecond response time — it reads from a single document field rather than querying the Purchase or event collections.

---

## Part 5: Concurrency and Update Strategy

The portfolio document must stay consistent with the underlying purchase, leverage, and solvency documents. There are two events that trigger updates:

**Synchronous updates during the notify path** — When `notifyPurchase` successfully records a new purchase, it must update the portfolio document atomically as part of the same logical operation. The portfolio service exposes an internal method that receives the purchase details and performs an atomic MongoDB `$set` / `$push` / `$inc` operation on the portfolio document. The `findOneAndUpdate` with `upsert: true` pattern handles the first-ever portfolio creation automatically. No separate creation step is needed.

The atomic update does three things: it upserts a holding entry for the (assetId, holdingType) pair, updating cached balance and investment fields using BigInt arithmetic on the server side; it increments the relevant aggregate totals; and it prepends to the recent activity tail.

**Event-driven updates** — Leverage harvest events, solvency repayments, yield distributions, and P2P trade settlements all arrive through the BullMQ event processor. The EventProcessor, after updating its respective domain document (LeveragePosition, SolvencyPosition, etc.), will call the portfolio service's update method to propagate the change into the portfolio document. Since these events are processed asynchronously in a queue, eventual consistency is acceptable — the portfolio document may be up to a few seconds behind the actual domain document during bursts.

**Rebuild-on-demand** — A portfolio document that becomes corrupt or falls out of sync can be regenerated from scratch by reading all Purchase, LeveragePosition, and SolvencyPosition records for the user and recomputing the entire document. This rebuild is exposed as an internal admin endpoint (`POST /admin/portfolio/rebuild/:walletAddress`) and is never called in normal flow. It is the escape hatch.

---

## Part 6: The Runtime Portfolio Type

The runtime portfolio type is a TypeScript interface (not a schema) that defines the shape the portfolio service returns to the frontend. It is built at query time by populating the persistent document's references and enriching the data.

The runtime type has four sections:

**Summary** — the aggregate totals from the persistent document, already computed, requiring zero additional queries:
- `walletAddress`
- `totalUSDCInvested` (formatted as "$12,500.00")
- `totalYieldReceived` (formatted as "$750.00")
- `totalActivePositions`
- `totalCompletedPositions`
- `networks`
- `lastUpdated`

**Holdings** — array of `RuntimeHolding` objects, one per persistent holding entry, enriched with:
- Full asset metadata fetched via a single batched `find({ assetId: { $in: allAssetIds } })` — invoice number, buyer name, industry, risk tier, asset type
- For STATIC holdings: the full transaction history, built from populating the purchase ObjectIds in a single batched fetch, then running the same running-balance calculation that currently lives in `getInvestorPortfolio()`. The yield calculation is also performed here — fetching the settlement document for the asset and computing claimable yield from the cached `tokenBalance`, settlement USDC amount, and total sold supply.
- For LEVERAGE holdings: the full leverage position document populated from its ObjectId reference, including health factor, harvest history, collateral details, and settlement or liquidation outcomes. This is a single document fetch by ObjectId — no collection scan.
- For SOLVENCY holdings: the full solvency position document, including repayment schedule, partner loan details, and health metrics.

All numeric values in `RuntimeHolding` have both a raw canonical form (the 18/6-decimal string from the persistent document) and a formatted display value (human-readable, e.g., `"1,250.00 tokens"` or `"$750.00 USDC"`).

**Activity Feed** — the recent activity tail from the persistent document, already computed, zero additional queries. Each entry includes a human-readable label for the transaction type.

**Network Context** — the active network for this portfolio deployment, drawn from the request's JWT `network` claim, included so the frontend knows how to render token addresses and transaction explorer links.

---

## Part 7: Where the Portfolio Module Lives

A dedicated `UserPortfolioModule` is the right home. It lives at `packages/backend/src/modules/user-portfolio/` and follows the same structure as other domain modules: schema, service, controller, DTO, and context.md.

The module imports the Mongoose schema registrations for `Purchase`, `Asset`, `Settlement`, `YieldClaim`, `LeveragePosition`, and `SolvencyPosition` — it needs read access to all of them for the runtime population step.

The `UserPortfolioModule` exports its service so that `MarketplaceModule` (which handles the notify path) can call `portfolioService.updateOnPurchase()` during `notifyPurchase`, and so the EventProcessor in the BlockchainModule can call `portfolioService.updateOnLeverageEvent()` and `portfolioService.updateOnSolvencyEvent()`.

The existing `GET /marketplace/portfolio` endpoint on `MarketplaceController` will be superseded by `GET /portfolio` on a new `UserPortfolioController`. The old endpoint will remain but delegate internally to the new service during the transition, then be deprecated.

---

## Part 8: The UserPortfolio Schema — Field Inventory

The Mongoose schema document contains:

- `walletAddress` — string, unique, indexed — primary key for all portfolio lookups
- `network` — string enum (`mantle` | `stellar`) — the deployment network for this portfolio document (one document per user per network on multi-network deployments, or a single document if the platform is single-network)
- `holdings` — array of `PortfolioHolding` sub-documents (see Part 2 above)
- `totals` — embedded object with the aggregate numbers from Part 3
- `recentActivity` — capped array (max 20) of recent transaction stubs from Part 4
- `lastUpdated` — Date, updated on every atomic write
- `version` — number, incremented on every write — used by the rebuild endpoint to detect stale data

Schema-level indexes: `(walletAddress, network)` as a compound unique index, plus an index on `holdings.assetId` for queries that need to find which users hold a specific asset.

---

## Part 9: The PortfolioHolding Sub-Document — Field Inventory

- `assetId` — string, indexed
- `tokenIdentifier` — string — opaque token address or Stellar asset string
- `network` — string — which chain this holding is on
- `holdingType` — enum: `STATIC` | `LEVERAGE` | `SOLVENCY`
- `status` — enum: `ACTIVE` | `YIELD_CLAIMABLE` | `CLAIMED` | `SETTLED` | `LIQUIDATED`
- `tokenBalance` — string — canonical 18-decimal net balance
- `totalInvested` — string — canonical 6-decimal net investment
- `purchaseIds` — array of ObjectIds (only for STATIC type)
- `leveragePositionId` — ObjectId (only for LEVERAGE type)
- `solvencyPositionId` — ObjectId (only for SOLVENCY type)
- `latestYieldClaimId` — ObjectId or null — most recent yield claim for this holding
- `firstEntryAt` — Date
- `lastActivityAt` — Date

---

## Part 10: Files to Create

- `packages/backend/src/modules/user-portfolio/user-portfolio.module.ts` — Module declaration importing all needed schemas and exporting `UserPortfolioService`
- `packages/backend/src/modules/user-portfolio/schemas/user-portfolio.schema.ts` — Mongoose schema for the persistent document
- `packages/backend/src/modules/user-portfolio/services/user-portfolio.service.ts` — Service with `getPortfolio()`, `updateOnPurchase()`, `updateOnLeverageEvent()`, `updateOnSolvencyEvent()`, `updateOnYieldClaim()`, and `rebuildPortfolio()`
- `packages/backend/src/modules/user-portfolio/controllers/user-portfolio.controller.ts` — Controller exposing `GET /portfolio` (authenticated) and `GET /portfolio/summary` for the dashboard header
- `packages/backend/src/modules/user-portfolio/dto/portfolio-response.dto.ts` — The runtime portfolio type as a class with `@ApiProperty` swagger annotations
- `packages/backend/src/modules/user-portfolio/context.md` — Module documentation per the mandatory context.md rule

---

## Part 11: Files to Modify

- `packages/backend/src/modules/marketplace/services/purchase-tracker.service.ts` — After recording a purchase, call `userPortfolioService.updateOnPurchase()` to keep the portfolio document current
- `packages/backend/src/modules/blockchain/processors/event.processor.ts` — After processing leverage and solvency events, call the relevant portfolio update methods
- `packages/backend/src/app.module.ts` — Import `UserPortfolioModule`
- `packages/backend/src/modules/marketplace/controllers/marketplace.controller.ts` — Deprecate the old `GET /portfolio` endpoint or redirect it to the new service
- `packages/backend/src/modules/marketplace/context.md` — Note that portfolio management is now delegated to `UserPortfolioModule`

---

## Part 12: Implementation Sequence

**Step 1 — Define the schema**
Write the Mongoose schema for `UserPortfolio` and `PortfolioHolding` sub-document. Register it in the new module. No service logic yet. Confirm the schema compiles correctly.

**Step 2 — Write the update methods**
Implement `updateOnPurchase()` — the atomic upsert that keeps the portfolio document consistent with a new purchase record. This is the most critical method and must handle the first-time creation (no existing portfolio document) and the update (existing document). Use BigInt for all arithmetic. Test with the existing purchase data to confirm balances compute correctly.

**Step 3 — Write the runtime build method**
Implement `getPortfolio()` — the method that takes the persistent document, batches all necessary lookups, enriches each holding, and returns the full `RuntimePortfolio` shape. This method should be the replacement for the logic currently in `PurchaseTrackerService.getInvestorPortfolio()`. The existing logic can be migrated directly — the running balance calculation, yield computation, leverage enrichment, and notification metadata assembly all move here.

**Step 4 — Wire the update calls**
Modify `notifyPurchase`, `notifyYieldClaim`, the event processor's leverage handling, and the solvency position handlers to call the appropriate portfolio update method after their own work succeeds.

**Step 5 — Expose the API**
Write the controller and DTOs. Connect to the authentication guard. Confirm swagger annotations are complete per the API logging rule.

**Step 6 — Write context.md**
Document the module per the mandatory context.md rule before any code is modified.

**Step 7 — Backfill existing users**
Write the rebuild logic that reconstructs a portfolio document from scratch by scanning all existing Purchase, LeveragePosition, and SolvencyPosition records for a given wallet. This is needed once at rollout to populate portfolio documents for all existing users. The rebuild can be triggered per-user via the admin endpoint or run as a one-time migration script.

---

## Invariants

- The portfolio document is eventually consistent, not strongly consistent. A failed update call (e.g., network blip during notify) must not fail the primary operation (the purchase record must still be saved). The portfolio rebuild capability is the recovery mechanism.
- All arithmetic in portfolio updates must use BigInt. JavaScript number cannot handle 18-decimal token amounts without precision loss.
- The `tokenBalance` in the persistent document must always reflect the net of all signed amounts — positive for purchases and cancelled orders, negative for sales and active sell orders. The same accounting logic that currently lives in `getInvestorPortfolio()` applies here.
- Network field on holdings is populated from the asset's `network` field at the time of the update call. If an asset does not have a network field (older records), it defaults to `mantle`.
