# Mantle RWA Platform - Complete Technical Reference

**Date:** December 23, 2025
**Version:** 1.0.0 (Phase 1-4 Complete)
**Status:** Ready for Deployment / Frontend Integration

---

## 1. System Architecture Overview

The Mantle RWA Platform is a hybrid decentralized application designed to bridge real-world assets (invoices, real estate, etc.) to the Mantle blockchain. It uses a **Modular Architecture** separating concerns into three distinct layers:

1.  **On-Chain Layer (Solidity):** Trustless settlement, identity enforcement, and asset custody.
2.  **Orchestration Layer (NestJS):** Business logic, cryptography, event indexing, and complex workflows.
3.  **Data Layer (MongoDB + Redis + EigenDA):** Hybrid storage for speed (DB) and verifiable permanence (DA).

---

## 2. Smart Contract Layer (`packages/contracts`)

Built on **Solidity 0.8.20**, utilizing the **ERC-3643 (T-Rex)** standard for compliance.

### 2.1 Core Registries
*   **`AttestationRegistry.sol`**
    *   **Role:** The "Source of Truth" for asset validity.
    *   **Mechanism:** Stores a hash of the off-chain data (anchored on EigenDA) + a signature from a trusted attestor.
    *   **Key Function:** `registerAsset()` - Atomic link between `assetId`, `blobId`, and `attestationHash`.
*   **`IdentityRegistry.sol`**
    *   **Role:** Whitelist for investor wallets.
    *   **Mechanism:** Maps `walletAddress => KYC Status`. Checked before *every* token transfer.
    *   **Key Function:** `registerIdentity()` - Adds a user to the whitelist.
*   **`TrustedIssuersRegistry.sol`**
    *   **Role:** Governance contract defining who is allowed to modify the Identity Registry.

### 2.2 Tokenization Engine
*   **`RWAToken.sol`**
    *   **Standard:** ERC-20 with hooks.
    *   **Logic:** Overrides `_beforeTokenTransfer` to call the Compliance Module.
*   **`ComplianceModule.sol`**
    *   **Role:** The "Gatekeeper".
    *   **Logic:** Checks: `Sender is KYC'd?` AND `Receiver is KYC'd?` AND `Asset is Valid?`. If any fail, the transaction reverts.
*   **`TokenFactory.sol`**
    *   **Role:** Factory pattern for scalability.
    *   **Workflow:** Deploys a new `RWAToken` + `ComplianceModule` pair for every new asset, ensuring isolation.

### 2.3 Financial Layer
*   **`YieldVault.sol`**
    *   **Role:** Global liquidity pool for USDC distributions.
    *   **Features:**
        *   **Batch Distribution:** `distributeYieldBatch()` allows sending USDC to 100+ holders in one transaction.
        *   **Claiming:** Users can manually `claimAllYield()` if push distribution fails.
*   **`PrimaryMarketplace.sol`**
    *   **Role:** Initial offering venue.
    *   **Mechanisms:** Fixed Price or Dutch Auction.
    *   **Safety:** Atomic Swap (USDC <-> RWA Token) ensuring no party can renege.

---

## 3. Backend Orchestration Layer (`packages/backend`)

Built on **NestJS**, utilizing a micro-services architecture within a monorepo.

### 3.1 Authentication Module (`/modules/auth`)
*   **Strategy:** Web3 Signature Authentication (EIP-191).
*   **Workflow:**
    1.  User signs a nonce message.
    2.  Backend verifies signature via `viem`.
    3.  Issues JWT (Access + Refresh tokens).
*   **Security:** Role-Based Access Control (RBAC) via Guards (`AdminRoleGuard`, `OriginatorGuard`).

### 3.2 KYC Module (`/modules/kyc`)
*   **Pipeline:**
    1.  **Upload:** Multer handles secure file upload.
    2.  **Processing:** Job queued to `verification` queue (BullMQ).
    3.  **OCR:** Tesseract.js extracts text from ID cards.
    4.  **QR Decoding:** jsQR extracts secure data from Aadhaar cards.
    5.  **Matching:** Fuzzy matching (Levenshtein distance) compares OCR text vs User Input.

### 3.3 Blockchain Module (`/modules/blockchain`)
The central nervous system for on-chain interactions.

*   **Service:** `BlockchainService`
    *   **Write Operations:** Uses `WalletService` to sign transactions via `viem` wallet clients.
    *   **Read Operations:** Uses `PublicClient` for querying state.
