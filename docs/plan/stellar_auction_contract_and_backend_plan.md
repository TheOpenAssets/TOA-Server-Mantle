# Stellar Auction — Contract Completion & Backend Wiring Plan

**Author:** Architecture Planning
**Date:** February 18, 2026
**Scope:** Full plan for making auctions work end-to-end on Stellar — covering the Soroban PrimaryMarket contract redesign, USDC custody model, bid submission, admin clearing, on-chain settlement, and the backend changes that wire everything together.

---

## Preamble: What This Plan Resolves

The previous auction plan identified that the Stellar PrimaryMarket contract was structurally incomplete for auctions. It could create a listing labelled as an auction type and deactivate it, but had no mechanism for bid collection, USDC custody, clearing price enforcement, or on-chain settlement. Bid placement and settlement were ghost paths — the backend adapter had full implementations of `verifyBidTransaction` and `verifyBidSettlement` that looked for events the contract never emitted.

This plan completes the contract, defines the USDC custody model, and describes every backend change needed to wire the Stellar auction path cleanly into the existing chain-agnostic infrastructure.

The design is shaped by one strong architectural decision the user made: **clearing price calculation stays entirely off-chain**. The backend business logic in `AuctionService` continues to own the Dutch auction algorithm. The contract's job is to accept that calculation as a trusted admin input, verify it has the tokens in custody to honour the result, and then unlock per-bid on-chain settlement.

---

## Part 1: The Core Design — What the Contract Must Become

The Stellar PrimaryMarket contract currently has four public functions. After this plan is implemented it will have eight, plus a revised storage layout.

The fundamental lifecycle for an auction on Stellar is:

**Listing** — The admin calls `list_asset` with the auction type. At this moment, no tokens are minted and no USDC changes hands. The listing is created on-chain as a record of intent. This is the correct model — you do not pre-mint tokens before you know the clearing price, because the token count that will actually be distributed depends on clearing, not on listing.

**Bidding** — Each investor calls `submit_bid` directly on the contract. The contract pulls USDC from the investor's account into the contract's own balance. The contract stores the bid details on-chain and emits a `BidSubmitted` event. The contract is now the custodian of all USDC deposited across all bids for this asset.

**Clearing** — The admin, having run the clearing price algorithm off-chain, takes two sequential actions. First, the admin mints the required number of RWA tokens directly to the PrimaryMarket contract address via the SAC issuer mint function. Second, the admin calls `clear_auction` on the contract, passing the clearing price. The contract checks that its token balance for that asset is sufficient to cover the total supply committed at listing, then stores the clearing price and marks the auction as ended. After this call, new bids are refused and settlement is unlocked.

**Settlement** — Each investor (or the admin on their behalf) calls `settle_bid` with the bid index. For winning bids, the contract transfers tokens from its own balance to the bidder, transfers the USDC cost to the platform treasury, and refunds any USDC excess back to the bidder. For losing bids, the contract refunds the full deposited USDC. In both cases it emits a `BidSettled` event. The backend's `verifyBidSettlement` reads this event to record the outcome.

This design makes the contract a clean, trustless settlement engine. The business judgement (who wins, at what price) lives in the backend. The contract enforces the mechanic (custody, atomic transfer, event proof).

---

## Part 2: New and Modified Data Structures in the Contract

### The Bid Record

The contract needs to store a persistent record for every bid placed. The bid record holds the bidder's address, the token amount they requested, the limit price per token they named, and the USDC amount the contract actually received from them at bid time. It also holds a boolean indicating whether this bid has been settled, to prevent double-settlement.

These five fields are the minimum needed for the settlement logic to run correctly without any external inputs. The contract can calculate everything it needs for settlement (tokens owed, cost at clearing price, USDC refund) from the bid record plus the clearing price stored on the listing.

### The Listing Record

The existing `Listing` struct is extended with two fields. First, a `clearing_price` field, which is optional and absent until `clear_auction` is called. The presence of a clearing price is the signal that settlement is unlocked — rather than introducing a separate auction phase enum, the clearing price itself acts as the phase flag. When it is absent, the auction is in the bidding phase. When it is present, the auction has ended and settlement proceeds.

