# Multi-Chain Integration Guide

This guide explains how to use the new multi-chain architecture that supports both Mantle (EVM) and Stellar (Soroban) networks.

## Overview

The platform now supports network-agnostic contract deployment and management through:

1. **Multi-chain `deployed_contracts.json`** - Single file tracking contracts across multiple networks
2. **Network-aware Contract Loader** - Backend automatically loads contracts for the configured network
3. **Stack-based Deployment Scripts** - Atomic deployment of related contracts

## Architecture

### Deployed Contracts Structure

The `deployed_contracts.json` now uses a network-keyed structure:

```json
{
  "networks": {
    "mantle-sepolia": {
      "contracts": {
        "AttestationRegistry": "0x...",
        "IdentityRegistry": "0x...",
        ...
      },
      "network": "mantleSepolia",
      "timestamp": "2026-02-13T..."
    },
    "stellar-testnet": {
      "contracts": {
        "TrustedIssuersRegistry": "C...",
        "AttestationRegistry": "C...",
        ...
      },
      "network": "testnet",
      "timestamp": "2026-02-13T..."
    }
  }
}
```

### Network Keys

Network identifiers used across the system:

| Chain | Network Key | Chain ID / Network Passphrase |
|-------|-------------|-------------------------------|
| Mantle Sepolia | `mantle-sepolia` | 5003 |
| Mantle Testnet | `mantle-testnet` | - |
| Mantle Mainnet | `mantle-mainnet` | 5000 |
| Stellar Testnet | `stellar-testnet` | Test SDF Network ; September 2015 |
| Stellar Futurenet | `stellar-futurenet` | Test SDF Future Network ; October 2022 |

## Deployment

### Mantle (EVM) Contracts

Deploy all contracts:

```bash
cd packages/contracts
npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia
```

Deploy by stack:

```bash
# Compliance layer
STACK=identity npx hardhat run scripts/deploy/deploy_single.ts --network mantleSepolia

# Asset & yield
STACK=issuance npx hardhat run scripts/deploy/deploy_single.ts --network mantleSepolia

# Credit system
STACK=credit npx hardhat run scripts/deploy/deploy_single.ts --network mantleSepolia

# Leverage system
STACK=leverage npx hardhat run scripts/deploy/deploy_single.ts --network mantleSepolia

# Test tokens
STACK=mocks npx hardhat run scripts/deploy/deploy_single.ts --network mantleSepolia
```

### Stellar (Soroban) Contracts

Deploy all contracts:

```bash
cd packages/stellar-contracts
npm run deploy:all
```

Deploy by stack:

```bash
# Compliance layer
STACK=identity npm run deploy:stack

# Asset & market
STACK=issuance npm run deploy:stack
```

With custom network:

```bash
STELLAR_NETWORK=futurenet npm run deploy:all
```

## Backend Configuration

### Environment Variables

Set the network to use:

```bash
# For Mantle
BLOCKCHAIN_NETWORK=mantle-sepolia
CHAIN_ID=5003

# For Stellar
BLOCKCHAIN_NETWORK=stellar-testnet
```

### Automatic Contract Loading

The backend `ContractLoaderService` automatically:

1. Detects the configured network from `BLOCKCHAIN_NETWORK` or `CHAIN_ID`
2. Loads contracts from the corresponding network key in `deployed_contracts.json`
3. Falls back to environment variable overrides if specified

Example flow:

```typescript
// Backend starts with CHAIN_ID=5003
// → Maps to network key: "mantle-sepolia"
// → Loads contracts from deployed_contracts.json → networks → mantle-sepolia → contracts
```

### Network Mapping

The backend automatically maps chain IDs to network keys:

```typescript
const networkMap: Record<number, string> = {
  5003: 'mantle-sepolia',
  5000: 'mantle-mainnet',
};
```

For Stellar, use the explicit network name:

```bash
BLOCKCHAIN_NETWORK=stellar-testnet
```

## Migration from Legacy Format

### Old Format (Single Network)

```json
{
  "contracts": {
    "AttestationRegistry": "0x...",
    ...
  },
  "network": "mantleTestnet",
  "timestamp": "..."
}
```

### New Format (Multi-Chain)

```json
{
  "networks": {
    "mantle-testnet": {
      "contracts": {
        "AttestationRegistry": "0x...",
        ...
      },
      "network": "mantleTestnet",
      "timestamp": "..."
    }
  }
}
```

### Automatic Migration

The deployment scripts and backend automatically migrate legacy format:

1. **Deployment scripts** - Detect legacy format and convert to multi-chain on save
2. **Backend loader** - Falls back to legacy format if multi-chain not found
3. **Warning logs** - Alerts you to migrate to the new format

To manually migrate:

```bash
# Run any deployment script and it will auto-migrate
cd packages/contracts
npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia
```

## Contract Address Resolution

The backend resolves contract addresses in this priority:

1. **Environment variables** (highest priority)
   ```bash
   ATTESTATION_REGISTRY_ADDRESS=0x123...
   ```

2. **Network-specific deployed_contracts.json**
   ```json
   {
     "networks": {
       "mantle-sepolia": {
         "contracts": {
           "AttestationRegistry": "0x..."
         }
       }
     }
   }
   ```

3. **Legacy deployed_contracts.json** (fallback)
   ```json
   {
     "contracts": {
       "AttestationRegistry": "0x..."
     }
   }
   ```

## Stack-Based Deployment

Contracts are now deployed in atomic stacks to ensure dependency integrity:

### Mantle Stacks

**Identity Stack** (foundation layer)
- AttestationRegistry
- TrustedIssuersRegistry
- IdentityRegistry

