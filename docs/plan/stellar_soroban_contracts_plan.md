# Stellar Soroban Smart Contracts Plan — Open Assets

## Executive Summary

This document is the canonical plan for authoring Stellar Soroban smart contracts for the Open Assets RWA tokenization platform. It mirrors the platform's existing 17 deployed EVM contracts on Mantle Sepolia, maps every contract to its Soroban fate (fully supported, adapted, redesigned, or impossible as-is), explains the critical architectural differences between EVM and Soroban that drive those decisions, and proposes a complete Soroban contract suite organized by implementation priority.

The conclusion is that eleven of the seventeen contracts translate to Soroban with high fidelity, four require genuine redesign due to fundamental Stellar differences, and two — the leverage vault and the Fluxion DEX integration — cannot be ported as written because they depend entirely on Mantle-native assets (mETH) and a Mantle-native DEX. Those two become candidates for replacement using Stellar-native infrastructure.

---

## Part 1 — What Makes Soroban Different: The Technical Constraints That Drive Everything

Before touching any individual contract, every engineer working on this must internalize seven foundational differences between Solidity-on-EVM and Rust-on-Soroban. These differences are not implementation quirks — they are load-bearing architectural facts that reshape every design decision.

### 1.1 Storage Has an Expiry (TTL)

This is the single biggest operational difference and the one most likely to surprise EVM engineers. On EVM, any data you write to a mapping lives forever until you explicitly delete it. On Soroban, every ledger entry — every key-value pair you write — has a Time-To-Live measured in ledger sequence numbers. If a ledger entry's TTL expires and nobody has bumped it, it is simply gone. Not archived. Gone.

