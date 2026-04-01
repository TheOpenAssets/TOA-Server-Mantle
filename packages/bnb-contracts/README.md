# BNB Contracts

This package contains the BNB-focused smart contracts for the Open Assets RWA platform, featuring ankrBNB-based leverage functionality.

## Overview

The BNB contracts package is a BNB-focused implementation of the leverage system using **ankrBNB** as collateral. The architecture mirrors the Mantle implementation with BNB-specific deployment/configuration.

### Key Contracts

#### BNB Leverage Contracts

- **AnkrBNB.sol** - Simulated ankrBNB token for demo/testing
- **MockBNBDEX.sol** - Mock AMM for ankrBNB ↔ USDC swaps
- **BNBSwapIntegration.sol** - Slippage-protected swap wrapper
- **BNBLeverageVault.sol** - Core leverage vault using ankrBNB collateral

#### Shared Platform Contracts

- **SeniorPool.sol** - USDC lending pool (chain-agnostic)
- **AttestationRegistry.sol** - Asset attestation system
- **IdentityRegistry.sol** - On-chain KYC/identity management
- **TokenFactory.sol** - RWA token deployment
- **YieldVault.sol** - Yield distribution system
- **PrimaryMarket.sol** - Initial token offerings
- **SecondaryMarket.sol** - P2P trading
- **OAID.sol** - On-chain identity credentials

## Architecture

### ankrBNB Leverage System Flow

1. **Collateral Deposit**: User deposits ankrBNB (150% LTV requirement)
2. **Borrowing**: Vault borrows USDC from SeniorPool
3. **RWA Purchase**: USDC used to buy RWA tokens
4. **Yield Harvesting**: ankrBNB appreciation is periodically harvested and swapped to USDC to pay loan interest
5. **Settlement**: Upon RWA asset maturity or liquidation, waterfall distribution occurs

### Health Monitoring

- **Liquidation Threshold**: 115% collateral ratio
- **Initial LTV**: 150% over-collateralization
- **Liquidation Fee**: 10% on excess after debt repayment

## Development

### Prerequisites

```bash
# Install dependencies
bun install
```

### Compile Contracts

```bash
bun run generate:types
```

### Deploy to BNB Testnet

```bash
# Set environment variables in .env
ADMIN_PRIVATE_KEY=your_private_key

# Optional custom RPC
BNB_TESTNET_RPC_URL=https://data-seed-prebsc-1-s1.bnbchain.org:8545

bun hardhat run scripts/deploy/deploy_bnb.ts --network bnbTestnet
```

After deployment, sync exported addresses for backend/frontend consumption:

```bash
pnpm --filter @contracts/bnb sync:bnb:addresses
```

## Network Configuration

### BNB Smart Chain Testnet

- **Chain ID**: 97
- **RPC URL**: https://data-seed-prebsc-1-s1.bnbchain.org:8545
- **Block Explorer**: https://testnet.bscscan.com

## Contract Addresses

After deployment, contract addresses are saved to `deployed_contracts_bnb.json`.

## Key Differences from Mantle

| Aspect | Mantle | BNB Stack |
|--------|--------|----------|
| Collateral Token | mETH | ankrBNB |
| Yield Source | Mantle staking rewards | ankrBNB strategy yield |
| Expected APY | ~4-6% | ~8% |
| DEX Contract | MockFluxionDEX | MockBNBDEX |
| Integration | FluxionIntegration | BNBSwapIntegration |
| Vault Contract | LeverageVault | BNBLeverageVault |

## Testing

The contracts use the same testing patterns as the Mantle implementation. Mock tokens allow easy testing without real asset acquisition.

### Test Flow

1. Mint ankrBNB tokens
2. Create leverage position
3. Simulate price movements
4. Execute harvest
5. Test liquidation scenarios

## Security Considerations

- All price data comes from backend (off-chain oracle)
- 3% maximum slippage protection on swaps
- Emergency pause functionality on swap integrations
- Non-reentrant modifiers on all state-changing functions
- 150% over-collateralization requirement

## Integration with Backend

The backend's `BlockchainModule` conditionally loads BNB providers when `NETWORK_TYPE=bnb`:

- `StArbPriceService` - Historical ARB/USD price tracking
- `BnbDexService` - DEX interaction layer for BNB ankrBNB flow
- `LeverageBlockchainService` - Position management (network-agnostic)

## License

MIT
