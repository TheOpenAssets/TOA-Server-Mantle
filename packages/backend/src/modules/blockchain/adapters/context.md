# Blockchain Adapters Context

## Responsibilities
This folder defines the abstraction layer that allows the Open Assets platform to be network-agnostic. It contains interfaces that define the contract for all blockchain interactions and their network-specific implementations.

## Directory Structure
- `/evm`: Implementations for Mantle/EVM using `viem`.
- `/stellar`: Implementations for Stellar/Soroban using `@stellar/stellar-sdk`.

## Core Interfaces

### `BlockchainAdapter`
- **Purpose**: Unified interface for on-chain write/read operations (register asset, deploy token, list on marketplace).
- **Invariants**: All inputs and outputs must be network-agnostic strings.

### `WalletAdapter`
- **Purpose**: Abstracts account management and address retrieval for Admin and Platform wallets.

### `EventAdapter`
- **Purpose**: Standardizes the lifecycle of on-chain event listeners.

### `ContractAdapter`
- **Purpose**: Provides a unified way to retrieve contract addresses and interfaces (ABIs/Specs).

### `AuthVerificationAdapter`
- **Purpose**: Handles network-specific signature verification (EIP-191 for EVM, Ed25519 for Stellar).

## Invariants
- Adapters must never expose network-specific types (like `Hash` or `Address` from `viem`) to their consumers.
- All implementations must adhere strictly to these interfaces to ensure plug-and-play compatibility.