Soroban provides three storage tiers: Temporary (cheapest, suitable for short-lived data like auction sessions), Persistent (for long-lived data that must survive across months or years, most expensive), and Instance (for contract-wide state tied to the contract's own lifespan). Persistent storage can be indefinitely renewed by paying a fee to extend the TTL, but it must be deliberately managed.

Every contract in this suite that stores long-lived user data — credit lines in OAID, vault positions in SolvencyVault, identity records in IdentityRegistry — must store that data as Persistent entries and must include logic (or an off-chain keeper) to extend TTLs before they expire. This is a non-negotiable operational concern, not an afterthought.

### 1.2 No ECDSA / secp256k1 Signature Verification

The EVM AttestationRegistry uses OpenZeppelin's ECDSA library to recover a signer address from a cryptographic signature and compare it to a whitelist of trusted attestors. This is the standard EVM pattern for off-chain attestation delivery. Soroban's cryptographic host functions natively support Ed25519 signature verification and SHA-256 hashing. They do not provide secp256k1 ECDSA recovery as a host function.

The practical consequence: the attestation model where a backend signs a payload with an Ethereum private key and the contract verifies the signature on-chain does not port to Soroban. Instead, the Soroban AttestationRegistry must use Stellar's native authorization framework — meaning the admin or trusted attestor account signs the transaction itself using their Stellar keypair, and Soroban's built-in `require_auth` call enforces that the correct account authorized the invocation. The semantic result is identical (only trusted parties can register attestations) but the cryptographic mechanism is different.

### 1.3 A Completely Different Token Standard

EVM has ERC-20. Soroban has the Soroban Token Interface, often called SEP-41. Both are fungible token standards. Both support transfer, approve, allowance, balance queries, and minting. But they are not the same interface, and more importantly, the authorization model is completely different.

ERC-20 uses `msg.sender` to determine who is authorizing a transfer. Soroban tokens use Stellar's native authorization invocations, meaning the token holder explicitly authorizes specific contract calls to spend specific amounts of their tokens. This eliminates entire classes of approval bugs but requires different coding patterns throughout. Every place in our contracts where we call `token.transferFrom(user, contract, amount)` needs to be redesigned as a Soroban cross-contract invocation with proper authorization flows.

Additionally, Stellar's native asset USDC is issued by Circle directly on the Stellar network. It is represented on-chain as a Stellar Asset Contract (SAC). This means there is no MockUSDC needed for production Stellar — the real USDC SAC address is used directly. Test environments use Stellar Testnet where USDC test tokens are available via Friendbot-equivalent mechanisms.

### 1.4 No OpenZeppelin

Every security primitive we currently rely on — ReentrancyGuard, Ownable, SafeERC20, ECDSA, ERC20Burnable — comes from OpenZeppelin. None of these exist for Soroban. The Soroban ecosystem has community libraries, but they are not as mature or battle-tested as OpenZeppelin.

Reentrancy in Soroban is actually structurally less dangerous than in EVM because Soroban does not allow re-entering a contract during execution by default (the host enforces this). However, Ownable patterns (admin access control), pausable patterns, and safe token transfer wrappers must all be hand-written as reusable Rust modules within this contract suite.

### 1.5 Authorization is First-Class, Not Bolted On

Soroban's authorization framework treats account-level signatures as a first-class primitive. Rather than checking `msg.sender == owner` everywhere, Soroban contracts invoke `env.require_auth(address)` which causes the runtime to verify that the specified address has signed and authorized this specific contract invocation with these specific arguments. This is more powerful than msg.sender because the authorization can be arbitrarily structured, but it requires the calling application to construct transactions that carry the correct authorization entries.

The practical impact: our backend must construct Stellar transactions with the correct authorization structure when acting as admin or platform wallet. This is handled at the adapter layer described in the cross-network architecture plan, but the contracts themselves are written against this model from the ground up.

### 1.6 Contract Factory Mechanics

The EVM TokenFactory deploys new RWAToken contracts using the standard Solidity `new Contract()` constructor pattern. In Soroban, deploying a contract from within another contract requires a two-step process: the WASM bytecode must be uploaded to the Stellar network first (yielding a WASM hash), and then the factory contract invokes the deployer host function with that WASM hash plus a unique salt to instantiate a new contract at a deterministic address. The factory must know the WASM hash of the token contract at the time of deployment. This requires a slightly different deployment workflow where token WASMs are pre-uploaded before the factory is deployed.

### 1.7 Cross-Contract Calls Have Resource Costs

Soroban uses a resource model rather than gas. Resources include CPU instructions, read/write bytes to ledger, and memory. Each cross-contract call consumes resources from the transaction's budget. Deeply nested call chains — like SolvencyVault calling OAID, which checks IdentityRegistry, which then calls ComplianceModule — can exhaust resource limits. The contract architecture must be mindful of call depth and must not replicate EVM patterns that assume unlimited call nesting.

---

## Part 2 — Contract-by-Contract Analysis

### 2.1 Fully Supported — Direct Port with Language Translation

These contracts have no fundamental architectural blockers. Their logic translates to Rust/Soroban with no conceptual redesign beyond the language change and the storage TTL consideration.

**IdentityRegistry** — The simplest contract in the suite. Stores a mapping of wallet address to verification status and timestamp. On Soroban, this becomes a Persistent storage map keyed by Stellar account address. The trusted issuer whitelist check becomes a `require_auth` call against a registered issuer address. The batch registration function ports as-is. TTL management is required for identity records that must persist indefinitely. There are no blockers.

**TrustedIssuersRegistry** — An even simpler whitelist. Stores a set of addresses that are authorized to act as KYC issuers. A direct port to Soroban persistent storage with owner-only mutation. No blockers.

**YieldVault** — The burn-to-claim mechanics translate perfectly to Soroban. The settlement deposit function transfers USDC from the platform wallet to the contract. The claim function burns RWA tokens (via the Soroban token interface burn method) and transfers pro-rata USDC out. The pro-rata calculation is pure math with no EVM-specific primitives. Storage for settlement data is straightforward Persistent storage. The deprecated backwards-compatibility functions from the EVM version should not be ported — start clean.

**PrimaryMarket** — The static pricing path ports directly. The Dutch auction path is also fully portable: Soroban provides ledger close timestamps which can be used for time-based price decay. Bid submission with USDC escrow (transferring USDC from bidder to contract) works through Soroban token invocations. Clearing price logic and pro-rata allocation for oversubscribed auctions are pure math. The oversubscription cap logic ports directly. KYC gating by calling IdentityRegistry as a cross-contract call is supported.

**SecondaryMarket** — The maker-taker order book is entirely logic-based. Order creation with escrowed USDC (for buy orders) or escrowed tokens (for sell orders) works through Soroban token transfers. Partial fill logic is pure arithmetic. Order cancellation with refund is straightforward. The yield settlement batch operation — which cancels buy orders and routes sell orders through YieldVault's burn path — ports with minor adaptation to Soroban's token interface. KYC gating via cross-contract call to IdentityRegistry works. No blockers.

**SeniorPool** — Linear interest accrual using ledger timestamps instead of block timestamps is fully supported. The 5% APR calculation, the 20% reserve ratio enforcement, the borrow/repay lifecycle, and the demo mode multiplier all port directly to Rust. USDC is available natively on Stellar. No blockers. This contract is a good candidate for early implementation to validate the Stellar USDC integration.

### 2.2 Supported with Adaptation — Core Logic Ports, Mechanism Changes Required

These contracts have all the right features but require thoughtful redesign of specific mechanisms due to the Soroban differences described in Part 1.

**AttestationRegistry** — The asset registration workflow, the revocation workflow, and the validity check all port directly. What changes is the attestation verification mechanism. Instead of recovering a secp256k1 signer from a raw signature, the Soroban version trusts that the invoking account is authorized by virtue of Stellar's native authorization. The trusted attestor must be an on-chain registered Stellar account address. When the backend calls `register_asset`, it signs the transaction as the attestor account, and the contract calls `require_auth` against the attestor account before storing the record. The semantic result — only trusted parties can register attestations — is preserved. The blob ID and attestation hash fields port as-is and are stored as contract metadata providing off-chain integrity proof. Ed25519 signature verification for the payload hash is possible if desired and would add an additional layer of cryptographic proof that the off-chain attestation content is authentic.

**ComplianceModule** — The transfer hook pattern is the key challenge. On EVM, RWAToken overrides `_update` to call ComplianceModule. Soroban's Token Interface does not have a hook point in the protocol standard itself — custom token contracts can implement their own transfer methods that call a compliance contract as a side effect, but the standard SAC (Stellar Asset Contract) wrapper does not support this. The solution is to implement RWAToken as a fully custom token contract that implements the Soroban Token Interface manually, giving us full control to inject compliance checks. This is the standard approach for compliance-aware tokens in Soroban. The ComplianceModule itself becomes a separate contract that the token calls via cross-contract invocation. The force-transfer and pause features of RWAToken also require the custom implementation path.

**RWAToken and PrivateAssetToken** — As described above, these must be custom Soroban Token Interface implementations rather than SAC wrappers. The base RWAToken implements all seven Soroban Token Interface methods (transfer, transfer_from, approve, allowance, balance, total_supply, decimals/name/symbol metadata) plus the compliance hook, forced transfer, and pause capability. PrivateAssetToken extends this with on-chain metadata fields (asset type, location, document hash, valuation history). The valuation history as an append-only array is feasible in Soroban using persistent storage with indexed keys. The burn method is part of the standard interface and ports directly.

**TokenFactory** — Fully possible but requires the two-step WASM deployment process. The factory must be initialized with the WASM hashes of both the RWAToken and PrivateAssetToken contracts before it can deploy them. The deployment function then uses Soroban's deploy host function to instantiate new contract instances at deterministic addresses using a salt derived from the asset ID. The cross-contract registration call to YieldVault after deployment works via cross-contract invocation. The duplicate deployment guard (checking if an asset already has a token) ports directly. The factory must emit deployment events that the backend's event listener can pick up.

**SolvencyVault** — This is the most complex contract in the portable category. The core position lifecycle — deposit, borrow, repay, withdraw — translates to Soroban with careful Rust modeling. The two-token-type distinction (RWA token vs PrivateAsset token) ports as an enum parameter. The LTV calculations are pure math. The repayment schedule struct with installment tracking ports to Soroban storage. The liquidation mechanics for RWA tokens (burn to USDC via YieldVault) translate as cross-contract calls. The PrivateAsset liquidation path (admin purchase) ports as a special admin-authorized flow. The biggest concerns are call depth (SolvencyVault calls OAID, IdentityRegistry, token contracts, and USDC — that is five contracts deep in some flows) and TTL management for position data that may sit dormant for months. Both are solvable with careful architecture.

**OAID** — The credit scoring algorithm, credit line management, payment history tracking, and credit score computation all port as pure logic. The credit history arrays must use indexed Persistent storage with careful TTL management. The OAID registration check (is user in IdentityRegistry) becomes a cross-contract call. The SolvencyVault authorization check (only SolvencyVault can issue credit lines) becomes a stored authorized-caller address plus require_auth pattern. The score calculation formula is pure arithmetic with no EVM primitives. The main concern is data longevity — credit histories must survive for years, requiring active TTL extension.

### 2.3 Not Possible As-Is — Mantle-Specific, Require Redesign or Replacement

**LeverageVault** — This contract's entire premise is mETH (Mantle Liquid Staked ETH) as collateral. mETH is an ERC-20 token that exists exclusively on the Mantle network. It does not exist on Stellar. The leverage system additionally depends on the FluxionDEX for mETH-to-USDC swaps. FluxionDEX does not exist on Stellar. The 150% LTV logic, the SeniorPool borrowing, the harvest-swap-repay cycle, the multi-stage liquidation waterfall — all of this is architecturally sound and can be ported to Soroban — but only if a suitable collateral asset is chosen. On Stellar, the natural equivalent would be XLM (Stellar's native asset) or a Stellar-native liquid staking token, and swaps would go through Stellar's native SDEX (Stellar Decentralized Exchange) path payments. The contract is therefore not porteable as written but is redesignable as a StellarLeverageVault using XLM or an LST as collateral and SDEX for swaps. This is explicitly out of scope for the initial Soroban rollout but is a well-defined future work item.