**Issuance Stack** (depends on identity)
- YieldVault
- TokenFactory
- PrimaryMarket

**Credit Stack** (atomic unit)
- SeniorPool
- SolvencyVault
- OAID

**Leverage Stack**
- FluxionIntegration
- LeverageVault

**Mocks Stack** (test tokens)
- MockUSDC
- MockMETH
- MockFluxionDEX

### Stellar Stacks

**Identity Stack**
- TrustedIssuersRegistry
- AttestationRegistry
- IdentityRegistry

**Issuance Stack** (depends on identity)
- AssetRegistry
- PrimaryMarket

### Benefits of Stack Deployment

1. **Atomic Updates** - All related contracts redeployed together
2. **Dependency Safety** - Impossible to deploy with missing dependencies
3. **Automatic Linking** - Contracts auto-configured with correct addresses
4. **Clean State** - Old addresses removed before new deployment

## Testing Multi-Chain Setup

### 1. Deploy Contracts

```bash
# Deploy Mantle contracts
cd packages/contracts
npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia

# Deploy Stellar contracts
cd packages/stellar-contracts
npm run deploy:all
```

### 2. Verify deployed_contracts.json

```bash
cat packages/contracts/deployed_contracts.json
# Should show both networks

cat packages/stellar-contracts/deployed_contracts.json
# Should show stellar network
```

### 3. Configure Backend

```bash
# In packages/backend/.env
BLOCKCHAIN_NETWORK=mantle-sepolia
# or
BLOCKCHAIN_NETWORK=stellar-testnet
```

### 4. Start Backend

```bash
cd packages/backend
npm run start:dev
```

Check logs for:
```
[ContractLoaderService] Loading contracts for network: mantle-sepolia
[ContractLoaderService] Loaded 17 contract addresses from deployed_contracts.json
```

### 5. Test Contract Access

```bash
# Call any endpoint that uses contracts
curl http://localhost:3000/api/admin/assets
```

## Troubleshooting

### Contracts Not Loading

**Symptom:** Backend logs "No contracts found for network..."

**Solution:**
1. Check `deployed_contracts.json` exists and has the correct network key
2. Verify `BLOCKCHAIN_NETWORK` matches a key in `deployed_contracts.json`
3. Check `CHAIN_ID` maps correctly to network key

### Wrong Network Loaded

**Symptom:** Backend loads contracts from wrong network

**Solution:**
1. Ensure `BLOCKCHAIN_NETWORK` is set correctly
2. For Mantle, verify `CHAIN_ID` matches the network
3. Check no environment variable overrides are set

### Legacy Format Warning

**Symptom:** "Using legacy deployed_contracts.json format"

**Solution:**
Run any deployment script to auto-migrate:
```bash
npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia
```

### Stellar Deployment Fails

**Symptom:** Soroban CLI errors

**Solution:**
1. Verify Soroban CLI installed: `soroban --version`
2. Check account configured: `soroban config identity list`
3. Ensure account funded: `soroban keys fund <account> --network testnet`
4. Verify network configured: `soroban config network list`

## Best Practices

### 1. Use Stack Deployment

Always deploy by stack, not individual contracts:

```bash
# ✅ Good
STACK=credit npm run deploy:stack

# ❌ Avoid (manual contract deployment)
```

### 2. Version Control deployed_contracts.json

Commit `deployed_contracts.json` to track deployment history:

```bash
git add packages/*/deployed_contracts.json
git commit -m "Deploy contracts to mantle-sepolia"
```

### 3. Network Naming Convention

Use consistent network naming:

- Lowercase with hyphens: `mantle-sepolia`, `stellar-testnet`
- Include chain and environment: `{chain}-{environment}`

### 4. Backup Before Redeployment

Stack deployment wipes old addresses:

```bash
# Backup before redeployment
cp deployed_contracts.json deployed_contracts.backup.json
STACK=credit npm run deploy:stack
```

### 5. Environment-Specific Configs

Use different `.env` files per environment:

```bash
# .env.development
BLOCKCHAIN_NETWORK=mantle-sepolia

# .env.staging  
BLOCKCHAIN_NETWORK=mantle-testnet

# .env.production
BLOCKCHAIN_NETWORK=mantle-mainnet
```

## Advanced Usage

### Deploy to Multiple Networks

```bash
# Deploy to Mantle Sepolia
cd packages/contracts
npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia

# Deploy to Stellar Testnet
cd packages/stellar-contracts
STELLAR_NETWORK=testnet npm run deploy:all

# Now deployed_contracts.json has both networks
```

### Switch Networks at Runtime

```bash
# Start backend with Mantle
BLOCKCHAIN_NETWORK=mantle-sepolia npm run start

# Restart with Stellar
BLOCKCHAIN_NETWORK=stellar-testnet npm run start
```

### Custom Network Configuration

Add custom network mappings in `ContractLoaderService`:

```typescript
private getNetworkKey(): string {
  const networkMap: Record<number, string> = {
    5003: 'mantle-sepolia',
    5000: 'mantle-mainnet',
    12345: 'custom-network', // Add custom mapping
  };
  // ...
}
```

## Next Steps

1. **Deploy Contracts** - Use stack deployment for clean, atomic deployments
2. **Configure Backend** - Set `BLOCKCHAIN_NETWORK` to target network
3. **Test Integration** - Verify contract loading and API functionality
4. **Monitor Logs** - Check for network selection and contract loading
5. **Document Addresses** - Keep `deployed_contracts.json` in version control

## Support

For issues or questions:

- Check logs: Backend logs network selection and contract loading
- Verify config: Ensure environment variables set correctly
- Review docs: See README files in contract packages
- Test locally: Use stack deployment to test changes