Second, a `usdc_contract` field that stores the address of the USDC SAC (the Soroban-compatible USDC token contract). This is stored at listing time so every subsequent function — `submit_bid` and `settle_bid` — has access to the USDC contract without needing it passed as a parameter on each call. This makes the investor-facing API simpler and prevents callers from passing a fraudulent USDC address.

### Storage Keys

Three new storage key variants are needed. One key maps each asset code to a bid counter, which is a simple integer that increments every time a new bid is placed. The bid index that the backend stores in the `Bid` document is derived from this counter. A second key maps the combination of asset code and bid index to a bid record, giving O(1) lookup when settling a specific bid. A third key maps asset code to the stored USDC contract address — though this can alternatively be folded into the `Listing` struct, which is the cleaner approach.

---

## Part 3: New Functions

### `submit_bid`

This function is callable by any KYC-verified investor. It takes the asset code, the token amount the investor wants, and their limit price per token.

The contract performs several checks before accepting the bid: the listing must exist and be active, the listing type must be auction, no clearing price must be set yet (the auction is still open), the block timestamp must be before the listing's end time, the price must be at or above the listing's minimum price, and the token amount must be at or above the minimum investment.

If all checks pass, the contract calculates the USDC deposit as `price × tokenAmount / scale_factor`, where scale factor accounts for the token decimal precision on Stellar. The contract then executes a token transfer from the investor's account to itself using the USDC SAC contract. This transfer is the USDC escrow — from this moment, the contract holds the investor's USDC.

The contract increments the bid counter for this asset, stores the bid record keyed by the new counter value, and emits a `BidSubmitted` event whose data fields exactly match what `verifyBidTransaction` in the Stellar adapter expects: asset code, bidder address, token amount, price, and bid index. The event field order and types are contractual — they must not diverge from what the adapter decodes.

### `clear_auction`

This function is callable only by the admin. It takes the asset code and the clearing price.

The contract checks that the listing exists, that the listing type is auction, and that no clearing price has been set yet (to prevent calling clear twice). It then checks that the contract's own balance of the RWA token (accessed via the token SAC) is greater than or equal to the listing's total supply. This balance check is the guardian that ensures the admin completed the minting step before calling clear. If tokens are not present, the call panics — which prevents an admin from accidentally unlocking settlement before the token supply is ready to distribute.

If the balance check passes, the contract stores the clearing price on the listing and sets the listing to inactive. After this call, `submit_bid` will refuse new bids because `clearing_price` is now set.

The contract emits an `AuctionCleared` event with the asset code and clearing price. This event is informational — the backend may optionally listen for it to update asset status, but the primary settlement trigger is the admin endpoint, not a contract event.

### `settle_bid`

This function can be called by the bidder themselves or by the admin. It takes the asset code and the bid index.

The contract checks that a clearing price is set (auction has ended), retrieves the bid record, verifies it has not already been settled, then marks it as settled immediately to prevent reentrancy issues.

**Winning bid path** — a bid wins if its limit price is greater than or equal to the stored clearing price. The contract calculates the cost at clearing price: `clearingPrice × tokenAmount / scale_factor`. The refund is the difference between what the investor deposited and the actual cost. The contract then executes three transfers: tokens from the contract to the bidder via the RWA SAC, USDC cost from the contract to the platform treasury via the USDC SAC, and USDC refund from the contract to the bidder via the USDC SAC if the refund is nonzero. The contract emits a `BidSettled` event with the asset code, bidder, tokens received, cost, and refund.

**Losing bid path** — a bid loses if its limit price is strictly below the clearing price. The contract transfers the full deposited USDC back to the bidder. It emits a `BidSettled` event with tokens received, cost, and refund all set correctly — tokens received is zero, cost is zero, refund is the full deposit. The backend's `notifySettlement` uses the `tokensReceived` value to determine whether the bid status becomes `SETTLED` or `REFUNDED`.

