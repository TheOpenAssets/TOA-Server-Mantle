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
- **Auction Flow**: `endAuction` calls `deactivateListing` on the Soroban PrimaryMarket contract. The clearing price is ignored on-chain (handled in the database settlement layer).
- **Transaction Verification**: Implements `verifyPurchaseTransaction`, `verifyBidTransaction`, and `verifyBidSettlement` by fetching transactions via Soroban RPC and decoding contract events.
- **Price Normalization**: Applies a `STELLAR_PRICE_MULTIPLIER` (10^10) when reading prices from Soroban events to restore the canonical 6-decimal USDC form (compensating for the scaling applied during listing).
- **Token Burning** (NEW): `burnUnsoldTokens` queries custody balance via Soroban contract calls and invokes the `burn()` method on the token contract. Includes helper methods `queryTokenBalance()` and `queryTokenTotalSupply()` for read-only contract queries.

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

### `StellarPaymentAdapter` (NEW)
- Implements `PaymentAdapter`.
- **Purpose**: Handles USDC transfers on Stellar for originator payouts.
- **Technology**: Uses Soroban smart contract invocations via `@stellar/stellar-sdk`.
- **Configuration**: 
  - Reads USDC contract ID from config or derives from Circle's classic USDC asset
  - Circle USDC issuer on testnet: `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`
- **Operations**:
  - `transferStablecoin()`: Invokes Soroban token contract's `transfer()` method with transaction simulation and auth assembly
  - `getPlatformStablecoinBalance()`: Queries `balance()` method via transaction simulation (read-only)
  - Returns network-agnostic transaction results (txId, ledger sequence as blockNumber, formatted amounts)
- **Transaction Flow**: Simulates, assembles with auth, signs, submits, and polls for confirmation (with 30s timeout)

## Invariants
- Asset identifiers are formatted as `assetCode:issuerPublicKey`.
- Transaction hashes are base64 strings (standard Stellar format).
- All amounts are normalized to stroops (7 decimal places) when interacting with the network.
