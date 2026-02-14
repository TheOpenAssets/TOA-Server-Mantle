# Marketplace Module Context

## Responsibilities
The Marketplace module manages the primary market operations for Real-World Assets (RWA). It handles listing assets, tracking investor purchases (fixed price), managing auctions (bidding and settlement), and providing portfolio views for investors.

## Core Services

### `PurchaseTrackerService`
- **Purchase Recording**: Validates and records investor token purchases from the primary market.
- **Portfolio Management**: Aggregates investor holdings across static purchases, auction wins, and secondary market activity.
- **Yield Claims**: Records yield distribution events (burn-to-claim).
- **Network Agnostic**: Delegates on-chain transaction verification to the `BlockchainAdapter`.

### `BidTrackerService`
- **Auction Management**: Tracks bids placed on assets listed via Dutch auction.
- **Settlement**: Validates and records auction settlement results (wins and refunds).
- **Network Agnostic**: Delegates on-chain bid and settlement verification to the `BlockchainAdapter`.

### `MarketplaceService`
- **Listings**: Provides endpoints for retrieving asset listings.
- **Admin Operations**: Handles the administrative side of creating listings (delegated to `BlockchainAdapter` via `AdminService` in Phase 1, but listing data retrieval lives here).

## Data Models
- **Purchase**: Records confirmed token acquisitions.
- **Bid**: Records auction bids.
- **Asset**: (Shared) Source of truth for listing status and sold counts.
- **Settlement**: (Shared) Records auction clearing info.

## Invariants
- **Idempotency**: All notify endpoints (`notifyPurchase`, `notifyBid`, `notifySettlement`) are idempotent based on the `txHash`.
- **Canonical Amounts**: All monetary values (token amounts, prices, USDC payments) are stored as strings representing the raw integer values (18 decimals for tokens, 6 decimals for USDC) regardless of the underlying network.
- **Verification**: No purchase or bid is recorded without on-chain verification via the adapter.
- **No Direct Chain Access**: Services must not import `viem` or `stellar-sdk` directly. All chain interaction goes through `BLOCKCHAIN_ADAPTER`.

## Dependencies
- **Blockchain Module**: Provides the `BLOCKCHAIN_ADAPTER` token for verification.
- **Notification Module**: Sends alerts to investors.
- **Database**: MongoDB for persistence.
