# EVM Adapters Context

## Responsibilities
This folder contains the concrete implementations of the blockchain adapter interfaces for Mantle/EVM networks. It leverages the `viem` library to interact with Solidity smart contracts.

## Core Implementations

### `EvmBlockchainAdapter`
- Implements `BlockchainAdapter`.
- Handles contract writes (registration, deployment, listing, endAuction, token burning) and reads using `viem`'s `PublicClient` and `WalletClient`.
- Dynamically constructs the chain definition from `network.config.ts`.
- **Transaction Verification**: Implements `verifyPurchaseTransaction`, `verifyBidTransaction`, and `verifyBidSettlement` by decoding EVM logs from transaction receipts.
- **Auction Flow**: `endAuction` performs a database lookup to map the token address to an `assetId` before calling the `PrimaryMarketplace` contract.
- **Token Burning** (NEW): `burnUnsoldTokens` queries custody wallet balance and burns using RWAToken's `burn()` or `burnFrom()` method with 3-retry mechanism.

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

### `EvmPaymentAdapter` (NEW)
- Implements `PaymentAdapter`.
- **Purpose**: Handles USDC transfers on Mantle/EVM for originator payouts.
- **Technology**: Uses `ethers.js` for ERC-20 token interactions.
- **Configuration**: Reads USDC contract address from `deployed_contracts.json` (required).
- **Operations**:
  - `transferStablecoin()`: Executes USDC.transfer() from platform wallet to recipient
  - `getPlatformStablecoinBalance()`: Queries USDC.balanceOf() for platform wallet
  - Validates sufficient balance before transfer
  - Returns network-agnostic transaction results (txId, blockNumber, formatted amounts)

## Invariants
- All hex strings are treated as `0x` prefixed strings internally but exposed as plain strings to consumers.
- Transaction receipts are awaited where consistency is required (e.g., identity registration, token deployment).
