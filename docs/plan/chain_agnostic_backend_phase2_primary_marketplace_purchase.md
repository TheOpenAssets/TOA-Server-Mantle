# Chain-Agnostic Backend — Phase 2: Primary Marketplace Investor Purchase Flow

**Author:** Architecture Planning
**Date:** February 14, 2026
**Scope:** Everything an investor does after a listing goes live — buying tokens (static price), placing bids (auction), and claiming settlement results — all made network-agnostic through the established adapter pattern.

---

## Preamble: Why This Phase Is Simpler Than Phase 1

Phase 1 installed the three foundational pillars: the network config system, the module registry, and the adapter abstraction. Every phase from here forward is a matter of identifying which existing services carry EVM coupling, extracting those coupled operations into the adapter layer, and letting the rest of the service remain untouched.

In the primary marketplace purchase flow, the EVM coupling is narrow and well-contained. Two services — `PurchaseTrackerService` and `BidTrackerService` — each construct a viem public client hardcoded to `mantleSepolia` in their constructors, and each contain private methods that fetch transaction receipts via that client and decode EVM-formatted event logs. These private methods represent the totality of the EVM coupling in the entire marketplace module. Everything else — the MongoDB records, the portfolio calculations, the notification dispatch, the listing queries, the bid tracking — is already completely network-agnostic.

This phase extracts those private verification methods into three new methods on the `BlockchainAdapter` interface, implements them in both the EVM adapter and the Stellar adapter, and replaces the hardcoded client construction with the injected adapter token. The `MarketplaceModule` itself requires no structural change. No new module is created. The single module continues to serve both networks through the adapter.

---

## Part 1: Understanding the Purchase Model Across Networks

### 1.1 How the On-Chain Purchase Works Today (Mantle)

The backend is not the entity that executes purchases. The investor's own wallet does. The flow is entirely client-driven on the blockchain side:

The investor's frontend displays the listing data fetched from the backend's `GET /marketplace/listings/:assetId` endpoint, which reads purely from MongoDB. Before purchasing, the investor approves the USDC token contract to spend the payment amount on behalf of their wallet, with the marketplace contract as the approved spender. Then they call the `buyTokens` function on the PrimaryMarket contract directly, signed by their wallet. The transaction executes on-chain without any backend involvement.

After the on-chain transaction confirms, the investor's frontend notifies the backend via `POST /marketplace/purchases/notify`, sending the transaction hash and asset ID. The backend then validates that this transaction genuinely happened on-chain and correctly matches the claimed details, records the purchase in MongoDB, updates the listing's sold count, and sends the investor a notification.

### 1.2 How the On-Chain Purchase Works on Stellar

The same investor-driven model applies. On Stellar, the investor's Freighter wallet builds and submits a Soroban invocation transaction that calls the `buy_tokens` function on the PrimaryMarket Soroban contract. The USDC payment is authorized in-transaction through Soroban's native authorization mechanism — there is no separate approve transaction the way EVM has an ERC-20 `approve()` call.

After the Stellar transaction confirms (typically within 5 seconds on a single ledger close), the investor's frontend notifies the backend via the same `POST /marketplace/purchases/notify` endpoint, sending the Stellar transaction hash and asset ID. The backend validates the transaction using the Stellar adapter, records the purchase in MongoDB using the exact same logic, and sends notifications. Everything from the record creation onward is identical.

This symmetry is what makes the single-module approach correct. The conceptual model is the same. The only difference is how the backend reads and interprets the transaction evidence.

### 1.3 The Pre-Purchase Eligibility Situation

On Mantle, the investor's eligibility to receive tokens is enforced at the smart contract level by the EVM compliance module attached to each RWA token. The investor must have been registered in the IdentityRegistry before the marketplace contract will allow `buyTokens` to transfer tokens to them. This registration was already handled in Phase 1 during the KYC approval flow.

On Stellar, the analogous enforcement comes from the trustline mechanism. Before a Stellar investor can hold an RWA native asset, they must have established a trustline to that asset, and the platform (as the asset issuer) must have authorized that trustline. This was already covered in Phase 1 via the `approveTrustlineForUser` operation that runs during KYC approval on Stellar deployments.

