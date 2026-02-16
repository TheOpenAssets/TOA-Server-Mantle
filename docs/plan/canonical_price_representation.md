# Canonical Price & Amount Representation

**Author:** Architecture Planning
**Date:** February 16, 2026
**Scope:** Establishes the universal rule for how all monetary values — prices, token amounts, payment totals, yields, fees — are represented, stored, and transmitted across the entire backend, regardless of which blockchain network the values originated from.

---

## The Problem This Solves

Every blockchain has its own internal precision convention. Mantle EVM stores token amounts as 18-decimal integers and USDC as 6-decimal integers. Stellar stores amounts as 7-decimal stroops. Future chains may use entirely different conventions.

Without a canonical representation, the backend's business logic, schemas, and service calculations each carry implicit assumptions about which decimal convention is in use. This is exactly what caused the price scaling conflict identified in the auction plan: `StellarAdminStrategy` divides by `10^10` on the way to Stellar, but `verifyBidTransaction` returns raw chain values without applying the inverse, so the `usdcDeposited` calculation in `BidTrackerService` ends up with a value that is wrong by a factor of `10^10`.

The fix is a boundary rule: all network-specific precision is resolved at the adapter layer, and everything inside the backend from that point onward lives in one canonical format.

---

## The Rule

**The backend canonical format for all prices and amounts is a decimal string with exactly 4 places after the decimal point.**

`"1.2345"` not `"1234500"` or `"1000000000000000000"`.

This applies to:
- Price per token (USDC per token, or native currency per token)
- Total payment amount (USDC paid for a purchase)
- Token balance (how many tokens a user holds)
- Yield received
- Collateral amounts
- Borrowed amounts
- Fees

Every schema field, every service calculation, every DTO response uses this format. The 4-decimal format is what MongoDB stores. The 4-decimal format is what services pass to each other. The 4-decimal format is what controllers return to the frontend.

---

## The Raw Precision Companion Fields

4 decimal places cannot represent every value exactly. There are two scenarios:

**Scenario A: Precision loss beyond 4 decimals**

A value like `5.89000000005678` cannot be fully expressed in 4 decimal places. Rounding to `5.8900` loses the tail `000000005678`.

In this case:
- The main price field stores the 4-decimal rounded value: `"5.8900"`
- A boolean companion field `rawPrecise: true` signals that precision was lost
- A string companion field `rawPrice: "5.89000000005678"` stores the full exact value from the chain

**Scenario B: Value below 4-decimal resolution**

A value like `0.000000000018` (e.g., `18 × 10^-12` of mETH swapped) rounds to `0.0000` in 4-decimal format.

In this case:
- The main price field stores `"0.0000"`
- `rawPrecise: true` signals that the zero is not actually zero
- `rawPrice: "0.000000000018"` stores the actual value

**Scenario C: Value exactly representable in 4 decimals**

A value like `1.2500` or `100.0000`. No precision is lost.

In this case:
- The main price field stores `"1.2500"`
- `rawPrecise: false` (or the field is simply absent — consumers treat absence as false)
- `rawPrice` is absent or null

**Consumer rule for display:**
If `rawPrecise` is `false` or absent, display the 4-decimal value directly.
If `rawPrecise` is `true`, the raw precision value is available in `rawPrice` for display. The 4-decimal value is still valid as an approximation for sorting, comparisons, and calculations that do not require full precision.

---

## The Boundary: Adapter Layer

The adapter layer is the exclusive location where conversion between chain-native precision and the 4-decimal canonical format happens. Nothing outside the adapter ever sees raw wei, raw stroops, or raw chain integer amounts.

### Inbound (chain → backend)

Every adapter method that returns a price or amount value must convert to the 4-decimal canonical format before returning. The `PurchaseVerificationResult`, `BidVerificationResult`, `BidSettlementResult`, and all other adapter return types must carry their numeric fields as 4-decimal canonical strings.

The adapter also sets `rawPrecise` and `rawPrice` on each field where precision loss occurs.

**EVM Adapter inbound conversion:**
- Token amounts: divide the 18-decimal integer by `10^18`, round to 4 decimal places, detect precision loss
- USDC amounts: divide the 6-decimal integer by `10^6`, round to 4 decimal places, detect precision loss
- All other EVM values follow the appropriate divisor for their token's configured decimal count

**Stellar Adapter inbound conversion:**
- Native asset amounts (7-decimal stroops): divide by `10^7`, round to 4 decimal places
- USDC amounts: divide by `10^6`, round to 4 decimal places

### Outbound (backend → chain)

Every adapter method that sends a price or amount to the chain must convert from the 4-decimal canonical format to the chain's native precision.

**EVM Adapter outbound conversion:**
- Token amounts: multiply by `10^18`
- USDC amounts: multiply by `10^6`

**Stellar Adapter outbound conversion:**
- Native asset amounts: multiply by `10^7`
- USDC amounts: multiply by `10^6`

The `STELLAR_PRICE_DIVISOR` currently embedded in `StellarAdminStrategy.listOnMarketplace()` must move into the Stellar adapter. It must not live in a strategy or service — it is a chain-communication concern and belongs exclusively in the adapter.

---

## Precision Loss Detection

The adapter's conversion utilities must detect whether a given chain value introduces precision loss when rounded to 4 decimal places.