*   **Event Listener:** `EventListenerService`
    *   **Technology:** WebSocket (WSS) connection to Mantle RPC.
    *   **Logic:** Watches for events like `AssetRegistered`, `Transfer`, `TokenSuiteDeployed`.
    *   **Dynamic Monitoring:** Automatically starts watching new Token contracts as they are deployed by the Factory.
*   **Event Processor:** `EventProcessor` (BullMQ Worker)
    *   **Role:** Updates MongoDB state based on blockchain events (Event-Driven Architecture).
    *   **Reliability:** Retries failed jobs automatically.

### 3.4 Asset Lifecycle Module (`/modules/assets`)
Handles the journey of an asset from "PDF" to "Token".

*   **Workflow:**
    1.  **Upload:** File uploaded by Originator.
    2.  **Hashing:** SHA-256/Keccak256 hash computed.
    3.  **Merkle Tree:** Metadata + Document Hash combined into a Merkle Tree.
    4.  **EigenDA:** `EigenDAService` disperses the data blob to EigenDA for permanent availability.
    5.  **Attestation:** Admin approves and signs the `attestationHash`.
    6.  **Registration:** `BlockchainService` registers the asset on-chain.

### 3.5 Yield Module (`/modules/yield`)
Automates the flow of money.

*   **Holder Tracking:** `TokenHolderTrackingService`
    *   **Mechanism:** Indexes every `Transfer` event to maintain a real-time ledger of who owns what.
*   **Distribution Service:** `YieldDistributionService`
    *   **Workflow:**
        1.  Admin records "Off-Chain Settlement" (e.g., Invoice Paid).
        2.  System calculates Yield per token.
        3.  System converts to USDC amount.
        4.  System calls `YieldVault.distributeYieldBatch()`.

### 3.6 Admin Module (`/modules/admin`)
*   **Controllers:** Exposes REST APIs for platform administrators to:
    *   Approve/Reject Assets.
    *   Trigger Blockchain Registrations.
    *   Deploy Tokens.
    *   Execute Yield Distributions.

---

## 4. Data Layer

### 4.1 MongoDB Schemas
*   **`User`**: Wallet address, Role, KYC Status, KYC Documents.
*   **`Asset`**: Metadata, Status (UPLOADED -> TOKENIZED), Cryptographic Proofs, Contract Addresses.
*   **`TokenHolder`**: Mapping of `TokenAddress + UserAddress => Balance`.
*   **`Settlement`**: Record of financial events (Gross Yield, Fees, Net Yield).
*   **`DistributionHistory`**: Audit trail of every USDC payment made.

### 4.2 Redis
*   **Role:** Backing store for BullMQ (Task Queues).
*   **Usage:** Manages job state (Waiting, Active, Failed) for KYC and Event Processing.

### 4.3 EigenDA
*   **Role:** Data Availability Layer.
*   **Usage:** Stores the heavy asset metadata and documents off-chain, providing a `BlobID` that is anchored on-chain for verification.

---

## 5. Deployment & Configuration

### 5.1 Environment Configuration
*   **Config Service:** NestJS `ConfigModule` loads environment variables for:
    *   RPC URLs (HTTP/WSS).
    *   Private Keys (Admin/Platform).
    *   Contract Addresses (Loaded dynamically from `deployed_contracts.json`).

### 5.2 Deployment Script (`deploy_all.ts`)
*   **Automation:** Deploys contracts in dependency order:
    1.  AttestationRegistry
    2.  TrustedIssuersRegistry
    3.  IdentityRegistry
    4.  YieldVault
    5.  TokenFactory
    6.  PrimaryMarketplace
*   **Output:** Generates `deployed_contracts.json` which the Backend immediately consumes.

---

## 6. Integration Points Summary

| Backend Service | Smart Contract | Purpose |
| :--- | :--- | :--- |
| `AssetLifecycleService` | `AttestationRegistry` | Register valid asset with EigenDA BlobID |
| `BlockchainService` | `TokenFactory` | Deploy new Token + Compliance suite |
| `BlockchainService` | `IdentityRegistry` | Whitelist investor wallet after KYC |
| `YieldDistributionService` | `YieldVault` | Deposit USDC and Batch Distribute to holders |
| `EventProcessor` | `RWAToken` (All) | Listen for Transfers to update Holder DB |

---
