# Blockchain Module Context

## Responsibilities
The Blockchain Module is the global infrastructure layer responsible for all on-chain interactions. It abstracts the complexities of different blockchain networks (Mantle/EVM, Stellar/Soroban) and provides a unified interface to the rest of the application.

## Core Components

### `NetworkRegistryService`
- **Purpose**: The central brain for network-agnostic orchestration.
- **Responsibilities**:
  - Exposes feature availability based on the active network.
  - Provides typed domain methods (e.g., `registerIdentityOnChain`, `deployAssetToken`) that delegate to the appropriate network adapters.
  - Mediates cross-module communication without creating circular dependencies (via `ModuleRef`).

### Blockchain Adapters (Planned)
- **Purpose**: Interface-driven implementations for specific networks.
- **Interfaces**: `BlockchainAdapter`, `WalletAdapter`, `EventAdapter`, `ContractAdapter`.

### Services
- **`BlockchainService`**: (Legacy/EVM) Handles EVM contract writes and reads.
- **`WalletService`**: (Legacy/EVM) Manages EVM account signing and nonces.
- **`EventListenerService`**: (Legacy/EVM) Polls Mantle blocks for events.
- **`ContractLoaderService`**: (Legacy/EVM) Loads Solidity ABIs and addresses.
- **`MethPriceService`**: (Mantle-only) Tracks mETH/USD prices.

### Processors
- **`EventProcessor`**: A BullMQ consumer that processes standardized on-chain events and synchronizes them with the MongoDB database.

## Public Interfaces
- `NetworkRegistryService` for feature checks and domain operations.
- `BLOCKCHAIN_ADAPTER` (Token) for low-level chain writes.
- `MongooseModule` (Exported) for database access in other modules.

## Invariants
- The module is `@Global()`.
- Every on-chain operation must be idempotent and synchronize its result with the database.
- Circular dependencies with other modules must be avoided by calling through the `NetworkRegistryService` or using `forwardRef`.

## Dependencies
- `ConfigModule` (for `network` and `blockchain` configs)
- `MongooseModule` (for persistence)
- `BullModule` (for async event processing)