Phase 2 requires no new pre-purchase eligibility work. Phase 1 already guarantees that by the time an investor reaches the listing page, their wallet has been prepared on-chain to receive tokens.

---

## Part 2: Identifying the EVM Coupling — A Surgical Inventory

There are exactly three private methods across two service files that contain all the EVM-specific logic in the marketplace module. Understanding each one precisely is essential.

### 2.1 `PurchaseTrackerService.validatePurchaseTransaction()`

This method takes a transaction hash, an asset ID, and the expected buyer address. It uses the viem public client to fetch the transaction receipt. It iterates through the receipt's event logs, filtering to those emitted by the PrimaryMarketplace contract address. For each matching log, it calls viem's `decodeEventLog` to parse the log against the PrimaryMarketplace ABI and looks for an event named `TokensPurchased`. When it finds a matching event — one where the encoded `assetId` and `buyer` fields match the claimed values — it extracts and returns the token `amount`, the `price`, the `totalPayment`, the block number, and the block timestamp.

This method is the only network-specific code in `PurchaseTrackerService`. The constructor also creates a viem public client with `mantleSepolia` hardcoded, which is the initialization of the EVM coupling.

### 2.2 `BidTrackerService.validateBidTransaction()`

Same structural pattern. Takes a transaction hash, asset ID, and expected bidder. Fetches the receipt via viem. Filters logs by PrimaryMarketplace address. Decodes looking for a `BidSubmitted` event. Returns the `tokenAmount`, the `price`, and the `bidIndex`. The constructor again creates a viem public client with `mantleSepolia`.

### 2.3 `BidTrackerService.validateSettlementTransaction()`

The auction settlement path. Takes a transaction hash, asset ID, bid index, and expected bidder. Fetches receipt, filters logs, decodes looking for a `BidSettled` event. Returns three values: `tokensReceived` (how many tokens the bidder won, which is zero if their bid was below the clearing price and they are being refunded), `refundAmount` (USDC returned to them if they lost), and `cost` (actual USDC paid if they won).

---

## Part 3: The Adapter Interface Additions

The `BlockchainAdapter` interface defined in Phase 1 needs three new method signatures. These are added alongside the existing methods for `registerAsset`, `deployToken`, `listOnMarketplace`, etc. They carry the same design philosophy: all parameters and return types are expressed in network-agnostic terms using plain strings and numbers, with all network-specific encoding handled inside the adapter.

### 3.1 `verifyPurchaseTransaction`

This method answers the question: "Did this transaction represent a valid token purchase for this asset by this investor?" Its inputs are the transaction identifier as a plain string (on Mantle this is the 0x-prefixed hex hash; on Stellar this is the base32-encoded transaction hash), the asset's UUID as it is stored in the platform's MongoDB, and the expected buyer's wallet address as a plain string.

Its output is either null (the transaction is not valid, does not exist, does not match the claimed buyer, or could not be fetched) or a `PurchaseVerificationResult` containing:
- The token amount in canonical raw form as a string
- The price per token in canonical raw form as a string
- The total USDC payment in canonical raw form as a string
- The block or ledger sequence number as a number
- The Unix timestamp as a number

The "canonical raw form" concept is defined in Part 5.

### 3.2 `verifyBidTransaction`

Answers: "Did this transaction represent a valid bid placement for this auction by this investor?" Same input shape: transaction identifier, asset UUID, expected bidder address.

Output is either null or a `BidVerificationResult` containing:
- The token amount bid, in canonical raw form
- The price offered per token, in canonical raw form
- The bid index (a sequential integer assigned by the contract to identify this bid within the auction)

### 3.3 `verifyBidSettlement`

Answers: "Did this transaction represent the settlement of a specific bid in this auction?" Inputs: transaction identifier, asset UUID, expected bidder address.

Output is either null or a `BidSettlementResult` containing:
- Tokens received by the bidder (zero means the bid lost and was refunded)
- Refund amount in USDC, in canonical raw form
- Actual cost paid in USDC, in canonical raw form

All three results follow the same design as the existing `PurchaseVerificationResult` in Phase 1's typed result convention: they are plain objects, all numeric values are strings (to avoid JavaScript BigInt serialization issues), and the caller pattern is to check for null before using the result.

---

## Part 4: EVM Adapter Implementation of the Three Methods