**FluxionIntegration** — Fluxion is a Mantle-native DEX. It does not exist on Stellar. This contract is entirely Mantle-specific and cannot be ported. Its replacement for Stellar would be a StellarDEXIntegration contract that wraps Stellar's native path payments — the built-in liquidity mechanism of the Stellar network that automatically finds optimal conversion routes between any two assets through the order book and liquidity pools. If a future StellarLeverageVault is built, it would use the StellarDEXIntegration for its swap operations.

### 2.4 Test / Mock Contracts — Different Story on Stellar

**MockUSDC** — Not needed. Circle's USDC is a first-class citizen on Stellar, available on testnet. Test environments use testnet USDC SAC directly.

**MockMETH** — Not applicable. mETH does not exist on Stellar. If StellarLeverageVault is eventually built, a test LST token contract would be created.

**MockFluxionDEX** — Not applicable. Would be replaced by a mock that simulates SDEX path payments.

**Faucet and METHFaucet** — Stellar Testnet has Friendbot which provides XLM. A custom Faucet contract for issuing test RWA tokens during development is still useful. The USDC faucet becomes unnecessary since testnet USDC is accessible.

---

## Part 3 — The Soroban Contract Suite

Based on the analysis above, the Stellar Soroban contract suite consists of the following contracts organized into the same folder structure as the EVM contracts but under a new `packages/stellar-contracts/` package.

