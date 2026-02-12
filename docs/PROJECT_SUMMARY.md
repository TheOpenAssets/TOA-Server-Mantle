# Open Assets — Project Summary

## What is Open Assets?

Open Assets is a Real-World Asset (RWA) tokenization platform that takes real-world financial instruments — invoices, bonds, deeds, equipment — and brings them on-chain as tradeable ERC-20 tokens. It covers the entire lifecycle: originator onboarding, KYC verification, asset attestation with cryptographic proofs, token deployment, primary marketplace (fixed-price and auction), secondary peer-to-peer trading, yield distribution, and settlement.

The platform also provides advanced financial infrastructure on top of the tokenized assets: a leverage system for amplified RWA exposure using mETH collateral, a solvency vault for borrowing USDC against RWA collateral, partner API integrations for external lending platforms, and an on-chain credit identity system (OAID).

---

## Architecture

### Monorepo Structure

The project is a bun workspaces monorepo with three packages:

- **packages/backend** — NestJS REST API (TypeScript). The brain of the platform. Handles all business logic, API routing, database operations, and blockchain orchestration.
- **packages/contracts** — Solidity smart contracts (Hardhat). 17 contracts deployed on Mantle Sepolia covering the full on-chain layer.
- **packages/types** — Shared TypeScript type definitions used across packages.

### Tech Stack

- **Framework**: NestJS 10 (TypeScript, strict mode)
- **Database**: MongoDB with Mongoose ODM (auto-indexing enabled)
- **Cache & Queues**: Redis with BullMQ for async job processing
- **Blockchain**: viem library for EVM interactions against Mantle Sepolia
- **Auth**: JWT with wallet-based signature verification (EIP-191)
- **Validation**: class-validator + class-transformer for DTO validation
- **API Docs**: Swagger via @nestjs/swagger
- **File Storage**: GridFS for KYC documents, local disk for uploads
- **Logging**: Custom IST-timezone logger

### Domain Modules (17 total)

The backend is organized into isolated domain modules, each owning its schemas, DTOs, services, and controllers:

| Module | Purpose |
|--------|---------|
| **Auth** | Wallet-based authentication, JWT sessions, role assignment |
| **KYC** | Document upload, Aadhaar verification, Typeform webhook processing |
| **Assets** | Asset lifecycle from upload through settlement |
| **Blockchain** | Global on-chain interaction layer (contract reads/writes, event listening, wallet management) |
| **Admin** | Administrative operations — asset approval, token deployment, marketplace listing, yield distribution |
| **Marketplace** | Primary marketplace — static listings and auctions, bidding, purchase tracking |
| **Secondary Market** | Peer-to-peer order book — buy/sell orders, trade execution, OHLC chart data |
| **Yield** | Yield distribution from asset settlements to token holders, claim tracking |
| **Leverage** | mETH-collateralized leveraged positions — creation, health monitoring, harvest, liquidation |
| **Solvency** | RWA collateral vault — deposit, borrow, repay, OAID credit lines, private asset management |
| **Partners** | Third-party lending platform integrations — API key auth, partner loans via OAID |
| **Notifications** | Real-time SSE notification stream + persistent notification storage |
| **Announcements** | Platform-wide announcements for auctions, listings, results |
| **Compliance Engine** | Asset attestation and compliance verification |
| **Faucet** | Testnet token faucet (USDC and mETH) |
| **Changelog** | Git activity tracking and development metrics via GitHub API |
| **Typeform** | Webhook receiver for KYC form submissions |

Supporting infrastructure modules: Redis (global cache), Truth Engine (Merkle proofs, document hashing, EigenDA blob dispersal), Verification (audit and proof key services), Relayer Engine (cross-chain relaying).

---

## Smart Contracts (On-Chain Layer)

17 contracts deployed on Mantle Sepolia:

### Core Contracts
- **AttestationRegistry** — Records asset attestations with hashes, signatures, and data availability proofs. The on-chain source of truth that an asset has been verified.
- **IdentityRegistry** — Stores verified user identities. Called after KYC approval to register a wallet as verified on-chain.
- **TokenFactory** — Deploys ERC-20 token suites for approved assets. Each asset gets its own RWA token with an attached compliance module.
- **RWAToken** — The ERC-20 token representing fractional ownership of a real-world asset. Supports mint, burn, and transfer with compliance checks.
- **PrivateAssetToken** — ERC-20 token for non-standard collateral (deeds, bonds, equipment) used in the solvency system.

