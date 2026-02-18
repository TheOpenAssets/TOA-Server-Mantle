# Primary Market Contract — Context

**Author:** Architecture Implementation
**Date:** February 18, 2026
**Language:** Rust (Soroban Smart Contract)
**Deployment Network:** Stellar Testnet

---

## Responsibilities

The Primary Market contract is the core marketplace for first-issuance sales of tokenized Real-World Assets (RWAs) on Stellar. It orchestrates two distinct sale models:

1. **Static Listings** — Fixed-price sales where investors purchase tokens at a predetermined price until supply is exhausted
2. **Auction Listings** — Dutch auctions with bid collection, USDC escrow, off-chain clearing price calculation, and on-chain atomic settlement

The contract acts as:
- **Token custodian** during auctions (receives minted RWA tokens for distribution)
- **USDC escrow agent** during auctions (holds investor deposits until settlement)
- **Settlement engine** for auction winners/losers (atomic token transfer, payment to treasury, refunds)
- **Event emitter** for backend synchronization (purchase tracking, bid tracking, settlement tracking)

---

## Public Interface

### Initialization

**`init(admin: Address, asset_registry: Address, platform_treasury: Address)`**
- One-time initialization on deployment
- Sets the admin (only address that can list assets and clear auctions)
- Registers the Asset Registry contract for asset validation
- Registers the Platform Treasury for USDC payment routing

### Asset Listing

**`list_asset(admin, asset_code, asset_issuer, listing_type, price_or_reserve, min_price, duration, total_supply, usdc_contract)`**
- Lists an asset for sale on primary market
- `listing_type`: `Static` or `Auction`
- For static: `price_or_reserve` is the fixed price per token
- For auctions: `price_or_reserve` is the reserve price, `min_price` is the minimum bid floor
- `usdc_contract` is required for auctions (SAC address for USDC escrow)
- Initializes bid counter for auction listings
- **Auth:** Admin only

### Static Purchase

**`buy_tokens(buyer: Address, asset_code: String, amount: i128)`**
- Direct purchase of tokens at fixed price
- Only works on Static listings
- Transfers tokens from contract to buyer
- Emits `TokensPurchased` event
- **Auth:** Any investor (buyer must authenticate)

### Auction Bidding

**`submit_bid(bidder: Address, asset_code: String, token_amount: i64, limit_price: i64)`**
- Places a bid for auction listing
- Validates: auction active, not cleared, before end time, price >= min_price
- Calculates USDC deposit: `(limit_price × token_amount) / 10^7`
- Transfers USDC from bidder to contract (escrowed until settlement)
- Stores bid record with bid index
- Emits `BidSubmitted` event with `(asset_code, bidder, token_amount, limit_price, bid_index)`
- **Auth:** Any investor (bidder must authenticate)

### Auction Clearing

**`clear_auction(admin: Address, asset_code: String, clearing_price: i64)`**
- Ends an auction and sets the clearing price
- **Prerequisite:** Admin must mint total_supply tokens to the contract BEFORE calling
- Validates: is auction, not already cleared, contract has sufficient token balance
- Sets `clearing_price` on listing, marks listing inactive
- Emits `AuctionCleared` event with `(asset_code, clearing_price)`
- After this call, `settle_bid` becomes available
- **Auth:** Admin only

### Auction Settlement

**`settle_bid(caller: Address, asset_code: String, bid_index: u64)`**
- Settles a single bid after auction clearing
- Winning bid (price >= clearing_price AND supply available):
  - Transfers tokens to bidder
  - Transfers USDC cost (at clearing price) to treasury
  - Refunds excess USDC to bidder
  - Updates listing's `sold_amount`
- Losing bid (price < clearing_price OR supply exhausted):
  - Refunds full USDC deposit to bidder
- Marks bid as `settled` to prevent double-settlement
- Emits `BidSettled` event with `(asset_code, bidder, tokens_received, cost, refund)`
- **Auth:** Anyone (typically admin batch-settles, but bidder can self-settle)