The EVM adapter (`evm-blockchain.adapter.ts`) implementation of these three methods is a straight extraction of the existing private method logic from the service files.

Each method on the EVM adapter constructs a one-time-use public client using the dynamic chain configuration (the pattern already established in Phase 1 — no hardcoded `mantleSepolia` reference, the chain definition is built from the network config values at call time). It fetches the transaction receipt, iterates logs filtered to the PrimaryMarketplace contract address obtained from the contract loader, decodes using viem's `decodeEventLog` against the PrimaryMarketplace ABI loaded from the contract loader, and validates the decoded fields match the claimed values.

The assetId comparison on EVM requires converting the platform's UUID string to its bytes32 hex representation by stripping hyphens and right-padding with zeros. This conversion logic already exists in the private methods and moves to the adapter.

For `verifyPurchaseTransaction`, the method also fetches the block to get the timestamp, since the receipt alone does not carry it on EVM.

The `executeWithRetry` helper that both services currently embed is moved to a shared utility inside the adapter layer — both EVM and Stellar adapters will need retry logic, so it belongs there rather than in the domain service.

The return values are in their natural EVM form (18-decimal token amounts, 6-decimal USDC amounts) which is already the canonical form. No conversion needed for EVM.

---

## Part 5: The Canonical Amount Representation Contract

This is an architectural constraint that must be established explicitly and adhered to by all adapter implementations.

The backend's portfolio calculations, notification messages, and display formatting all assume that token amounts are expressed as 18-decimal integer strings and USDC amounts are expressed as 6-decimal integer strings. This means "1000 tokens" is stored as "1000000000000000000000" and "100 USDC" is stored as "100000000".

This convention must hold regardless of which network the adapter is running against. It is the adapter's responsibility to guarantee it.

For the EVM adapter, this is already true. ERC-20 RWA tokens on Mantle use 18 decimal places and USDC uses 6. The on-chain event values are already in the correct canonical form.

For the Stellar adapter, the Soroban contracts for the platform must be deployed with the same decimal configurations: RWA token amounts represented as 18-decimal integer values, USDC payment amounts represented as 6-decimal integer values. Stellar natively supports 7 decimal places for its own XLM token, but Soroban contracts can use any decimal representation. The decision to match the 18/6 EVM convention for the platform's Soroban contracts avoids the need for any conversion logic in the adapter and ensures the rest of the backend remains untouched.

If the Soroban contracts are deployed with different decimal configurations (7 for tokens, 7 for USDC), the Stellar adapter must perform the normalization before returning results. This means multiplying 7-decimal token amounts by 10 to the power of 11 to arrive at 18-decimal representation, and dividing 7-decimal USDC amounts by 10 to arrive at 6-decimal representation (accepting the loss of the 7th decimal place). The plan strongly recommends configuring Stellar contracts to match the 18/6 convention rather than building lossy conversion into the adapter.

---

## Part 6: Stellar Adapter Implementation of the Three Methods

The Stellar adapter (`stellar-blockchain.adapter.ts`) implements the same three interface methods using the Stellar SDK and Soroban RPC.

### 6.1 `verifyPurchaseTransaction` on Stellar

The method receives the Stellar transaction hash. It calls the Soroban RPC's `getTransaction` endpoint with this hash to retrieve the full transaction result. The transaction result includes the events emitted by the Soroban contract during execution.

