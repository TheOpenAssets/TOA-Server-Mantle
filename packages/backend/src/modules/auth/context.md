# Auth Module Context

## Purpose
The Auth Module provides network-agnostic authentication for the platform using wallet-based digital signatures. It supports both Mantle (EVM) and Stellar networks.

## Architecture
The module follows an adapter pattern for signature verification to accommodate different cryptographic standards:

- **AuthService**: Orchestrates the authentication flow, including nonce-based challenge generation, login verification, session management (Redis/MongoDB), and JWT issuance.
- **SignatureService**: Routes signature verification requests to the appropriate network-specific adapter based on the wallet address format.
- **Adapters**:
  - `EvmVerificationAdapter`: Uses `viem` to verify EIP-191 signatures from EVM wallets.
  - `StellarVerificationAdapter`: Uses `@stellar/stellar-sdk` to verify Ed25519 signatures from Stellar wallets.
- **Utils**:
  - `wallet.util.ts`: Provides helper functions for detecting network type (EVM vs Stellar) and normalizing wallet addresses (lowercase for EVM, uppercase for Stellar).

## Flow
1. **Challenge**: User provides wallet address. Backend generates UUID nonce, stores it in Redis, and returns a signed-ready challenge message.
2. **Login**: User signs the message with their wallet and submits it. Backend:
   - Normalizes address.
   - Verifies nonce against Redis.
   - Detects network type.
   - Dispatches to the correct verification adapter.
   - Finds or creates user in MongoDB.
   - Issues JWT containing the `network` field.

## Key Constraints
- EVM addresses (42 chars, `0x` prefix) are normalized to lowercase.
- Stellar public keys (56 chars, `G` prefix) are normalized to uppercase.
- Nonces expire after 60 seconds and can be used only once.
- JWTs identify the network to assist downstream services in choosing the correct blockchain adapter.