### Query Functions

**`get_listing(asset_code: String) -> Option<Listing>`**
- Returns listing details including clearing price if set
- Open read, no auth required

**`get_bid(asset_code: String, bid_index: u64) -> Option<Bid>`**
- Returns bid record for given asset and index
- Open read, no auth required

**`get_bid_count(asset_code: String) -> u64`**
- Returns total number of bids placed for an asset
- Open read, no auth required

### Admin Utilities

**`enable_asset(asset: Address)`**
- Initializes trustline for RWA token contract
- Forces balance entry creation by querying balance
- **Auth:** Admin only

**`enable_usdc(usdc_contract: Address)`**
- Initializes trustline for USDC contract
- Must be called before first auction bid if not already set up
- **Auth:** Admin only

**`deactivate_listing(admin: Address, asset_code: String)`**
- Deactivates a Static listing early
- **Cannot** be used on Auction listings (must use `clear_auction` instead)
- **Auth:** Admin only

---

## Data Structures

### Listing

```rust
pub struct Listing {
    pub asset_code: String,
    pub asset_issuer: Address,      // SAC address of RWA token
    pub listing_type: ListingType,  // Static | Auction
    pub price_or_reserve: i64,      // Fixed price or auction reserve
    pub min_price: Option<i64>,     // Minimum bid price for auctions
    pub duration: u64,              // Listing duration in seconds
    pub start_time: u64,            // Ledger timestamp of listing
    pub total_supply: i64,          // Total tokens available
    pub sold_amount: i64,           // Tokens sold/allocated so far
    pub active: bool,               // Whether listing accepts purchases/bids
    pub usdc_contract: Option<Address>, // USDC SAC for auction escrow
    pub clearing_price: Option<i64>, // Set when auction clears; unlocks settlement
}
```

### Bid

```rust
pub struct Bid {
    pub bidder: Address,
    pub token_amount: i64,      // Tokens requested
    pub limit_price: i64,       // Max price bidder will pay (per token)
    pub usdc_deposited: i64,    // Actual USDC held in escrow
    pub settled: bool,          // Prevents double-settlement
}
```

---

## Storage Layout

All data uses Soroban's persistent storage (survives contract upgrades):

- **Instance Storage:**
  - `Admin`: Address with privileged operations
  - `AssetRegistry`: Address of asset validation contract
  - `PlatformTreasury`: Address receiving USDC payments

- **Persistent Storage:**
  - `Listing(asset_code)`: Listing struct for each asset
  - `BidCounter(asset_code)`: u64 counter for bid indices
  - `Bid(asset_code, bid_index)`: Individual bid records

---

## Decimal Precision Model

**Critical:** All amounts on Stellar use **7-decimal precision** (stroops).

### Price Calculations

For bid deposits:
```
usdc_deposit = (limit_price × token_amount) / 10^7
```

For settlement costs:
```
cost = (clearing_price × token_amount) / 10^7
refund = usdc_deposited - cost
```

Both `limit_price` and `clearing_price` are expressed in USDC per token with 7-decimal precision. Dividing by `10^7` gives USDC amounts also in 7-decimal precision.

### Backend Adapter Conversion

The backend's `StellarBlockchainAdapter` receives these 7-decimal values from events and converts them to the platform's canonical 4-decimal format using `toCanonical(value, 7)`.

---

## Invariants

1. **Auction clearing price immutability**: Once set via `clear_auction`, the clearing price cannot be changed
2. **Bid settlement idempotency**: Each bid can only be settled once (enforced by `settled` flag)
3. **Supply exhaustion**: Settlement checks remaining supply; late winning bids get refunds if supply runs out
4. **USDC custody**: All escrowed USDC remains in contract until settlement (win/loss path)
5. **Token balance verification**: `clear_auction` panics if contract lacks sufficient tokens for total_supply
6. **Static vs Auction separation**: Static listings use `deactivate_listing`, auctions use `clear_auction`

---

