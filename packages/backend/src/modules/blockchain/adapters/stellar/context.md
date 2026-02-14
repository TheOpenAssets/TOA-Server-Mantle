# Stellar Adapters Context

## Responsibilities
This folder contains the concrete implementations of the blockchain adapter interfaces for the Stellar network. It uses the `@stellar/stellar-sdk` to interact with both the Stellar classic network (for native assets) and Soroban smart contracts.

## Core Implementations

### `StellarBlockchainAdapter`
- Implements `BlockchainAdapter`.
- **Transaction Confirmation**: Includes a robust `confirmTransaction` polling mechanism (30s timeout, 2s intervals) to ensure transactions are successfully applied before returning.
- **Asset Management**: Handles `registerAsset` (AttestationRegistry) and `registerAssetInRegistry` (AssetRegistry).
- **Token Management**: Implements native asset flag setting and deterministic token identifier generation.
- **Revocation**: Supports multi-level revocation across AttestationRegistry, AssetRegistry, and PrimaryMarket.
- **Identity**: Manages KYC registration on the Soroban IdentityRegistry.
- **Transaction Verification**: Implements `verifyPurchaseTransaction`, `verifyBidTransaction`, and `verifyBidSettlement` by fetching transactions via Soroban RPC and decoding contract events. Validates 18-decimal/6-decimal canonical forms.

### `StellarWalletAdapter`
- Implements `WalletAdapter`.
- Manages `Keypair` instances for Admin and Platform accounts.

### `StellarEventAdapter` (Planned)
- Will implement `EventAdapter`.
- Use Soroban `getEvents` with cursor tracking.

### `StellarContractAdapter`
- Implements `ContractAdapter`.
- Loads Soroban contract IDs from `network.config.ts`.

### `StellarAuthVerificationAdapter`
- Implements `AuthVerificationAdapter`.
- Verifies Ed25519 signatures using the signer's public key.

## Invariants
- Asset identifiers are formatted as `assetCode:issuerPublicKey`.
- Transaction hashes are base64 strings (standard Stellar format).
- All amounts are normalized to stroops (7 decimal places) when interacting with the network.