**Supply exhaustion** — when the auction is oversubscribed, some bids that cleared the price threshold may still receive zero tokens because supply ran out. The contract must track how many tokens have been allocated so far in the listing's `sold_amount` field. Before allocating tokens to a winning bid, the contract checks remaining supply. If the remaining supply is zero, the bid receives a full refund even though its price would have won. This matches EVM `PrimaryMarket.settleBid()` exactly. The `BidSettled` event in this case has tokens received as zero, cost as zero, and refund as the full deposit.

### `get_bid`

A simple read-only function taking asset code and bid index, returning the bid record. This allows the backend or frontend to query bid state directly without needing to parse events.

---

## Part 4: Modified Functions

### `list_asset`

The existing function is extended to accept a USDC contract address parameter. This address is stored on the listing record so that `submit_bid` and `settle_bid` can reference it without needing it passed each time.

For auction listings specifically, the function does not require or perform any token minting. The token minting for an auction happens at clearing time, not at listing time. The function validates that the listing type is consistent with the parameters provided — specifically, if the type is auction, it must have a minimum price set.

### `deactivate_listing`

This function currently covers all deactivation needs. For auctions, deactivation is now handled by `clear_auction`. The `deactivate_listing` function should be restricted to static listings. If called on an auction listing, it should panic — auction deactivation must go through `clear_auction` to ensure the clearing price invariant is set before settlement is possible. This prevents a bug where an admin deactivates an auction without providing a clearing price, leaving USDC permanently locked in the contract.

### `init`

The initialisation function gains a `platform_treasury` address parameter. This is the address that receives USDC cost payments during `settle_bid`. Storing the treasury address in the contract prevents the admin from needing to pass it on every settlement, and ensures a consistent, upgrade-safe reference.

---

## Part 5: Decimal Precision and the Scale Factor

This is the most consequential correctness concern in the contract. Getting it wrong means all USDC amounts computed on-chain will be off by orders of magnitude.

On Stellar, the standard for asset decimals is seven. An amount of one token is represented as the integer ten million. USDC on Stellar also uses seven decimal places in its SAC interface.

The deposit calculation in `submit_bid` is `cost = price × tokenAmount / 10^7`. If both price and tokenAmount are expressed in Stellar's seven-decimal raw format, dividing by ten million gives the USDC cost in seven-decimal raw format. This is correct and consistent.

The backend's `verifyBidTransaction` currently uses `toCanonical(evtPrice, 6)` — it interprets the price field in the event as a six-decimal value. This is a mismatch if the contract emits USDC prices in seven-decimal form. The plan resolves this cleanly: the contract should emit prices and USDC amounts in their raw Stellar seven-decimal form, and the backend adapter should use `toCanonical(..., 7)` for USDC fields on the Stellar path. The existing adapter code that uses six decimals for USDC must be updated.

The backend's `notifyBid` currently computes `usdcDeposited = (price × tokenAmount) / 10^18`, treating tokenAmount as eighteen-decimal EVM format. When the Stellar adapter returns a tokenAmount from `verifyBidTransaction` with seven-decimal precision, this calculation would be wrong by a factor of `10^11`. This must be corrected: the Stellar adapter should return tokenAmount normalised to eighteen-decimal canonical form (the platform's internal canonical format), achieved by multiplying the seven-decimal raw value by `10^11` before passing to `toCanonical`. This way `notifyBid` continues to work unchanged — the normalisation happens inside the adapter, not in the business logic layer.

The same correction applies to `verifyBidSettlement` for `tokensReceived`.

These precision rules must be verified empirically against the deployed MockUSDC on Stellar testnet before any auction goes live.

---

## Part 6: USDC Custody and Trustline Setup

For the PrimaryMarket contract to receive USDC from investors and hold it, the contract's account on Stellar must have a trustline to USDC. In the Soroban context, this means the contract must have an authorised balance entry for the USDC SAC.

The existing `enable_asset` function achieves this for the RWA token by reading the contract's balance, which forces balance entry creation. The same pattern is needed for USDC. The `enable_asset` function should be extended to optionally accept a USDC contract address, or a separate `enable_usdc` function can be introduced for the same purpose.