### 3.1 Core Registry Contracts

**soroban-identity-registry** — Persistent storage mapping Stellar account IDs to KYC verification status and timestamp. Admin functions require authorization from the contract's admin account. Batch registration supported. TTL extension logic built-in for persistent entries.

**soroban-trusted-issuers-registry** — Persistent set of Stellar account IDs authorized to act as KYC issuers. Owner-only mutation. Referenced by IdentityRegistry to validate who can call registration functions.

**soroban-attestation-registry** — Persistent storage of asset attestation records keyed by asset ID (a 32-byte hash). Assets have status (active/revoked), attestation hash, blob ID for off-chain data, and attestor address. Registration authorized via require_auth against the trusted attestor account. Ed25519 payload hash verification is included as an optional additional proof layer.

### 3.2 Token Infrastructure

**soroban-rwa-token** — Custom Soroban Token Interface implementation for RWA tokens. All seven interface methods implemented. Transfer and transfer_from inject a cross-contract compliance check against the linked ComplianceModule contract. Pause functionality blocks all transfers when active. Forced transfer available to admin only. Emits standard token events plus custom compliance events.

**soroban-private-asset-token** — Extends soroban-rwa-token with on-chain metadata storage: asset type, geographic location, document hash, and a timestamped valuation history. Valuation records are appended chronologically. Metadata updates are admin-only. All token interface methods inherited from the base token logic.

