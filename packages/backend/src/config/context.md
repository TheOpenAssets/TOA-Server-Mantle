# Config Context

## Responsibilities
This folder contains all the configuration logic for the application, using NestJS `@nestjs/config` patterns. It is responsible for reading environment variables, providing default values, and exposing structured, typed config objects to the rest of the application.

## Key Files

### `blockchain.config.ts`
- **Purpose**: Defines the connection parameters for the Mantle (EVM) network.
- **Key Fields**: RPC URLs, Chain ID, Admin/Platform private keys, and EVM contract addresses.

### `network.config.ts`
- **Purpose**: The master configuration for network-agnostic operations.
- **Responsibilities**:
  - Reads `NETWORK_TYPE` (mantle | stellar).
  - Defines the `features` availability map, which determines which modules and services are active for the current deployment.
  - Holds Stellar-specific connection parameters (Soroban RPC, Horizon, Contract IDs) when active.
- **Invariants**: `NETWORK_TYPE` defaults to `mantle` to ensure backward compatibility.

### `database.config.ts`
- **Purpose**: MongoDB connection strings and options.

### `redis.config.ts`
- **Purpose**: Redis connection parameters for caching and BullMQ queues.

## Public Interfaces
Each file exports a NestJS `registerAs` factory function.

## Invariants
- Configuration is read once at startup and remains immutable throughout the application's lifetime.
- No business logic should exist in this folder; only environment variable mapping and basic validation.
