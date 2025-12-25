# RWA Platform Architecture Guide

## Table of Contents
1. [System Overview](#system-overview)
2. [Core Contracts](#core-contracts)
3. [Contract Interactions](#contract-interactions)
4. [Asset Lifecycle Flow](#asset-lifecycle-flow)
5. [Yield Distribution Mechanism](#yield-distribution-mechanism)
6. [Dutch Auction Feasibility](#dutch-auction-feasibility)
7. [Current Limitations & Considerations](#current-limitations--considerations)

---

## System Overview

This platform tokenizes Real-World Assets (RWAs) - specifically **invoices** - into ERC-20 tokens that can be traded on a primary marketplace. The system ensures:

- **Cryptographic Proof**: Assets are hashed, merkle-rooted, and attested by trusted parties
- **KYC/Compliance**: Only verified investors can hold/transfer tokens
- **Yield Distribution**: Invoice payments flow back to current AND historical token holders
- **Regulatory Control**: Platform can pause, revoke, or force transfers when needed

**Key Innovation**: The yield distribution mechanism ensures that anyone who ever held the token gets proportional yield, not just current holders.

---

## Core Contracts

### 1. AttestationRegistry
**Purpose**: Immutable record of asset attestations

**What it does**:
- Stores cryptographic proof that an asset (invoice) is legitimate
- Maintains hash of asset data, blob ID (for data availability), and trusted attestor signature
- Allows platform to revoke invalid assets
- Validates that assets are "real" before tokenization

**Key Concept**: Think of this as a **notary service on-chain**. Before any invoice can be tokenized, it must be registered here with a cryptographic attestation proving its validity.

**Data Stored**:
- Asset ID (unique identifier)
- Attestation Hash (hash of invoice data + metadata)
- Blob ID (reference to off-chain data storage via EigenDA)
- Attestor address (who verified this asset)
- Timestamp
- Revocation status

**Trust Model**: Only addresses in `trustedAttestors` mapping can attest assets. Signatures are verified on-chain.

---

### 2. IdentityRegistry
**Purpose**: KYC whitelist for all participants

**What it does**:
- Maintains list of KYC-verified wallet addresses
- Controls who can receive/send RWA tokens
- Required for compliance checks during token transfers

**Key Concept**: This is the **bouncer at the door**. No wallet can participate in the RWA ecosystem (buy, sell, hold tokens) unless registered here.

**Registration Flow**:
- Admin calls `registerIdentity(walletAddress)`
- Wallet is marked as verified
- ComplianceModule checks this registry on every token transfer

**Important**: BOTH sender and receiver must be verified for any transfer to succeed (except minting to platform custody).

---

### 3. TrustedIssuersRegistry
**Purpose**: Whitelist of approved asset originators

**What it does**:
- Tracks which entities (companies, institutions) can issue RWA tokens
- Provides credibility layer for asset originators
- Allows platform to add/remove issuers

**Key Concept**: Not all invoices are equal. Only **pre-approved businesses** can tokenize their invoices.

**Current State**: Not actively enforced in token deployment, but available for future issuer verification.

---

### 4. ComplianceModule
**Purpose**: Transfer rules enforcement engine

**What it does**:
- Deployed per-asset (each RWA token has its own ComplianceModule)
- Checks three conditions on every transfer:
  1. Sender is KYC verified (IdentityRegistry)
  2. Receiver is KYC verified (IdentityRegistry)
  3. Asset is still valid (AttestationRegistry - not revoked)

**Key Concept**: This is the **gatekeeper** that runs on every token transfer. Even if you have tokens, you can't send them unless compliance passes.

**Why Per-Asset**: Different assets might have different compliance rules in future (accredited vs. retail investors, jurisdictional restrictions, etc.)

---

### 5. RWAToken (ERC-20)
**Purpose**: The actual tokenized representation of an invoice

**What it does**:
- Standard ERC-20 token with compliance hooks
- Mints total supply to platform custody at deployment
- Overrides `_update` hook to enforce compliance on transfers
- Can be paused by owner (platform) in emergencies
- Allows forced transfers by owner (regulatory requirement)

**Key Concept**: This is the **tradable asset**, but with guardrails. Every transfer triggers ComplianceModule checks.

**Unique Features**:
- Linked to specific assetId (the invoice it represents)
- Connected to ComplianceModule (transfer rules)
- Connected to IdentityRegistry (KYC checks)
- Pausable (emergency stop)
- Forced transfer capability (court order compliance)

**Token Lifecycle**:
1. Deployed by TokenFactory with total supply
2. All tokens minted to platform custody
3. Listed on PrimaryMarket for initial sale
4. Investors buy tokens (transfer from custody → investor)
5. Tokens can be traded peer-to-peer (if both parties KYC'd)
6. Yield accrues to all current + past holders

---

### 6. TokenFactory
**Purpose**: Deploys the token suite for each asset

**What it does**:
- Creates RWAToken + ComplianceModule as a pair
- Registers asset in YieldVault for future yield distribution
- Enforces that only attested assets can be tokenized
- Maintains registry of all deployed tokens

**Key Concept**: This is the **manufacturing facility**. You don't deploy RWA tokens manually - the factory ensures every token is correctly configured with compliance, yield tracking, etc.

**Deployment Process**:
1. Verify asset is attested (check AttestationRegistry)
2. Deploy ComplianceModule for this asset
3. Deploy RWAToken linked to ComplianceModule
4. Register token in YieldVault
5. Store token suite info
6. Emit event with token address

**Why Important**: Ensures every RWA token has the same security guarantees and is properly integrated into the yield system.

---

### 7. YieldVault
**Purpose**: Manages yield deposits and distribution to token holders

**What it does**:
- Accepts USDC deposits from platform (invoice payments)
- Distributes yield to current AND past token holders
- Tracks per-user claimable amounts
- Allows users to claim accumulated yield

**Key Concept**: When an invoice is paid (e.g., $100k invoice gets paid by the buyer), that payment goes here and is distributed proportionally to everyone who held the tokens.

**Yield Flow**:
1. **Deposit**: Platform deposits USDC for a specific token
   - `depositYield(tokenAddress, amount)`
   - USDC transferred from platform → vault
   - Added to `pendingDistribution` for that asset

2. **Distribution**: Platform calculates and distributes to holders
   - `distributeYieldBatch(tokenAddress, holders[], amounts[])`
   - Takes list of addresses + their yield amounts
   - Updates each user's `totalClaimable`
   - Deducts from `pendingDistribution`

3. **Claim**: Users claim their accumulated yield
   - `claimAllYield()`
   - USDC transferred from vault → user
   - Resets user's `totalClaimable` to 0

**Critical Design Decision**: Distribution is done in batches by the platform off-chain. The platform:
- Tracks all historical holders and their holding durations
- Calculates proportional yield for each (time-weighted)
- Submits batch distribution transaction

**Why Batch**: Gas efficiency. Can't iterate all holders on-chain for large holder counts.

---

### 8. PrimaryMarketplace
**Purpose**: Primary market for initial token sales

**What it does**:
- Lists RWA tokens for sale at set prices
- Accepts USDC payment from investors
- Transfers tokens from platform custody to buyers
- Supports two listing types: STATIC (fixed price) and AUCTION (Dutch auction)

**Key Concept**: This is the **stock exchange IPO platform**. Platform lists tokens, investors buy with USDC.

**Listing Types**:

**STATIC Listing**:
- Fixed price per token
- Price never changes
- Simple "buy at $X" model
- Current implementation uses this

**AUCTION Listing (Dutch Auction)**:
- Starts at high price, decreases linearly over time
- Formula: `currentPrice = startPrice - ((startPrice - endPrice) * elapsed / duration)`
- Creates urgency (price drops every second)
- Good for price discovery

**Purchase Flow**:
1. Investor approves USDC to marketplace
2. Calls `buyTokens(assetId, amount)`
3. Marketplace checks:
   - Listing is active
   - Amount ≥ minimum investment
   - Sufficient supply remaining
4. Calculates payment: `payment = price * amount / 1e18`
5. Transfers USDC from investor → platform custody
6. Transfers RWA tokens from platform custody → investor
7. ComplianceModule checks pass (both parties KYC'd)
8. Tokens successfully transferred

---

## Contract Interactions

### Asset Registration Flow
```
Admin (Backend)
    ↓
AttestationRegistry.registerAsset()
    → Verifies signature from trusted attestor
    → Stores attestation hash + blob ID
    → Marks asset as valid
```

### Token Deployment Flow
```
Admin (Backend)
    ↓
TokenFactory.deployTokenSuite()
    ↓
    ├─→ Check: AttestationRegistry.isAssetValid()
    ├─→ Deploy: ComplianceModule (new instance)
    │       → Links to IdentityRegistry
    │       → Links to AttestationRegistry
    │       → Stores assetId
    ├─→ Deploy: RWAToken (new instance)
    │       → Mints total supply to platform custody
    │       → Links to ComplianceModule
    │       → Links to IdentityRegistry
    └─→ Register: YieldVault.registerAsset()
            → Links token to yield tracking
```

### Token Purchase Flow
```
Investor
    ↓
1. Approve USDC to PrimaryMarketplace
    ↓
2. Call PrimaryMarketplace.buyTokens(assetId, amount)
    ↓
3. Marketplace transfers USDC: investor → platform custody
    ↓
4. Marketplace calls RWAToken.transferFrom(custody → investor, amount)
    ↓
5. RWAToken._update() hook triggers
    ↓
6. ComplianceModule.canTransfer() checks:
    ├─→ IdentityRegistry.isVerified(custody) ✓
    ├─→ IdentityRegistry.isVerified(investor) ✓
    └─→ AttestationRegistry.isAssetValid(assetId) ✓
    ↓
7. Transfer succeeds, investor holds tokens
```

### Yield Distribution Flow
```
Invoice Payment Received (Off-chain)
    ↓
Platform (Backend)
    ↓
1. Calculate yield per holder (time-weighted)
    ↓
2. Call YieldVault.depositYield(tokenAddress, totalAmount)
    → USDC: platform → vault
    → Increases pendingDistribution
    ↓
3. Call YieldVault.distributeYieldBatch(tokenAddress, holders[], amounts[])
    → Updates each holder's claimable amount
    → Decreases pendingDistribution
    ↓
Investor
    ↓
4. Call YieldVault.claimAllYield()
    → USDC: vault → investor
    → Resets claimable to 0
```

---

## Asset Lifecycle Flow

### Complete Journey of an Invoice

#### Phase 1: Origination (Off-chain)
- Business generates invoice (e.g., $100k invoice to corporate buyer)
- Invoice uploaded to platform
- Platform validates invoice legitimacy
- Invoice data hashed and stored (potentially on EigenDA)

#### Phase 2: Attestation (On-chain)
- Platform backend computes:
  - Document hash (keccak256 of invoice PDF)
  - Merkle root (hash of metadata fields)
  - Attestation payload (combined proof)
- Trusted attestor signs payload
- Backend calls `AttestationRegistry.registerAsset()`
- Asset marked as "attested" and valid

#### Phase 3: Tokenization (On-chain)
- Backend calls `TokenFactory.deployTokenSuite()`
- ComplianceModule deployed
- RWAToken deployed (e.g., 100,000 tokens for $100k invoice)
- All tokens minted to platform custody
- Asset registered in YieldVault

#### Phase 4: Listing (On-chain)
- Backend calls `PrimaryMarketplace.createListing()`
- Sets price (e.g., $1 USDC per token)
- Sets minimum investment (e.g., 1000 tokens)
- Listing marked as active

#### Phase 5: Primary Sales (On-chain)
- Investors browse marketplace
- Investors must register in IdentityRegistry first (KYC)
- Platform custody must approve marketplace to spend tokens
- Investors approve USDC to marketplace
- Investors call `buyTokens(assetId, amount)`
- Tokens transfer: custody → investor
- Payment transfer: investor → custody

#### Phase 6: Trading (On-chain - Future)
- Investors can trade tokens peer-to-peer
- Both parties must be KYC verified
- ComplianceModule enforces on every transfer
- Secondary marketplace could be built

#### Phase 7: Yield Distribution (Hybrid)
- Invoice payment received (e.g., $100k paid by corporate buyer)
- Platform backend:
  - Queries all historical Transfer events
  - Calculates time-weighted ownership
  - Example: Alice held 10k tokens for 30 days, Bob held 5k tokens for 60 days
  - Proportional yield calculated
- Platform deposits USDC to YieldVault
- Platform calls distributeYieldBatch() with allocations
- Investors claim their share via `claimAllYield()`

#### Phase 8: Maturity (On-chain)
- Once all yield distributed, asset lifecycle complete
- Tokens could be burned (future feature)
- Asset could be marked as "settled"

---

## Yield Distribution Mechanism

### The Problem
Invoice RWAs have a unique yield characteristic:
- Invoice face value: $100k due in 60 days
- Tokens sold at discount: $95k (5% yield)
- But investors may buy/sell tokens before maturity
- Who gets the $5k yield when invoice is paid?

### Traditional Approaches (Inadequate)
1. **Current holders only**: Unfair to early investors who took risk
2. **Pro-rata at maturity**: Creates gaming (buy 1 day before payment)
3. **Fixed snapshots**: Arbitrary and easily manipulated

### This Platform's Solution: Time-Weighted Historical Distribution

**Core Principle**: Yield is distributed proportionally based on **how long you held the token**, not just whether you hold it now.

**Example**:
- Total tokens: 100,000
- Total yield: $5,000
- Holding period: 60 days until invoice payment

**Holder Journey**:
- **Alice**: Buys 50,000 tokens at day 0, sells at day 30
  - Holding: 50,000 tokens × 30 days = 1,500,000 token-days

- **Bob**: Buys 30,000 tokens at day 15, holds until payment (day 60)
  - Holding: 30,000 tokens × 45 days = 1,350,000 token-days

- **Carol**: Buys 50,000 tokens at day 30 (from Alice), holds until payment
  - Holding: 50,000 tokens × 30 days = 1,500,000 token-days

**Total token-days**: 1,500,000 + 1,350,000 + 1,500,000 = 4,350,000

**Yield Distribution**:
- Alice: (1,500,000 / 4,350,000) × $5,000 = **$1,724**
- Bob: (1,350,000 / 4,350,000) × $5,000 = **$1,552**
- Carol: (1,500,000 / 4,350,000) × $5,000 = **$1,724**

**Key Insight**: Alice gets yield even though she doesn't hold at maturity. This incentivizes early investment and removes gaming.

### Implementation Details

**Off-chain Calculation** (Platform Backend):
- Listens to all `Transfer` events for the token
- Builds holding history timeline
- Calculates token-days for each address
- Computes proportional yield allocation

**On-chain Distribution** (YieldVault):
- Platform deposits total yield as USDC
- Platform submits batch with `holders[]` and `amounts[]`
- Contract updates each user's `totalClaimable`
- Users claim at their convenience

**Why Not Fully On-chain?**:
- Gas costs: Iterating potentially thousands of holders is prohibitively expensive
- Historical tracking: Ethereum doesn't natively store holding duration
- Flexibility: Off-chain calculation allows complex formulas (e.g., early holder bonuses)

**Trust Assumption**:
- Platform COULD submit incorrect distributions
- Mitigation: All calculations verifiable from public Transfer events
- Governance could verify distributions before deposit
- Future: ZK proof of correct distribution calculation

### Yield Vault Mechanics

**State Variables**:
- `assets[tokenAddress]`: Tracks total deposited and distributed per asset
- `userYields[address]`: Tracks claimable amount per user
- `pendingDistribution`: USDC waiting to be allocated

**Deposit Flow**:
```
Platform deposits $5,000 USDC
    ↓
YieldVault.depositYield(tokenAddress, $5000)
    → totalDeposited += $5000
    → pendingDistribution += $5000
```

**Distribution Flow**:
```
Platform calculates allocations (off-chain)
    → Alice: $1,724
    → Bob: $1,552
    → Carol: $1,724
    ↓
YieldVault.distributeYieldBatch(token, [Alice, Bob, Carol], [$1724, $1552, $1724])
    → userYields[Alice].totalClaimable += $1724
    → userYields[Bob].totalClaimable += $1552
    → userYields[Carol].totalClaimable += $1724
    → pendingDistribution -= $5000
    → totalDistributed += $5000
```

**Claim Flow**:
```
Alice calls YieldVault.claimAllYield()
    → Check: userYields[Alice].totalClaimable = $1724
    → Transfer: USDC vault → Alice ($1724)
    → Update: userYields[Alice].totalClaimable = 0
    → Update: lastClaimTime = now
```

**Multi-Asset Support**:
- Each token has separate accounting
- User can have claimable yield from multiple assets
- `claimAllYield()` claims across ALL assets (future enhancement)

**Future Enhancements**:
- Automatic compounding (reinvest yield into more tokens)
- Governance voting weighted by claimable yield
- Yield streaming (continuous claiming over time)

---

## Dutch Auction Feasibility

### What is a Dutch Auction?

In a Dutch auction, price starts HIGH and decreases over time until all tokens are sold.

**Example**:
- Start Price: $1.10 per token
- End Price: $0.90 per token
- Duration: 7 days
- Supply: 100,000 tokens

**Price Decay**:
- Day 0: $1.10
- Day 1: $1.07
- Day 3: $1.01
- Day 5: $0.95
- Day 7: $0.90

**Investor Strategy**:
- Wait too long → risk selling out
- Buy too early → pay more than necessary
- Optimal: Buy when price = perceived value

### Current Implementation Status

**Already Built**: The PrimaryMarket contract supports Dutch auctions!

**Listing Type Enum**:
- `STATIC = 0`: Fixed price
- `AUCTION = 1`: Dutch auction

**Current Price Calculation**:
```
If STATIC:
    return staticPrice

If AUCTION:
    elapsed = now - startTime

    If auction ended:
        return endPrice

    priceDrop = (startPrice - endPrice) × elapsed / duration
    return startPrice - priceDrop
```

**This gives linear price decay** over the auction duration.

### Using Dutch Auction for RWA Tokens

**Scenario**: Tokenizing a $100k invoice due in 90 days

**Traditional Static Pricing Problem**:
- Platform must guess fair price
- If too high → tokens don't sell
- If too low → platform loses money
- No price discovery mechanism

**Dutch Auction Solution**:
- Start at premium (e.g., $1.05 per token = $105k valuation = -5% yield)
- End at discount (e.g., $0.95 per token = $95k valuation = +5% yield)
- Duration: 3-7 days
- Let market discover fair price

**Benefits**:
1. **Price Discovery**: Market determines fair value
2. **Urgency**: Falling price creates FOMO
3. **Efficiency**: Fast sell-through
4. **Fair**: Everyone gets market-clearing price
5. **Transparent**: No hidden allocations

**Example Timeline**:
- **Hour 0**: $1.05 per token (few buyers, waiting)
- **Hour 24**: $1.02 per token (some whale buys 20k tokens)
- **Hour 48**: $0.99 per token (retail buyers start entering)
- **Hour 60**: $0.97 per token (50k tokens sold, accelerating)
- **Hour 72**: $0.96 per token (SOLD OUT - all 100k tokens gone)

**Result**: Average sale price = $0.975 → $97,500 raised → 2.5% effective yield

### Implementation Requirements

**Already Have**:
- ✅ Contract supports AUCTION type
- ✅ Price calculation function works
- ✅ getCurrentPrice() returns time-based price
- ✅ buyTokens() accepts any listing type

**Need to Add**:
1. **Backend Support**:
   - API endpoint to create AUCTION listings
   - Frontend to display countdown + current price
   - Real-time price updates via WebSocket

2. **Frontend Features**:
   - Live price ticker (updates every second)
   - Countdown timer
   - Chart showing price decay curve
   - "Buy Now" vs "Wait" calculator

3. **Configuration**:
   - Default auction duration (e.g., 72 hours)
   - Min/max price bounds
   - Reserve price (minimum accepted price)

### Dutch Auction vs Static: When to Use Each

**Use STATIC when**:
- Well-established asset type with known market
- Small offering (< $50k)
- Need simplicity for users
- Price volatility is low
- Quick sale less important

**Use AUCTION when**:
- New asset type (price discovery needed)
- Large offering (> $100k)
- Want to maximize sell-through speed
- Willing to accept market price
- Want to create excitement/FOMO

**For Invoice RWAs**: Dutch auction makes sense because:
- Each invoice is unique (no precedent pricing)
- Time-sensitive (invoice has due date)
- Want fast distribution (reduce holding time)
- Market can determine risk premium

### Hybrid Strategy

**Tiered Release**:
1. **Phase 1 (Days 1-3)**: Dutch auction (80% of supply)
   - Fast price discovery
   - Market sets clearing price

2. **Phase 2 (Days 4-7)**: Static listing (20% of supply)
   - Fixed price = auction clearing price
   - Mop up remaining demand
   - Stability for latecomers

**Example**:
- 100k tokens total
- Auction: 80k tokens at $1.00-$0.90
- Clears at $0.95 after 48 hours
- Static: 20k tokens at $0.95 fixed
- Guarantees full sell-through

---

## Current Limitations & Considerations

### 1. Platform Custody Centralization

**Issue**: All tokens initially minted to single custody wallet

**Risk**:
- Single point of failure
- Custody wallet must approve marketplace
- Custody wallet must be KYC registered
- If custody wallet compromised, all tokens at risk

**Mitigation**:
- Use multi-sig wallet for custody
- Hardware wallet signing
- Time-locked approvals
- Insurance

### 2. Yield Distribution Trust

**Issue**: Platform calculates distributions off-chain

**Risk**:
- Platform could submit incorrect allocations
- Users must trust time-weighted calculation
- No on-chain verification of fairness

**Mitigation**:
- Publish calculation methodology
- Allow community verification via event logs
- ZK proof of correct distribution (future)
- Governance oversight

### 3. ComplianceModule Upgradability

**Issue**: Each token has immutable ComplianceModule

**Risk**:
- Can't update transfer rules after deployment
- Regulatory changes require new token deployment
- Bug in ComplianceModule affects that asset forever

**Mitigation**:
- Proxy pattern for ComplianceModule
- Owner can call `setCompliance()` on RWAToken
- Deploy new ComplianceModule, update pointer
- Governance approval required

### 4. Forced Transfer Power

**Issue**: Platform owner can force transfers

**Risk**:
- Centralized control over token holdings
- Could be abused
- Users don't have true self-custody

**Justification**:
- Regulatory requirement (court orders)
- Stolen token recovery
- Sanction compliance
- Estate transfers

**Mitigation**:
- Multi-sig for owner role
- Public log of forced transfers
- Governance approval
- Insurance fund for errors

### 5. Marketplace Approval Requirement

**Issue**: Custody must approve marketplace BEFORE listing

**Risk**:
- Admin must remember to approve
- Unlimited approval creates risk
- Users get confusing errors if forgotten

**Current State**: Causing purchase failures (ERC20InsufficientAllowance)

**Solution**:
- Auto-approve during listing creation
- Or: Marketplace uses permitFrom pattern
- Or: Custody delegates to marketplace contract

### 6. EigenDA Dependency

**Issue**: Asset data anchored to EigenDA (currently failing)

**Risk**:
- Blob storage not accessible
- Data availability not guaranteed
- Deployment blocked if EigenDA down

**Mitigation**:
- Make EigenDA optional
- Fallback to IPFS or Arweave
- Store critical data on-chain
- Cache blobs locally

### 7. Gas Costs

**Issue**: Batch yield distribution still expensive for large holder sets

**Risk**:
- 1000 holders = ~$50-100 in gas
- 10,000 holders = potentially prohibitive
- Limits scalability

**Solution**:
- Merkle tree distribution (users claim vs push)
- Layer 2 deployment (Mantle = already L2!)
- Batch claiming (users claim multiple epochs)

### 8. Secondary Market

**Issue**: No built-in secondary marketplace

**Risk**:
- Investors can't easily trade after primary sale
- Must do peer-to-peer transfers
- Price discovery post-primary unclear

**Future**:
- Build secondary AMM (Uniswap-style)
- Orderbook exchange
- OTC matching service
- All must enforce KYC via ComplianceModule

### 9. Token Granularity

**Issue**: Tokens have 18 decimals, invoices are whole dollars

**Risk**:
- Fractional ownership weird for invoices
- $100k invoice = 100,000 tokens = weird unit economics
- Could cause rounding issues in yield

**Consideration**:
- Use 6 decimals (match USDC)
- Or: 1 token = $1 face value
- Or: 1 token = $100 face value
- Current: 1 token = arbitrary (set at deployment)

### 10. Auction Sniping

**Issue**: In Dutch auction, bots could snipe optimal price

**Risk**:
- Unfair to retail investors
- Race conditions at price points
- MEV extraction opportunity

**Mitigation**:
- Batch auctions (all buys at same price)
- Commit-reveal scheme
- Random price jitter
- Anti-bot measures (KYC helps here)

---

## Summary

This platform is a **production-ready RWA tokenization system** with:

✅ **Strong Foundation**:
- Cryptographic asset attestation
- KYC/compliance enforcement
- Token factory for standardized deployments
- Yield distribution infrastructure

✅ **Unique Features**:
- Time-weighted historical yield (first-of-its-kind)
- Built-in Dutch auction support
- Per-asset compliance modules
- Forced transfer capability (regulatory)

⚠️ **Needs Attention**:
- EigenDA integration (currently failing)
- Custody wallet funding (needs MNT for gas)
- Marketplace approval automation
- Yield distribution verification
- Secondary market development

🚀 **Ready for Enhancement**:
- Dutch auction frontend
- Multi-asset yield claiming
- Governance token
- Secondary AMM
- ZK distribution proofs

The architecture is **sound and scalable**. The yield mechanism is **innovative and fair**. The Dutch auction capability is **already built, just needs UI**. Main task is polishing the deployment flow and making custody management smoother.