**soroban-compliance-module** — Stateless compliance check contract. Given a sender address, receiver address, and amount, it calls soroban-identity-registry to verify both are KYC-verified, and calls soroban-attestation-registry to verify the asset is not revoked. Returns a boolean result. Registered in each token contract at deployment.

**soroban-token-factory** — Deploys new soroban-rwa-token and soroban-private-asset-token instances using pre-uploaded WASM hashes. Tracks deployed tokens by asset ID in a Persistent map. Calls soroban-yield-vault after token deployment to register the new token for yield distribution. Prevents duplicate deployments for the same asset ID. Emits deployment events.

### 3.3 Financial Infrastructure

**soroban-yield-vault** — Tracks settlement USDC for registered RWA tokens. Settlement deposits record total USDC and total token supply at settlement time. Claim function burns tokens via the Soroban token interface and transfers pro-rata USDC to the claimer. Settlement data is Persistent storage. Emits events for settlement deposits and yield claims.

**soroban-senior-pool** — USDC lending pool for leverage positions (future use for StellarLeverageVault). Deposits and withdrawals with 20% reserve enforcement. Linear 5% APR interest accrual using Stellar ledger timestamps. Authorized-only borrowing with position tracking. Repayment with interest split calculation. All state is Persistent.

**soroban-solvency-vault** — The most complex contract. Position lifecycle management for RWA and PrivateAsset token collateral deposits. Borrowing USDC against collateral at configured LTV ratios (70% for RWA, 60% for PrivateAsset). Installment-based repayment schedule generation and tracking. Missed payment and default marking. Health factor calculation. Liquidation trigger and settlement flows for both token types. OAID credit line issuance upon deposit. All position data in Persistent storage with TTL management.

**soroban-oaid** — On-chain credit identity and scoring system. User registration tied to KYC verification. Credit line issuance, updates, and revocation exclusively by SolvencyVault. Payment recording with on-time/late flags. Algorithmic credit score calculation from payment history, volume, and liquidation events. Full payment history in Persistent storage with TTL management. Credit profile aggregation views.

### 3.4 Marketplace

**soroban-primary-market** — Primary marketplace for initial token sales. Static pricing mode and Dutch auction mode. Auction listings use ledger timestamps for duration tracking. Bid submission with USDC escrow. Auction closure with clearing price set by admin. Bid settlement with pro-rata allocation for oversubscribed auctions and USDC refund for underbid amounts. Minimum investment enforcement. KYC gating via IdentityRegistry cross-contract call.

**soroban-secondary-market** — P2P order book for token trading post-primary market. Limit orders for both buy (USDC escrow) and sell (token escrow) directions. Partial fill support with remaining amount tracking. Order cancellation with escrow refund. KYC gating. Yield settlement batch operation for processing open orders during settlement events — buy orders refunded, sell orders routed through YieldVault for burn-to-USDC conversion.