### Marketplace Contracts
- **PrimaryMarket** — Handles both static-price purchases and Dutch auctions. Manages listings, token purchases, bid submission, auction ending, and bid settlement.
- **SecondaryMarket** — Peer-to-peer order book. Users create buy/sell orders, others fill them. Supports partial fills and cancellations.

### Financial Infrastructure
- **YieldVault** — Holds USDC yield from asset settlements. Distributes yield proportionally to token holders. Supports batch distribution and individual claims via token burning.
- **LeverageVault** — Manages leveraged positions. Users deposit mETH collateral, borrow USDC, and purchase RWA tokens. Handles yield harvesting (mETH interest swap), settlement distribution (senior/junior split), and liquidation.
- **SeniorPool** — The lending pool that provides USDC for leverage borrowing. Tracks outstanding debt and accrued interest per position.
- **SolvencyVault** — Accepts RWA tokens or private assets as collateral. Users borrow USDC with structured repayment plans (installments, durations). Handles missed payments, defaults, and liquidation.
- **OAID (Open Asset Identifier)** — On-chain credit identity system. Registered after KYC, tracks credit lines per user. Partners use OAID to check available credit before issuing loans.

### Integrations & Testing
- **FluxionIntegration** + **MockFluxionDEX** — DEX integration for swapping mETH to USDC during leverage yield harvesting.
- **MockUSDC** — Test stablecoin (6 decimals).
- **MockMETH** + **METHFaucet** — Test mETH liquid staking token and faucet.
- **Faucet** — General testnet token faucet.

---

## Key Business Flows

### 1. Asset Tokenization (Originator Flow)

An originator uploads an invoice or financial instrument with metadata (face value, currency, due date, buyer info, risk tier). The system then walks the asset through a multi-step verification and deployment pipeline:

1. **Upload** — Asset created with UUID, files stored in GridFS
2. **Hashing** — Document SHA-256 hash computed by the truth engine
3. **Merkle Tree** — Merkle tree generated from asset data leaves, root and proof stored
4. **Attestation** — Cryptographic signature from authorized attestor
5. **Data Availability** — EigenDA blob dispersal for decentralized proof storage
6. **On-Chain Registration** — Asset registered in AttestationRegistry contract with hash, blob ID, and signature
7. **Token Deployment** — ERC-20 RWA token deployed via TokenFactory with configured supply and compliance module
8. **Marketplace Listing** — Listed on PrimaryMarket as either STATIC (fixed price) or AUCTION (bidding period with price range)

Admin approval is required between key steps. The asset schema tracks 15+ status states and stores every checkpoint.

### 2. Investment (Investor Flow)

Investors complete KYC (document upload + Typeform verification + on-chain identity registration), then:

- **Static Purchase** — Send USDC directly to the marketplace contract at the listed price. Receive RWA tokens proportional to investment.
- **Auction Bidding** — Submit bids with desired token amount and price during the bidding period. When the auction ends, admin sets a clearing price. Winning bids (at or above clearing) receive tokens; losing bids get refunded.
- **Yield Collection** — When the underlying asset settles (debtor pays the invoice), USDC flows into the YieldVault. Admin distributes yield proportionally to all token holders. Investors burn their RWA tokens to claim USDC.

### 3. Leveraged Investment

Investors who want amplified exposure can use the leverage system:

1. Deposit mETH as collateral into LeverageVault
2. Borrow USDC against the mETH (up to configured LTV ratio)
3. Use borrowed USDC to purchase RWA tokens on the primary marketplace
4. System monitors health factor: (mETH value in USD * 10000) / USDC borrowed
5. Periodically, the HarvestKeeper swaps accrued mETH staking interest to USDC via FluxionDEX, paying down interest
6. If health factor drops below threshold (price crash), position is liquidatable — admin can trigger liquidation, selling mETH to recover USDC
7. On asset settlement, the settlement USDC is split: senior pool repayment first, then interest, then user yield, then mETH collateral returned

Position states: ACTIVE → LIQUIDATED or SETTLED or CLOSED. Health statuses: HEALTHY (>150%), WARNING (120-150%), CRITICAL (110-120%), LIQUIDATABLE (<110%).

### 4. Solvency Borrowing

Users can borrow USDC against RWA tokens or private assets they hold:

1. Deposit RWA token or private asset as collateral into SolvencyVault
2. Receive a valuation in USD
3. Borrow USDC up to a percentage of the valuation
4. Set up a repayment schedule (duration, number of installments)
5. Make scheduled repayments (principal + interest)
6. If 3+ payments missed → position marked as defaulted → liquidation
7. Liquidation: collateral listed at discount on marketplace, proceeds cover debt, surplus returned to user

