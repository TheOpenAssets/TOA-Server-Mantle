# Stellar Contracts

Soroban smart contracts for the Open Assets platform on Stellar network.

## Overview

This package contains the Stellar/Soroban implementations of the core Open Assets protocol contracts:

- **TrustedIssuersRegistry** - Manages authorized attestation providers
- **AttestationRegistry** - Records asset attestations with cryptographic proofs
- **IdentityRegistry** - Stores verified user identities (KYC)
- **AssetRegistry** - Manages tokenized real-world assets
- **PrimaryMarket** - Primary marketplace for asset purchases and auctions

## Prerequisites

### 1. Install Rust and Cargo

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
```

### 2. Install Stellar CLI

```bash
cargo install --locked stellar-cli --features opt
```

### 3. Add WASM Target

```bash
rustup target add wasm32-unknown-unknown
```

### 4. Configure Stellar Account

Create a Stellar test account:

```bash
# Generate a new keypair
stellar keys generate --network testnet default

# Fund the account with testnet tokens
stellar keys fund default --network testnet
```

Configure identity:

```bash
stellar keys generate default
```

Or use an existing secret key:

```bash
stellar keys add default --secret-key S...
```

### 5. Configure Network

```bash
# Add testnet network (usually pre-configured)
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"

# Or use futurenet
stellar network add futurenet \
  --rpc-url https://rpc-futurenet.stellar.org \
  --network-passphrase "Test SDF Future Network ; October 2022"
```

## Installation

```bash
# Install Node.js dependencies
npm install

# Build all contracts
npm run build
```

This will compile all contracts to WASM and place them in `target/wasm32-unknown-unknown/release/`.

## Deployment

### Deploy All Contracts

Deploy the complete protocol stack:

```bash
npm run deploy:all
```

With custom network:

```bash
STELLAR_NETWORK=testnet npm run deploy:all
```

With custom account:

```bash
STELLAR_ACCOUNT=my-account npm run deploy:all
```

### Deploy by Stack

Deploy specific contract stacks:

#### Identity Stack
```bash
STACK=identity npm run deploy:stack
```

Deploys:
- TrustedIssuersRegistry
- AttestationRegistry
- IdentityRegistry

#### Issuance Stack
```bash
STACK=issuance npm run deploy:stack
```

Deploys:
- AssetRegistry
- PrimaryMarket

## Contract Addresses

Deployed contract addresses are stored in `deployed_contracts.json` with multi-chain support:

```json
{
  "networks": {
    "stellar-testnet": {
      "contracts": {
        "TrustedIssuersRegistry": "C...",
        "AttestationRegistry": "C...",
        "IdentityRegistry": "C...",
        "AssetRegistry": "C...",
        "PrimaryMarket": "C..."
      },
      "network": "testnet",
      "timestamp": "2026-02-13T..."
    }
  }
}
```

## Testing

```bash
npm test
```

## Contract Interaction

### Invoke Contract Functions

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source default \
  --network testnet \
  -- <FUNCTION_NAME> <ARGS>
```

Example - Register Identity:

```bash
stellar contract invoke \
  --id CDH4B... \
  --source default \
  --network testnet \
  -- register_identity \
  --user <USER_ADDRESS>
```

### Read Contract Data

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source default \
  --network testnet \
  -- <READ_FUNCTION> <ARGS>
```

Example - Check if User is Verified:

```bash
stellar contract invoke \
  --id CDH4B... \
  --source default \
  --network testnet \
  -- is_verified \
  --user <USER_ADDRESS>
```

## Development

### Build Individual Contract

```bash
cd contracts/<contract-name>
cargo build --target wasm32-unknown-unknown --release
```

### Check Contract Size

```bash
ls -lh target/wasm32-unknown-unknown/release/*.wasm
```

### Optimize WASM (if available)

```bash
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/<contract>.wasm
```

## Environment Variables

You can configure deployment via environment variables:

- `STELLAR_NETWORK` - Target network (default: `testnet`)
- `STELLAR_ACCOUNT` - Stellar identity name (default: `default`)

## Integration with Backend

The backend automatically reads contract addresses from `deployed_contracts.json`. Set the environment variable:

```bash
BLOCKCHAIN_NETWORK=stellar-testnet
```

This tells the backend to load contracts from the `stellar-testnet` network key in the deployed contracts file.

## Network Configuration

### Testnet
- RPC: `https://soroban-testnet.stellar.org`
- Network Passphrase: `Test SDF Network ; September 2015`
- Explorer: https://stellar.expert/explorer/testnet

### Futurenet
- RPC: `https://rpc-futurenet.stellar.org`
- Network Passphrase: `Test SDF Future Network ; October 2022`
- Explorer: https://stellar.expert/explorer/futurenet

## Troubleshooting

### Build Errors

If you encounter build errors:

```bash
# Clean build artifacts
cargo clean

# Update dependencies
cargo update

# Rebuild
cargo build --target wasm32-unknown-unknown --release
```

### Contract Too Large

If contract size exceeds limits:

1. Enable optimizations in `Cargo.toml`
2. Use `soroban contract optimize`
3. Reduce contract complexity
4. Split into multiple contracts

### Deployment Failures

- Ensure account has sufficient XLM for fees
- Verify network configuration
- Check contract WASM exists in build output
- Review deployment logs for specific errors

## Resources

- [Stellar CLI Documentation](https://developers.stellar.org/docs/tools/developer-tools/cli)
- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar Documentation](https://developers.stellar.org)
- [Soroban Examples](https://github.com/stellar/soroban-examples)
- [Stellar Laboratory](https://laboratory.stellar.org)
