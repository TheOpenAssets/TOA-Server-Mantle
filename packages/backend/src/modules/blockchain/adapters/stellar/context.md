# Stellar Adapters Context

## Responsibilities
This folder contains the concrete implementations of the blockchain adapter interfaces for the Stellar network. It uses the `@stellar/stellar-sdk` to interact with both the Stellar classic network (for native assets) and Soroban smart contracts.

## Core Implementations

### `StellarBlockchainAdapter`
- Implements `BlockchainAdapter`.
- Manages native asset flags (`AUTH_REQUIRED`, etc.) via classic operations.
- Invokes Soroban smart contracts for registry operations.
- Uses `rpc.Server` for transaction submission and simulation.

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