### 3.5 Future — Stellar-Native Leverage (Out of Scope for Initial Release)

**soroban-stellar-dex-integration** — Wrapper around Stellar's native SDEX path payments for asset-to-USDC conversion. This replaces FluxionIntegration. Uses Stellar's built-in DEX which provides automatic routing across liquidity pools and order books. Slippage protection via minimum output amount parameters.

**soroban-stellar-leverage-vault** — Redesigned leverage system using XLM or a Stellar-native LST as collateral instead of mETH. Uses soroban-senior-pool for USDC borrowing and soroban-stellar-dex-integration for yield harvest swaps. Same conceptual lifecycle (position creation, yield harvest, liquidation waterfall) as EVM LeverageVault but with Stellar-native assets.

---

## Part 4 — Architectural Decisions and Non-Obvious Design Choices

### 4.1 TTL Management Strategy

Rather than hoping the backend keeps every ledger entry alive, contracts that own critical long-lived data (IdentityRegistry, OAID, SolvencyVault, YieldVault) must implement an explicit TTL extension call. Each of these contracts will expose a `bump_ttl(key)` function that the backend's keeper service can call on a schedule. The keeper service will maintain a registry of all active positions, credit lines, and identity records and periodically extend their TTL before expiry. A TTL of two years (in ledger count) should be the minimum for any position or identity data. This is not optional — it is the operational contract of running on Stellar.

### 4.2 Admin Authorization Model

Every contract follows a consistent admin model. Each contract has an admin address stored at initialization. Admin-only functions call `require_auth` against this address before executing. The admin address can be upgraded by the current admin. This mirrors the Ownable pattern but using Stellar's native auth rather than msg.sender checks. The platform should maintain a separate admin keypair per contract environment (testnet, mainnet).

### 4.3 Cross-Contract Call Budgeting

For SolvencyVault — the contract with the deepest call chain — a conservative call architecture is required. The deepest call chain is: SolvencyVault → OAID → IdentityRegistry. Add in USDC token calls and that is four contracts. This is within Soroban's cross-contract call limits but must be tested against the Soroban resource model. If resource exhaustion occurs in complex flows (like `depositCollateral` which issues an OAID credit line), the solution is to break atomic operations into multi-step transactions where the backend coordinates the steps rather than the contract doing everything in one invocation.

### 4.4 Event Design

Every state-changing operation emits a Soroban contract event with a structured topic and data payload. The backend's Stellar event adapter subscribes to these events via the Soroban RPC `getEvents` method with cursor-based pagination. Event topics should follow a consistent naming convention that allows filtering by contract and event type. Events are the primary synchronization mechanism between the on-chain state and the MongoDB database, so they must be comprehensive — every field that the backend needs to update its database must appear in the event payload.

### 4.5 No Backwards Compatibility Layer

The EVM contracts carry deprecated functions for backwards compatibility with older backend code. When writing Soroban contracts, start from the current intended interface. There is no legacy backend code calling Soroban contracts yet, so there is no reason to carry deprecated patterns forward. The YieldVault's deprecated `depositYield` and `claimAllYield` functions, for example, should not appear in the Soroban version.

### 4.6 USDC Decimal Handling

Stellar USDC (Circle's official issuance) uses 7 decimal places (Stellar's standard precision), not 6 decimal places like EVM USDC. Every contract that handles USDC amounts must be written against 7 decimal precision (10^7 = 1 USDC). This affects yield calculations, repayment amounts, health factor math, and any constant that currently assumes 1e6 per USDC. This is a subtle but critical difference that must be codified in a shared contract constant.

---

## Part 5 — What Stellar Enables Beyond EVM

Writing these contracts natively for Stellar opens capabilities that would be difficult or expensive to replicate on EVM:

**Native DEX Integration** — Stellar's built-in SDEX provides instant access to liquidity across all Stellar assets without deploying a DEX contract or integrating a third-party protocol. The PrimaryMarket could optionally accept any Stellar asset (not just USDC) by routing through SDEX path payments to acquire USDC at settlement time.