The solvency system integrates with OAID credit lines — each collateral deposit can generate a credit line that partner platforms can lend against.

### 5. Partner Lending

External platforms integrate via API keys to originate loans:

1. Admin creates a partner with tier, limits, and API key
2. Partner authenticates with Bearer token (API key)
3. Partner checks user's OAID credit lines for available credit
4. Partner calls borrow endpoint — platform executes on-chain borrow from SolvencyVault
5. Partner tracks loan with their own loan ID + our internal ID
6. Partner can repay via direct USDC transfer or platform-mediated repayment
7. All API calls are logged for audit

### 6. Secondary P2P Trading

Token holders can trade on the secondary market:

1. Create a sell order (list tokens at desired price) or buy order (offer to buy at desired price)
2. Other users fill orders (partial fills supported)
3. Trades recorded on-chain via SecondaryMarket contract
4. Backend tracks order book, trade history, and generates OHLC chart data
5. Market stats available: last price, 24h volume, bid-ask spread

---

## Event Processing Pipeline

The backend monitors on-chain state through a continuous polling loop:

1. **EventListenerService** polls the blockchain every 3 seconds, checking 8 contract addresses in parallel for new events
2. Raw events are decoded from EVM logs and pushed into a Redis-backed BullMQ queue (`event-processing`)
3. **EventProcessor** consumes the queue, processing 19 different event types:
   - Asset registered, token deployed, identity registered
   - Token purchased, bid submitted, auction ended, bid settled
   - Yield distributed
   - P2P order created, filled, cancelled
   - Token transfers (for holder tracking)
   - Solvency events (borrow, repay, missed payment, default, liquidation)
4. Each event updates the corresponding MongoDB documents and triggers notifications

This architecture ensures eventual consistency between on-chain state and the database, with idempotent processing via transaction hash deduplication.

---

## Authentication & Security

- **Wallet-Based Auth**: Users sign a nonce-challenge with their wallet (EIP-191). No passwords. The backend verifies the signature and issues a JWT.
- **Role-Based Access Control**: Three roles — INVESTOR, ORIGINATOR, ADMIN. Guards enforce role checks on protected endpoints.
- **Admin Whitelist**: Approved admin wallets stored in a config file. Defense-in-depth beyond role checking.
- **Partner API Keys**: SHA-256 hashed, with 8-character prefix for identification. Rate limits and borrow limits per partner tier.
- **Webhook Verification**: Typeform webhooks verified via HMAC signature.
- **Session Management**: JWT sessions tracked in MongoDB with refresh token support and explicit logout/revocation.

---

## Notification System

Real-time notifications delivered via Server-Sent Events (SSE) and persisted to MongoDB:

- **Asset Events**: Status changes, approvals, rejections, registrations
- **Marketplace Events**: Listings, purchases confirmed, bids placed/won/lost
- **Financial Events**: Yield distributions, leverage liquidations, solvency alerts
- **System Events**: Token deployments, auction results

Users connect to `/notifications/stream` for real-time delivery, and query `/notifications` for history with read/unread filtering.

---

## Data Models Summary

The platform uses 20+ MongoDB schemas:

**Identity**: User (wallet, role, KYC), UserSession
**Assets**: Asset (15+ statuses, full metadata, crypto proofs, token info, listing info, yield tracking)
**Trading**: Purchase, Bid, P2POrder, P2PTrade
**Finance**: LeveragePosition, SolvencyPosition, PrivateAsset, PrivateAssetRequest
**Partners**: Partner, PartnerLoan
**Yield**: Settlement, YieldClaim, DistributionHistory, TokenHolder, TokenTransferEvent
**Platform**: Notification, Announcement, AuditLog, GitActivity, GitMetrics

---

## API Design

- RESTful endpoints with consistent response format: `{ success, data, message, count }`
- Pagination via `page` and `limit` query parameters (default limit: 50)
- Filtering by status, wallet, asset, date range on list endpoints
- Swagger documentation via `@ApiProperty` decorators on DTOs
- Global validation pipe with whitelist and transform enabled
- CORS configured for production domains and local development

---

## Current Network: Mantle Sepolia

All blockchain interactions currently target Mantle Sepolia testnet:
- Chain ID: 5003
- RPC: https://rpc.sepolia.mantle.xyz
- Native Currency: MNT (18 decimals)
- Explorer: https://sepolia.mantlescan.xyz

The blockchain layer uses the `viem` library with a hardcoded chain definition across 5 service files. The cross-network modification plan introduces adapter patterns to support Stellar and future networks without code changes.