The admin must call this setup function before the first bid is accepted. It only needs to be called once per contract deployment, not per auction. The admin-approve-and-schedule script should include a USDC trustline setup step if it has not already been established.

---

## Part 7: Backend Changes Required

### `StellarBlockchainAdapter.endAuction()`

Currently this method calls `deactivateListing()` and ignores the `clearingPrice` parameter. After the contract adds `clear_auction`, this method must be rewritten to call `clear_auction` with the clearing price. The clearing price arrives as a canonical six-decimal string from the backend business logic. The adapter converts it to raw seven-decimal Stellar format before passing it to the contract.

The critical ordering that the adapter must enforce: it must first check whether the minting step has been completed (or it may trigger it), and then call `clear_auction`. The cleanest approach is for the admin strategy or the adapter to call the SAC mint function before calling `clear_auction`, using the total winning token count that the backend calculates during the clearing price algorithm. The `calculateAndEndAuction` method in `AuctionService` already knows the total tokens demanded at clearing — this value should be passed down to the adapter alongside the clearing price so the adapter can mint exactly the right amount.

This means the `endAuction` signature on the adapter interface needs to accept an optional total token supply to mint. Alternatively, the minting step is handled separately in the admin strategy before calling `endAuctionOnMarketplace` on the registry. The strategy pattern is the cleaner location for this logic since it is chain-specific behaviour — Mantle does not need to mint via SAC.

### `StellarAdminStrategy.endAuctionOnChain()`

After `calculateAndEndAuction` in `AuctionService` computes the clearing price, it must also pass the total tokens to be distributed to the strategy. The Stellar strategy takes two sequential actions: first mint that token count to the PrimaryMarket contract via the SAC, then call `endAuctionOnMarketplace`. The Mantle strategy is unaffected.

This requires `endAuctionOnChain` in the admin strategy interface to accept the winning token count as a parameter alongside the clearing price. `AuctionService.calculateAndEndAuction()` already has this value — it is the `cumulativeAmount` at which the clearing price was found.

### `StellarBlockchainAdapter.verifyBidTransaction()` and `verifyBidSettlement()`

Both methods need the decimal precision corrections described in Part 5. Token amounts must be normalised from seven-decimal raw Stellar form to eighteen-decimal canonical form. USDC amounts must be normalised from seven-decimal raw form to six-decimal canonical form — or more precisely, the `toCanonical` call for USDC should use seven as the source precision since that is what the Stellar contract emits.

### `StellarBlockchainAdapter.listOnMarketplace()`

For auction listings specifically, the current code mints tokens to the PrimaryMarket contract. Under the new design, minting at listing time is not correct for auctions. The adapter must detect the listing type and skip the mint step for auction listings. Minting will happen at clearing time instead.

### `AuctionStatusProcessor`

The processor's `activateAuction` job at line 138 calls `this.blockchainService.listOnMarketplace()` directly. This is the only remaining place where the abstraction is broken at a meaningful level. This call must be replaced with a delegation to the active admin strategy via `ModuleRegistryService.getAdminDomainStrategy().listOnMarketplace()`. This is a single method replacement with no behaviour change for Mantle and is required for the Stellar auction activation path to work correctly (because Stellar listing requires SAC authorisation that only the Stellar adapter knows how to perform).

---

## Part 8: What the Backend Does NOT Need to Change

The Dutch auction clearing price algorithm in `AuctionService.calculateAndEndAuction()` is pure arithmetic on `Bid` documents. It has no network dependency and remains unchanged.

`BidTrackerService.notifyBid()` and `notifySettlement()` business logic remain unchanged. The precision normalisation happens in the adapter layer before results reach the tracker service. The tracker service continues to receive canonical values and compute correctly.

`AssetLifecycleService.endAuction()` is already network-agnostic. It records the clearing price in the database after the strategy's on-chain work completes. No changes needed.

The `Bid` schema already has the `network` field. `notifySettlement()` already calls `userPortfolioService.updateOnPurchase()`. These items from the previous plan are confirmed as already implemented.

---

