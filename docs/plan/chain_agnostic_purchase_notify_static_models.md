# Chain-Agnostic Purchase Notify — Static Flow: Models Plan

**Author:** Architecture Planning
**Date:** February 16, 2026
**Scope:** Completing the chain-agnosticism of the static purchase notify flow at the model and DTO level. The service layer (Phase 2) and adapter layer are already done. This plan addresses what remains: the schemas, the DTOs, and the data population gaps.

---

## Preamble: What Phase 2 Already Achieved

Phase 2 refactored the service and adapter layers of the purchase notify flow. Both `PurchaseTrackerService` and `BidTrackerService` now inject the `BLOCKCHAIN_ADAPTER` token and delegate on-chain verification to it. The Stellar blockchain adapter implements `verifyPurchaseTransaction`, `verifyBidTransaction`, and `verifyBidSettlement` using Soroban event decoding. The canonical amount convention (18-decimal tokens, 6-decimal USDC) is in place.

The system can already accept a Stellar transaction hash in the notify endpoint and correctly record a purchase. A Stellar deployment can be verified end-to-end through the service and adapter layers today.

What Phase 2 did not address is the model layer — specifically whether the persistent documents that come out of the notify flow carry enough information to remain unambiguous and useful after recording. There is one critical omission.

---

## Part 1: The Network Blindness Problem in Stored Documents

Every `Purchase` document, every `YieldClaim` document, and every `Bid` document is currently stored without any information about which blockchain network the transaction occurred on.

This is survivable in a single-network deployment — all records are implicitly on the same network, and the deployment environment implies it. It becomes a problem in three scenarios:

First, when the frontend needs to render a "View on Explorer" link for a transaction. A Mantle transaction hash links to the Mantle Sepolia explorer. A Stellar transaction hash links to stellar.expert. Without a `network` field on the record, the frontend has no way to construct the correct link — it would need to either hardcode the network or derive it from the JWT, which is a fragile coupling.

Second, when the portfolio service builds a holding entry for the `UserPortfolio` schema (described in the portfolio plan). Each `PortfolioHolding` entry has a `network` field that must be populated. The portfolio service intends to derive this from the holding's source records — the linked `Purchase` documents. If those documents have no `network` field, the portfolio service must fall back to the deployment-level network config, which is correct today but will break if we ever allow cross-network queries or data migrations.

Third, for operational observability. If a batch of purchase records needs to be re-processed, or a data audit is required, knowing which network each transaction belongs to is essential for routing the verification calls to the correct RPC endpoint.

---

## Part 2: Adding `network` to the Purchase Schema

The `Purchase` schema gains a single new field: `network`, typed as a string with the values `mantle` and `stellar`. It is optional with a default that is set at record creation time, not at schema level. The field is indexed because future queries will filter holdings by network when building portfolio views.

The field is populated in `PurchaseTrackerService.notifyPurchase()` immediately before the `purchaseModel.create()` call. The value is read from the `NetworkRegistryService` (or directly from the `ConfigService` reading `network.networkType`) — this is a synchronous config read, not a blockchain call, and adds zero latency.

The field carries the same value for every purchase in a given deployment. This is expected behavior — one deployment serves one network. The field exists on the document level rather than the deployment level because documents outlive deployments and may be queried in contexts where the deployment environment is not known (data export, reporting, migration).

The existing purchase records (pre-migration) do not have this field. When queried, they will return `undefined` for the `network` field. All consumers of `Purchase` documents must treat `undefined` as `mantle` (the original network) for backward compatibility. This fallback rule is documented in the Purchase schema's comment and in the Marketplace context.md.

---

## Part 3: Adding `network` to the YieldClaim Schema

The `YieldClaim` schema receives the same treatment. When `notifyYieldClaim` creates a yield claim record, it also reads the active network from config and stores it on the document.

The yield claim's transaction hash is a Stellar transaction hash on Stellar deployments. The `network` field is what allows the portfolio service (and the frontend) to generate the correct explorer link when a user views their claim history.

The `YieldClaim` schema comment currently mentions `txHash` without any format hint. The comment is updated to say "network transaction identifier — EVM hash (66 chars, 0x-prefixed) or Stellar transaction hash (64-char hex)". No runtime validation is added to the schema itself — that happens at the DTO layer.

---

## Part 4: The `blockNumber` Field Semantic

The `Purchase` schema has a `blockNumber` field typed as `number`. On Stellar, the equivalent concept is the ledger sequence number, also a number. The field already works for Stellar without any type change.

However, the field name `blockNumber` is EVM-centric. The plan does not rename it — renaming a persisted MongoDB field requires a migration and risks breaking existing queries and projections. Instead, the field's comment is updated to read "EVM block number or Stellar ledger sequence number" and this dual meaning is documented in the schema file and in the `context.md`.

This is the correct trade-off: maximum backward compatibility with a documentation fix rather than a schema rename that adds migration risk for no runtime benefit.

---

## Part 5: Hardening the `NotifyPurchaseDto` Transaction Identifier Validation

The `NotifyPurchaseDto` currently declares `txHash` with `@IsString()` and `@IsNotEmpty()`. Any non-empty string passes. This was intentionally permissive to avoid breaking the Stellar case.

The plan now adds explicit multi-format validation. The validator must accept:
- EVM transaction hashes: exactly 66 characters, starting with `0x`, followed by 64 hexadecimal characters
- Stellar transaction hashes: exactly 64 characters, all uppercase hexadecimal (Stellar uses uppercase hex, not lowercase)
- Stellar transaction hashes also appear in base32/XDR form from some SDK versions — the validator should accept both