**No Mock USDC Complexity** — Real USDC works on Stellar testnet. Testing with real Circle-issued USDC removes an entire class of mock-related bugs where the mock behaved differently from production.

**Stellar Accounts as Native Identity** — Stellar accounts are inherently wallet addresses with identity capabilities. The IdentityRegistry can leverage the fact that Stellar accounts already have associated data (signers, thresholds, home domain) that can enrich the KYC model.

**Real-World Asset Anchor Integration** — Stellar has a robust ecosystem of regulated asset issuers (Anchors under SEP-24/31) that could allow verified RWA token holders to redeem tokens through regulated off-ramps without additional infrastructure.

**Multi-Signature Threshold Accounts** — Stellar accounts natively support multi-signature requirements with threshold levels. Admin operations on high-value contracts (like SolvencyVault liquidation settlement) can be gated behind a multi-sig Stellar account without any custom smart contract logic for that capability.

---

## Part 6 — Summary Table

| EVM Contract            | Soroban Status          | Key Change                                   |
|-------------------------|-------------------------|----------------------------------------------|
| AttestationRegistry     | Adapted                 | Ed25519 auth instead of ECDSA recovery       |
| IdentityRegistry        | Direct Port             | TTL management added                         |
| TrustedIssuersRegistry  | Direct Port             | None                                         |
| ComplianceModule        | Adapted                 | Cross-contract invocation instead of hook    |
| RWAToken                | Adapted                 | Custom Soroban Token Interface implementation|
| PrivateAssetToken       | Adapted                 | Same as RWAToken plus metadata               |
| TokenFactory            | Adapted                 | WASM hash based deployment                   |
| YieldVault              | Direct Port             | Deprecated functions removed                 |
| SeniorPool              | Direct Port             | Stellar timestamps, real USDC                |
| SolvencyVault           | Adapted                 | TTL management, call depth discipline        |
| OAID                    | Adapted                 | TTL management, payment history persistence  |
| PrimaryMarket           | Direct Port             | Stellar timestamps                           |
| SecondaryMarket         | Direct Port             | Soroban token interface integration          |
| LeverageVault           | Not Possible As-Is      | Redesigned as StellarLeverageVault (future)  |
| FluxionIntegration      | Not Possible As-Is      | Replaced by StellarDEXIntegration (future)   |
| MockUSDC                | Not Needed              | Real USDC SAC on testnet                     |
| MockMETH                | Not Applicable          | mETH does not exist on Stellar               |
| MockFluxionDEX          | Not Applicable          | Replaced by SDEX mock (future)               |
| Faucet                  | Replaced                | Stellar Friendbot + minimal test token faucet|

---

## Part 7 — Implementation Sequence

Phase one establishes the registry layer that everything else depends on: TrustedIssuersRegistry, IdentityRegistry, and AttestationRegistry. No financial logic, no tokens — just identity and attestation infrastructure. This validates the TTL management pattern and the authorization model in isolation.

Phase two builds the token layer: ComplianceModule, RWAToken, PrivateAssetToken, and TokenFactory. At the end of this phase it must be possible to deploy a compliant RWA token for a given attested asset ID on Stellar testnet.

Phase three builds the marketplace layer: PrimaryMarket and SecondaryMarket. YieldVault is also built in this phase since it is required for PrimaryMarket settlement. At the end of this phase, a token can be listed, purchased, and traded on Stellar testnet.

Phase four builds the financial infrastructure: SeniorPool, SolvencyVault, and OAID. These are the most complex contracts and depend on everything from previous phases.

Phase five — future work — builds StellarDEXIntegration and StellarLeverageVault as Stellar-native replacements for the Mantle-specific leverage system.

Each phase must produce deployed testnet contract IDs that are added to the Stellar network config in the backend. The event adapter for Stellar must be operational by the end of Phase 1 to verify that events flow through the BullMQ pipeline correctly.