The adapter iterates the contract events in the transaction result, filtering to those emitted by the PrimaryMarket Soroban contract (identified by its contract ID from the Stellar contract loader). For each event, it inspects the first topic symbol to find the `TokensPurchased` event. When found, it decodes the XDR-encoded event values: the asset identifier (how the Soroban contract stores the platform's UUID — as a Symbol or String type in Soroban), the buyer's Stellar public key, the token amount, the price per token, and the total USDC payment.

The adapter validates that the decoded buyer address matches the expected buyer address (case-insensitive comparison since Stellar addresses are uppercase but clients might submit them in different cases). It also validates that the decoded asset identifier matches the platform UUID. On Stellar, the assetId in the contract is stored as the plain UUID string rather than a bytes32 conversion.

The method retrieves the ledger sequence number from the transaction result as the block number equivalent, and uses the ledger close time as the timestamp.

### 6.2 `verifyBidTransaction` on Stellar

Same pattern. Fetches transaction result, iterates contract events from the PrimaryMarket contract, looks for a `BidSubmitted` Soroban event symbol. Decodes the bidder's Stellar public key, the token amount, the offered price, and the bid index. Returns the `BidVerificationResult` in canonical form.

### 6.3 `verifyBidSettlement` on Stellar

Fetches transaction result, looks for a `BidSettled` Soroban event, decodes tokens received, refund amount, and cost. The semantics are identical: if `tokensReceived` is zero, the bidder lost the auction and received a USDC refund; if positive, they won at the clearing price.

### 6.4 Soroban Event Structure Consideration

Soroban events are structured as a list of topic entries (usually Symbol values) followed by data. The event structure the adapter expects must match the event structure the Soroban contracts actually emit. This means the Soroban PrimaryMarket contract must be written to emit events with the same logical structure as the EVM events: identifying the operation type as the first topic, and including buyer/bidder, assetId, amount, price, and payment/refund values in the event data.

The plan treats this as a contract-side requirement: the Soroban contracts are designed to emit events compatible with the adapter's expectations. The adapter's job is to decode what the contracts emit, not to impose a structure on the contracts.

---

## Part 7: Refactoring `PurchaseTrackerService`

The changes to this service are minimal, confined to the constructor and one call site.

The constructor currently imports and instantiates a viem public client with the hardcoded `mantleSepolia` chain definition. This construction and the field that holds the client are both removed. The `ContractLoaderService` injection was used only in the now-extracted `validatePurchaseTransaction` private method. Once that method is removed, the `ContractLoaderService` injection in this service becomes unnecessary and is also removed.

In its place, the service gains an injection of the `BLOCKCHAIN_ADAPTER` token as its blockchain dependency. The type annotation uses the `BlockchainAdapter` interface, not a concrete class.

In the `notifyPurchase` method, the call to `this.validatePurchaseTransaction(dto.txHash, dto.assetId, investorWallet)` becomes a call to `this.blockchainAdapter.verifyPurchaseTransaction(dto.txHash, dto.assetId, investorWallet)`. The return type and the null check that follows remain structurally identical.

The entire `validatePurchaseTransaction` private method is deleted.

The import statements for `createPublicClient`, `http`, `Hash`, `decodeEventLog` from viem are removed. The import of `mantleSepolia` is removed. This is the last occurrence of a direct `mantleSepolia` import in the marketplace module, eliminating the module's EVM coupling entirely.

All other logic in `PurchaseTrackerService` — the deposit/withdrawal handling paths, the portfolio building logic, the yield calculation, the leverage position enrichment, the notification sending, the sold count update — is entirely unchanged.

---

## Part 8: Refactoring `BidTrackerService`

The same surgical pattern applies, but this service has two private methods to remove instead of one.

The constructor's viem public client instantiation and the `private publicClient` field are removed. The `ContractLoaderService` injection is removed (it was only used in the two private validation methods). The `BLOCKCHAIN_ADAPTER` injection is added.

The call to `validateBidTransaction` in `notifyBid` becomes a call to `this.blockchainAdapter.verifyBidTransaction`. The call to `validateSettlementTransaction` in `notifySettlement` becomes `this.blockchainAdapter.verifyBidSettlement`.

Both private validation methods are deleted in their entirety.

The viem imports and the `mantleSepolia` import are removed.

All bid tracking logic, auction statistics, settlement processing, notification dispatch, purchase record creation for winning bids, and `syncListingSold` functionality are entirely unchanged.

---

## Part 9: The `txHash` Field — Supporting Both Network Formats

The `NotifyPurchaseDto` and `NotifyBidDto` currently declare a `txHash` field with no format enforcement. This already works for Stellar in terms of runtime behavior since Stellar transaction hashes are also strings. However, the field name `txHash` is EVM-centric — "hash" carries the implication of a 0x-prefixed hex value.

The plan recommends renaming the semantic purpose in documentation: the field should be documented as "network transaction identifier" in the Swagger `@ApiProperty` annotation, with a description that explicitly states it accepts both EVM hex transaction hashes and Stellar base32 transaction hashes. The field name `txHash` can remain unchanged for backward compatibility — existing Mantle clients do not break.

If DTO-level validation currently enforces a `0x`-prefixed hex format via a regex, that constraint must be relaxed to accept both formats. The wallet type detection utility introduced in Phase 1 (auth) can serve as a model: the DTO validator should accept any non-empty string that matches either the 66-character EVM hash format or a 64-character Stellar transaction hash format. Invalid formats should be rejected at the DTO level rather than passing through to the adapter.

The `NotifySettlementDto` carries the same `txHash` field and gets the same treatment.

---

## Part 10: The Dual Recording Path — Notify vs. Event Processor

Purchases on this platform can be recorded via two paths running in parallel. Understanding how Phase 2 interacts with both is important.

The first path is the investor-initiated notify path: the investor calls `POST /marketplace/purchases/notify` immediately after their transaction. This is the fast path — the investor gets confirmed portfolio visibility within seconds. Phase 2 modifies this path by replacing the inline EVM verification with the adapter's method.

The second path is the event-driven path: the `EventAdapter` (either EVM or Stellar, depending on the deployment) detects the `TokensPurchased` contract event, translates it into a standardized internal event payload, and pushes it to the BullMQ `event-processing` queue. The `EventProcessor` consumes this and updates the database. This path is already network-agnostic from Phase 1 — the event adapter handles all translation and the EventProcessor receives standardized payloads regardless of network.

The two paths implement idempotency via the `txHash` field on the purchase document — whichever path writes first, the second encounters the existing record and skips creation. This idempotency mechanism is already in place and remains unchanged.

Phase 2 makes no changes to the event processing path. The EventProcessor is not modified. The event adapter's `TokensPurchased` event translation from Phase 1 already covers the Stellar side. The only change in Phase 2 is in the notify path's on-chain verification mechanism.

---

## Part 11: The `bought_tokens` Registry Method on NetworkRegistry

Looking at the cross-module call pattern, `PurchaseTrackerService` does not call any other domain module's services through the registry — it directly injects MongoDB models and the notification service, which are universally available. There is no cross-service operation here that needs to go through the registry.

This means `PurchaseTrackerService` and `BidTrackerService` should inject `BLOCKCHAIN_ADAPTER` directly, exactly as the admin service does for token deployment in Phase 1. The `NetworkRegistryService` is not involved in the purchase verification path. Its role is reserved for cross-module domain operations where one module calls another module's service.

The distinction: adapter calls (blockchain interactions that need the correct network implementation) go via direct adapter injection. Cross-module service calls (like yield calling leverage) go via the registry. Purchase verification is adapter territory.

---

## Part 12: Amount Decimal Awareness in the Portfolio Display

The portfolio building logic in `PurchaseTrackerService` uses hardcoded divisors: token amounts are divided by `1e18` to produce human-readable values, USDC amounts are divided by `1e6`. These divisors must match the canonical form that the adapter guarantees.

As long as the canonical contract from Part 5 is honored — adapters always return token amounts in 18-decimal form and USDC in 6-decimal form — the portfolio display code requires zero changes. The adapter layer absorbs any Stellar-specific decimal convention, and the service layer remains blissfully unaware.

If in the future a third network is introduced with a different convention, the adapter for that network normalizes to the canonical form before returning results. The portfolio service never needs to change.

---

## Part 13: The USDC Payment Mechanism — Stellar-Side Notes

On EVM, before buying tokens, the investor must separately call `USDC.approve(marketplaceAddress, amount)` to authorize the marketplace contract to pull USDC from their wallet. This is a prerequisite that lives entirely on the client side.

On Stellar, this separate approval step does not exist. Soroban contracts use a different authorization model where the authorization to transfer funds from the investor's wallet is attached to the same transaction that invokes the `buy_tokens` function. The Freighter wallet handles this: when the investor signs the purchase transaction, they are simultaneously authorizing both the contract invocation and the USDC payment transfer.

This difference is entirely invisible to the backend. The backend's notify endpoint receives a transaction hash and validates that the purchase happened correctly. Whether the USDC flow was an ERC-20 approval followed by a transfer, or a Soroban inline authorization, is a client-side and contract-side concern. The event log / Soroban event carries the same logical information: buyer, amount, price, total paid. The backend cares only about these values.

The plan documents this explicitly so that frontend teams building the Stellar investment UI know not to implement the two-step approve-then-buy flow when targeting a Stellar deployment.

---

## Part 14: Listing Queries — Already Network-Agnostic

The `GET /marketplace/listings` and `GET /marketplace/listings/:assetId` endpoints are already completely network-agnostic. They query MongoDB where the asset data — including the `listing` subdocument with price, type, sold count, and active status — was written by the event processor after the admin completed the marketplace listing step (the `listOnMarketplace` adapter call from Phase 1).

The `tokenAddress` field in listing responses is the opaque string that Phase 1's `deployToken` adapter stored: a 0x-prefixed EVM contract address for Mantle deployments, a `RWA-XXXXX:G...publickey...` canonical Stellar asset string for Stellar deployments. The frontend must know the network it is on to interpret this field correctly. The JWT's `network` field (introduced in the auth phase) gives the frontend this context.

No changes to listing endpoints in Phase 2.

---

## Part 15: context.md Requirement

Every folder touched by Phase 2 must have its `context.md` written before any code in that folder is modified. The following context files are in scope:

**`modules/marketplace/context.md`** — Must be created. Documents the marketplace module's responsibilities: serving listing data, validating and recording investor purchases and bids, tracking portfolio state, and providing auction statistics. Notes that on-chain verification is delegated to the `BLOCKCHAIN_ADAPTER` injection token. Documents which services exist, which DTOs they consume, and the distinction between the notify path and the event-driven path. Notes that no cross-service operations go through the Network Registry — the module only uses the blockchain adapter and the notification service.

**`modules/blockchain/adapters/evm/context.md`** — Must be updated to document the three new verification methods added in this phase and their role in the purchase flow.

**`modules/blockchain/adapters/stellar/context.md`** — Must be updated to document the Stellar implementations of the three verification methods, how Soroban events are decoded, and the canonical amount conversion requirement.

---

## Part 16: Files to Create and Modify

### New Files

- `packages/backend/src/modules/marketplace/context.md` — Module documentation

### Modified Files

- `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts` — Add three new method signatures: `verifyPurchaseTransaction`, `verifyBidTransaction`, `verifyBidSettlement`, with their corresponding result type definitions (`PurchaseVerificationResult`, `BidVerificationResult`, `BidSettlementResult`)

- `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts` — Implement the three new methods, extracting logic from the current service private methods

- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts` — Implement the three new methods using Soroban RPC and event decoding

- `packages/backend/src/modules/marketplace/services/purchase-tracker.service.ts` — Remove viem public client construction, remove `ContractLoaderService` injection, remove `validatePurchaseTransaction` private method, add `BLOCKCHAIN_ADAPTER` injection, update call site

- `packages/backend/src/modules/marketplace/services/bid-tracker.service.ts` — Same pattern: remove public client, remove `ContractLoaderService`, remove both `validateBidTransaction` and `validateSettlementTransaction` private methods, add `BLOCKCHAIN_ADAPTER` injection, update both call sites

- `packages/backend/src/modules/marketplace/dto/notify-purchase.dto.ts` — Update Swagger documentation on `txHash` to describe it as a network-agnostic transaction identifier. Relax any hex-format-specific validator to accept both EVM and Stellar hash formats.

- `packages/backend/src/modules/marketplace/dto/notify-bid.dto.ts` — Same documentation and validation update

- `packages/backend/src/modules/marketplace/dto/notify-settlement.dto.ts` — Same

- `packages/backend/src/modules/blockchain/adapters/evm/context.md` — Document the three new methods

- `packages/backend/src/modules/blockchain/adapters/stellar/context.md` — Document the three new Stellar implementations

---

## Part 17: Implementation Sequence

The sequence preserves a working Mantle deployment at every step. Each step is independently deployable.

**Step 1 — Define the result types and interface additions**

Add the three result type definitions and three method signatures to the `BlockchainAdapter` interface. At this point, the TypeScript compiler will flag that the EVM adapter class no longer fully implements the interface — this creates a deliberate build signal that work remains. (Note: per the "Rule of build," builds are not run; the TypeScript compiler errors serve as a guide during development.)

**Step 2 — Implement in the EVM Adapter**

Extract the three private validation methods from their respective service files and implement them as the three new adapter methods on `evm-blockchain.adapter.ts`. The logic is essentially copy-and-adjust: replace the `this.publicClient` references with a locally-constructed public client using the dynamic chain config (as established in Phase 1). Replace the `this.contractLoader.getContractAddress()` and `this.contractLoader.getContractAbi()` calls with the equivalent through the adapter's already-injected contract loader reference. The EVM adapter classes are in the blockchain module and already have the contract loader available.

**Step 3 — Refactor `PurchaseTrackerService`**

Write the `context.md` for the marketplace module first. Then remove the EVM coupling from the constructor, add the adapter injection, remove the private method, and update the call site. Confirm nothing else in the service changed.

**Step 4 — Refactor `BidTrackerService`**

Same as Step 3 for the bid tracker. Remove both private methods, add adapter injection, update both call sites.

**Step 5 — Update DTOs**

Update the three notify DTOs with improved documentation and relaxed validation for the `txHash` / transaction identifier field.

**Step 6 — Implement in the Stellar Adapter**

Implement the three verification methods on `stellar-blockchain.adapter.ts` using the Soroban RPC's `getTransaction` method and contract event decoding. This can only be fully tested against a deployed Soroban PrimaryMarket contract.

**Step 7 — Update context.md files**

Update the EVM and Stellar adapter context files to document the new methods.

---

## Part 18: Invariants and Guard Rails

**The notify path must remain idempotent on both networks.** The `txHash` field is used as the unique deduplication key in the purchase document. This holds for Stellar transaction hashes the same way it holds for EVM hashes — both are unique string identifiers for a specific transaction.

**A failed or invalid transaction must always produce a `BadRequestException`, never a 500.** The adapter methods return null for invalid transactions. The service converts null into a `BadRequestException`. The adapter must catch all network-level errors (RPC unavailable, malformed response, event not found) and return null rather than throwing, so the service layer's null-check is the single error surface.

**Amount values in result types must always be strings, never JavaScript BigInt.** BigInt cannot be serialized to JSON and should not cross service boundaries. The adapter converts BigInt values to string before populating the result objects.

**Mantle backward compatibility is absolute.** The three extracted methods on the EVM adapter must produce results that are bit-for-bit identical to what the current private methods produce for the same inputs. No behavioral change on Mantle.

**The EventProcessor is not touched.** The event-driven recording path already handles both networks through Phase 1's event adapter. Phase 2 does not modify `event.processor.ts`.

---

## Part 19: Testing Checklist

**Static purchase flow — Mantle:**
An investor on Mantle calls `POST /marketplace/purchases/notify` with a valid transaction hash from a successful `buyTokens` call. The backend validates the transaction, records the purchase, updates `listing.sold`, and the investor's portfolio reflects the new position.

An investor submits a transaction hash for a transaction they did not sign. The buyer address in the event does not match the authenticated wallet. The backend returns `BadRequestException`.

An investor submits a transaction hash for a different asset's purchase. The assetId comparison fails. The backend returns `BadRequestException`.

An investor submits the same transaction hash twice. The second attempt returns `ConflictException`.

**Static purchase flow — Stellar:**
An investor on Stellar calls `POST /marketplace/purchases/notify` with a valid Stellar transaction hash from a successful `buy_tokens` Soroban invocation. The backend's Stellar adapter fetches the transaction, decodes the Soroban event, validates the buyer's Stellar public key against the authenticated wallet, and records the purchase identically to the Mantle flow.

**Auction bid flow — Mantle:**
An investor places a bid and calls `POST /marketplace/bids/notify`. The backend decodes the `BidSubmitted` event and records the bid with the correct bid index.

**Auction settlement flow — Mantle:**
A winning bidder calls `POST /marketplace/bids/settle-notify`. The backend decodes `BidSettled`, records the purchase, and sends the auction-won notification.

A losing bidder calls `POST /marketplace/bids/settle-notify`. The backend decodes `BidSettled`, sees `tokensReceived` is zero, records the refund status, and sends the bid-refunded notification.

**Auction flows — Stellar:**
Same scenarios against Stellar, verifying the Soroban event decoding produces identical results.

**Portfolio display:**
After purchases on either network, `GET /marketplace/portfolio` returns correctly formatted token amounts (divided by `1e18`) and USDC amounts (divided by `1e6`), confirming the canonical amount contract holds.