## Events

### TokensPurchased
Emitted on: `buy_tokens` (static purchases)
Data: `(asset_code, buyer, amount, price, total_payment)`

### BidSubmitted
Emitted on: `submit_bid`
Data: `(asset_code, bidder, token_amount, limit_price, bid_index)`
**Backend:** Tracked by `BidTrackerService.notifyBid()`

### AuctionCleared
Emitted on: `clear_auction`
Data: `(asset_code, clearing_price)`
**Backend:** Optional listener; primary trigger is admin endpoint

### BidSettled
Emitted on: `settle_bid`
Data: `(asset_code, bidder, tokens_received, cost, refund)`
**Backend:** Tracked by `BidTrackerService.notifySettlement()` to create Purchase records for winners or mark refunds

---

## Dependencies

### External Contracts

**Asset Registry** (`asset_registry::Client`)
- Validates asset codes via `is_asset_valid()` before listing
- Imported as compiled WASM at build time

### Stellar Token Interface

**SAC (Stellar Asset Contract)** (`token::Client`)
- Used for both RWA tokens and USDC
- Methods used: `transfer()`, `balance()`
- All token operations use Soroban's standard token interface

---

## Security Considerations

### Authorization Model

- **Admin-only operations:** `list_asset`, `clear_auction`, `deactivate_listing`, `enable_asset`, `enable_usdc`
- **Investor operations:** `buy_tokens`, `submit_bid` (self-authenticated)
- **Public operations:** `settle_bid` (any caller, but idempotent), all query functions

### Reentrancy Protection

- Settlement marks bid as `settled` BEFORE executing transfers
- Soroban's execution model makes reentrancy attacks difficult, but defense-in-depth applied

### Supply Tracking

- `sold_amount` is incremented atomically during settlement
- Multiple settlements cannot over-allocate beyond `total_supply`
- Late winners receive full refunds if supply exhausted

### USDC Custody

- Contract holds USDC from bid submission until settlement
- Admin cannot withdraw escrowed USDC (only settlement paths release it)
- Treasury receives auction revenue; bidders receive refunds

---

## Testing Requirements

Before mainnet deployment, verify:

1. **Decimal precision:** Bid deposits and settlement costs calculated correctly with 7-decimal math
2. **Event decoding:** Backend adapter properly decodes all event structures
3. **Supply exhaustion:** Oversubscribed auctions handle late settling correctly
4. **Trustline setup:** USDC and RWA token trustlines initialized via `enable_*` functions
5. **Token minting timing:** Admin must mint to contract BEFORE `clear_auction` or it panics
6. **Idempotency:** Double-settlement attempts properly rejected
7. **Refund paths:** Both losing bids and supply-exhausted winners receive correct refunds

---

## Integration Points

### Backend Services

**Asset Lifecycle Service**
- Calls this contract via `StellarBlockchainAdapter.listOnMarketplace()`

**Bid Tracker Service**
- Listens for `BidSubmitted` and `BidSettled` events
- Creates `Bid` and `Purchase` documents in MongoDB

**Auction Service**
- Computes clearing price off-chain
- Calls `clear_auction` via `StellarAdminStrategy.endAuctionOnChain()`

### Stellar Infrastructure

**Horizon API**
- Provides transaction submission and confirmation
- Event polling for backend synchronization

**Soroban RPC**
- Contract interaction layer
- Transaction simulation and resource footprint calculation

---

## Change Log

**February 18, 2026** — Auction implementation complete
- Added `Bid` struct and storage
- Added `submit_bid`, `clear_auction`, `settle_bid` functions
- Extended `Listing` with `usdc_contract` and `clearing_price`
- Added `platform_treasury` to initialization
- Restricted `deactivate_listing` to static-only
- Added `enable_usdc` for USDC trustline setup
- All events aligned with backend adapter expectations

**Previous** — Initial static marketplace implementation
- Basic `list_asset`, `buy_tokens`, `deactivate_listing`
- Asset registry validation integration
