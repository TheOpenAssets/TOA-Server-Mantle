# EVM Adapters Context

## Responsibilities
This folder contains the concrete implementations of the blockchain adapter interfaces for Mantle/EVM networks. It leverages the `viem` library to interact with Solidity smart contracts.

## Core Implementations

### `EvmBlockchainAdapter`
- Implements `BlockchainAdapter`.
- Handles contract writes (registration, deployment, listing, endAuction) and reads using `viem`'s `PublicClient` and `WalletClient`.
- Dynamically constructs the chain definition from `network.config.ts`.
- **Transaction Verification**: Implements `verifyPurchaseTransaction`, `verifyBidTransaction`, and `verifyBidSettlement` by decoding EVM logs from transaction receipts.
- **Auction Flow**: `endAuction` performs a database lookup to map the token address to an `assetId` before calling the `PrimaryMarketplace` contract.

### `EvmWalletAdapter`
- Implements `WalletAdapter`.
- Manages Admin and Platform accounts using private keys.
- Provides `WalletClient` instances for transaction signing.

### `EvmEventAdapter`
- Implements `EventAdapter`.
- Uses block polling (matching current platform behavior) to detect on-chain events.

### `EvmContractAdapter`
- Implements `ContractAdapter`.
- Loads Solidity ABIs from artifacts and addresses from `deployed_contracts.json` or environment variables.

### `EvmAuthVerificationAdapter`
- Implements `AuthVerificationAdapter`.
- Verifies EIP-191 signatures using `recoverAddress`.

## Invariants
- All hex strings are treated as `0x` prefixed strings internally but exposed as plain strings to consumers.
- Transaction receipts are awaited where consistency is required (e.g., identity registration, token deployment).