The `@Matches()` decorator from `class-validator` is used with a regular expression that covers both formats. The expression accepts either the EVM 0x-prefixed 64-char hex or a bare 64-char hex string. Both formats use the same character set with the only difference being the presence of the `0x` prefix.

The `@ApiProperty()` decorator's `description` field is updated to say: "Network transaction identifier. Accepts EVM transaction hashes (66-char 0x-prefixed hex) or Stellar transaction hashes (64-char hex). Validation enforces both formats."

The field name `txHash` is kept unchanged. The Phase 2 plan correctly identifies that renaming the DTO field would break all existing Mantle clients without any behavioral benefit — the semantics are already correct.

---

## Part 6: The `NotifyYieldClaimDto` — The Missing Network Context

The yield claim notify flow does not have a DTO defined in the marketplace DTO folder. Looking at `notifyYieldClaim(dto: any, investorWallet: string)` in the service — the parameter type is `any`. There is a `notify-yield-claim.dto.ts` file in the DTO folder (from the file listing) but it may be empty or incomplete.

This plan mandates that `NotifyYieldClaimDto` be a proper typed class with:
- `txHash` — string with the same multi-format regex validation as `NotifyPurchaseDto`
- `assetId` — string, required
- `tokensBurned` — number string in canonical 18-decimal form, required
- `usdcReceived` — number string in canonical 6-decimal form, required
- `blockNumber` — optional number string (EVM block or Stellar ledger sequence)

The service's `notifyYieldClaim(dto: any, ...)` signature is updated to `notifyYieldClaim(dto: NotifyYieldClaimDto, ...)`. This is the only service signature change in this plan.

---

## Part 7: `metadata.type` Consistency

The `Purchase` schema's `metadata` object has a `type` field typed as `'PURCHASE' | 'DEPOSIT'`. However, the service creates records with `type: 'WITHDRAWAL'` in one code path. The `WITHDRAWAL` value is not in the type union, meaning TypeScript would flag this if strict mode is active. It also means querying for `{ metadata.type: 'WITHDRAWAL' }` would return no results from a schema-level perspective.

The schema's metadata type union must be expanded to include `'WITHDRAWAL'`. This is a model-layer fix that is adjacent to the network-agnosticism work and should be included here because it affects the correctness of the Purchase model.

---

## Part 8: Summary of What Changes

**New fields on existing schemas:**

- `Purchase` schema: add `network` field (string, optional, indexed, defaults to `'mantle'` on existing records via consumer fallback)
- `YieldClaim` schema: add `network` field (string, optional, indexed, same backward-compat rule)
- `Purchase` metadata type union: expand to include `'WITHDRAWAL'`

**Service changes:**

- `notifyPurchase()` in `PurchaseTrackerService`: populate `network` field from config when creating the purchase record
- `notifyYieldClaim()` in `PurchaseTrackerService`: populate `network` field from config when creating the yield claim record; change `dto: any` parameter type to `dto: NotifyYieldClaimDto`

**DTO changes:**

- `NotifyPurchaseDto`: strengthen `txHash` validation with multi-format regex; update `@ApiProperty` description
- `NotifyYieldClaimDto`: define as a proper typed class with all required fields and multi-format txHash validation; add `@ApiProperty` annotations

**No changes to:**
- The adapter interface (already correct from Phase 2)
- `BidTrackerService` (already uses BLOCKCHAIN_ADAPTER from Phase 2)
- `StellarBlockchainAdapter` verification methods (already implemented from Phase 2)
- The event processing path (already network-agnostic from Phase 1)
- The portfolio calculation logic (handled by the portfolio plan)

---

## Part 9: context.md Update

The `packages/backend/src/modules/marketplace/context.md` file is updated to reflect:
- The `network` field on `Purchase` and `YieldClaim` records and the backward-compatibility rule for pre-existing records
- The `NotifyPurchaseDto` multi-format transaction identifier validation
- The `NotifyYieldClaimDto` proper typing

---

## Part 10: Implementation Sequence

**Step 1 — Update the schemas**
Add the `network` field to `Purchase` and `YieldClaim` schemas. Expand the `metadata.type` union on Purchase. These are additive changes — no existing records are affected, no migration needed.

**Step 2 — Finalize `NotifyYieldClaimDto`**
Read the existing `notify-yield-claim.dto.ts` file. If it is incomplete, replace it with the properly typed class. Add all `@ApiProperty` swagger annotations.

**Step 3 — Harden `NotifyPurchaseDto`**
Add the multi-format regex validator. Update the swagger description. The regex is the only change — all other fields stay the same.

**Step 4 — Update service population**
In `notifyPurchase()`, add the network field population from config before the create call. In `notifyYieldClaim()`, add the same and fix the `dto: any` type annotation. Both are single-line additions.

**Step 5 — Update context.md**
Update the marketplace context.md to reflect the schema additions.

---

## Invariants

- Backward compatibility is absolute. All existing `Purchase` and `YieldClaim` documents that lack a `network` field are treated as `mantle` by consumers. No migration is required before rollout.
- The `network` field must never be set from user input. It is always derived server-side from the active deployment's network config. A bad actor cannot create a purchase record claiming it is from a different network than the deployment is running on.
- Multi-format validation is enforced at the DTO layer only, not at the schema layer. The schema stores any string to preserve flexibility for future network additions without schema migrations.