The detection logic is: convert the chain integer to a full-precision decimal string, then check whether the portion beyond 4 decimal places is non-zero.

If it is non-zero, set `rawPrecise: true` and populate `rawPrice` with the full-precision decimal string.

The full-precision decimal string in `rawPrice` is always in plain decimal notation, not scientific notation. `"0.000000000018"` not `"1.8e-11"`. This makes it unambiguous to parse and display on the frontend without needing to handle scientific notation edge cases.

---

## Impact on Existing Schemas

The existing schemas — `Purchase`, `Bid`, `YieldClaim`, `LeveragePosition`, `SolvencyPosition` — currently store amounts as raw integer wei strings (e.g., `"1000000000000000000"` for 1 token). This was a deliberate design to avoid JavaScript floating point issues.

**Migration approach:**
- Existing records are not retroactively changed. They remain as wei strings.
- All new schemas (`UserPortfolio`, any new schemas created going forward) use the 4-decimal canonical format from the start.
- Services that read existing schemas and produce portfolio aggregates or API responses are responsible for converting the old wei strings to 4-decimal format at the service layer before returning data. This conversion is a one-time normalization step, not a schema migration.
- Over time, as schemas are revised for other reasons, their amount fields will be updated to the 4-decimal format. This is opportunistic, not forced.

The `UserPortfolioSchema` (defined in the portfolio plan) stores all amounts in 4-decimal canonical format. The `UserPortfolioService` converts old-format wei values from the `Purchase` and `LeveragePosition` schemas into 4-decimal format when building the portfolio document.

---

## The Raw Precision Fields as Schema Pattern

Any schema that stores a price or amount field must optionally carry the raw precision companion fields. The pattern, applied consistently, is:

A price field named `price` has two optional companions: `rawPrecise` (boolean) and `rawPrice` (string). The same for `amount` → `rawAmount`, `totalPayment` → `rawTotalPayment`, `yield` → `rawYield`, and so on.

New schemas created under this plan include these companion fields on every monetary field. Existing schemas have them added opportunistically or when precision matters for the specific domain (for example, `LeveragePosition.harvestHistory` mETH amounts, where values can legitimately be sub-0.0001, should have the companion fields added as a priority).

---

## No Cross-Chain Price Feeds

The price representation defined here is per-network. A price that originates from a Mantle chain event is converted to the 4-decimal canonical format by the EVM adapter. A price that originates from a Stellar chain event is converted by the Stellar adapter. The two chains never share price feed data with each other.

There is no price oracle layer that translates mETH prices for a Stellar deployment, or Stellar XLM prices for a Mantle deployment. Each deployment's backend works exclusively with the assets and prices native to its configured network.

---

## Summary of All Price Representation Rules

| Rule | Description |
|---|---|
| Canonical format | 4 decimal places, decimal string, e.g. `"1.2345"` |
| Schema storage | New schemas: 4-decimal canonical. Existing schemas: keep wei until migrated |
| Precision loss | `rawPrecise: true` + `rawPrice: "<full string>"` on companion fields |
| Boundary enforcement | Only adapters convert between chain precision and canonical format |
| Chain-specific conversion | EVM: `/10^18` tokens, `/10^6` USDC. Stellar: `/10^7` stroops, `/10^6` USDC |
| No cross-chain prices | Each network handles its own units; no feed sharing |
| Consumer display rule | Show `rawPrice` when `rawPrecise === true`, else show 4-decimal value |
| Zero vs near-zero | `"0.0000"` with `rawPrecise: true` means non-zero, check `rawPrice` |

---

## Files This Spec Affects

Every plan document that mentions amount conversions, wei values, or price formats must be updated to reference this spec as the authority. Specifically:

- `cross_network_modification_plan.md` — The canonical amount convention section (Part 5) is superseded by this document
- `chain_agnostic_backend_phase2_primary_marketplace_purchase.md` — Parts 5 and 12 are superseded by this document
- `chain_agnostic_purchase_notify_static_models.md` — The decimal convention discussion defers to this document
- `chain_agnostic_auction_flow_stellar_plan.md` — The price scaling conflict (Part 8) is resolved by this document: the Stellar adapter handles all stroop-to-canonical conversion, the `STELLAR_PRICE_DIVISOR` logic moves fully into the adapter, and `verifyBidTransaction` / `verifyBidSettlement` return canonical 4-decimal values
- `user_portfolio_schema_plan.md` — Portfolio schema uses 4-decimal canonical from the start

---

## Implementation Note for the Auction Plan Specifically

The `STELLAR_PRICE_DIVISOR = 10^10` currently in `StellarAdminStrategy.listOnMarketplace()` represents a conversion that belongs in the Stellar adapter. When this plan is implemented:

1. The strategy sends the canonical 4-decimal price to the registry
2. The Stellar adapter receives the canonical price and converts to Stellar stroop format internally before invoking the contract
3. When `verifyBidTransaction` reads a bid price from a Soroban event, the Stellar adapter converts from stroop format back to canonical 4-decimal before returning the `BidVerificationResult`
4. `BidTrackerService.notifyBid()` receives canonical 4-decimal values and never performs any chain-specific arithmetic

The `usdcDeposited` calculation in `notifyBid()` becomes straightforward arithmetic on two 4-decimal numbers with no implicit assumptions about decimal precision.