## Part 9: Implementation Sequence

Work must be ordered so that the Mantle auction flow is never broken and changes are independently testable.

**Step 1 — Extend `Listing` struct** with `clearing_price` as an optional field and `usdc_contract` as a required address field. Add the `platform_treasury` to the contract's init params and storage. Add the new `DataKey` variants for bid counter and individual bids. This is a pure data model change with no behaviour change yet.

**Step 2 — Implement `submit_bid`** in the contract. This can be tested in isolation — list an asset as auction, submit a bid, verify USDC moves from investor to contract, verify `BidSubmitted` event emitted with correct field layout. Use the Stellar testnet and verify the event fields match exactly what `verifyBidTransaction` in the adapter expects.

**Step 3 — Implement `clear_auction`** in the contract. Test: list an asset as auction, submit bids, manually mint tokens to the contract, call `clear_auction`, verify clearing price stored, verify new bids refused.

**Step 4 — Implement `settle_bid`** for the winning bid path. Test: complete steps 1-3, then call `settle_bid` on a winning bid index, verify tokens moved to investor, verify USDC split between platform treasury and refund.

**Step 5 — Implement `settle_bid`** for the losing bid path and supply exhaustion path. These share the same function but different branches.

**Step 6 — Restrict `deactivate_listing`** to static listings. This is a one-line guard that panics on auction type listings.

**Step 7 — Update `StellarBlockchainAdapter.listOnMarketplace()`** to skip the mint step for auction listings.

**Step 8 — Update `StellarBlockchainAdapter.endAuction()`** to call `clear_auction` instead of `deactivateListing`, passing the clearing price in Stellar raw format.

**Step 9 — Correct precision in `verifyBidTransaction()` and `verifyBidSettlement()`** — update the `toCanonical` decimal arguments to match the contract's emission format. Verify empirically against the testnet contract.

**Step 10 — Update `StellarAdminStrategy.endAuctionOnChain()`** to perform the SAC mint step before calling `endAuctionOnMarketplace`. Pass the winning token count from `AuctionService`.

**Step 11 — Update `AuctionStatusProcessor.activateAuction()`** — replace direct `blockchainService.listOnMarketplace()` call with delegation through the active admin strategy. This fixes the abstraction breach and unblocks Stellar auction activation.

**Step 12 — Update `context.md` files** for `primary-market/`, `blockchain/adapters/stellar/`, `admin/implementations/stellar/`, and `announcements/processors/`.

**Step 13 — Run the `admin-approve-and-schedule.sh` script** against a real auction asset. Validate the full flow: listing created on-chain, bids placed, clearing price sent, settlement completed, events verified by backend.

---

## Part 10: Invariants

The clearing price algorithm runs once in `AuctionService` and the result is trusted by both the Stellar strategy and the contract. The contract does not independently re-calculate the clearing price — it enforces the admin's submission and uses it to compute settlement amounts deterministically.

The contract's `settle_bid` function is idempotent on success — marking `settled = true` before any transfers ensures that even if a transaction is retried, a bid can only be settled once.

USDC only ever moves from investor to contract during `submit_bid`, and from contract to either platform treasury or investor during `settle_bid`. The contract never holds USDC permanently — every deposited USDC is eventually either returned or distributed through settlement.

The total USDC distributed in settlement (sum of all costs to platform treasury plus all refunds to investors) must equal the total USDC deposited via all bids. The contract must be the sole custodian of this balance — no other function should move USDC out of the contract.

Tokens minted to the contract at clearing time must be fully distributed in settlement. Tokens that remain after all bids are settled (due to undersubscription or supply exhaustion edge cases) should be burnable by the admin. This burn function is considered a follow-up — for the current scope, unsettled tokens remain in the contract.

The event field order in both `BidSubmitted` and `BidSettled` is a hard contract with the backend adapter. The field sequence must be exactly: `[asset_code, bidder, token_amount, price, bid_index]` for `BidSubmitted` and `[asset_code, bidder, tokens_received, cost, refund]` for `BidSettled`. Any change to this order is a breaking change that requires a simultaneous adapter update.
