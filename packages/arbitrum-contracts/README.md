# Arbitrum Contracts

This package contains the Arbitrum-specific smart contracts for the Open Assets RWA platform, featuring stARB-based leverage functionality.

## Overview

The Arbitrum contracts package is a parallel implementation of the leverage system using **stARB** (Staked ARB) as collateral instead of mETH. The architecture mirrors the Mantle implementation exactly, with only token names and chain-specific configurations changed.

### Key Contracts

#### Arbitrum-Specific Contracts

- **MockStARB.sol** - Simulated liquid staked ARB token for demo/testing
- **MockArbitrumDEX.sol** - Mock AMM for stARB ↔ USDC swaps
- **ArbitrumSwapIntegration.sol** - Slippage-protected swap wrapper
- **StARBLeverageVault.sol** - Core leverage vault using stARB collateral

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

### stARB Leverage System Flow

1. **Collateral Deposit**: User deposits stARB (150% LTV requirement)
2. **Borrowing**: Vault borrows USDC from SeniorPool
3. **RWA Purchase**: USDC used to buy RWA tokens
4. **Yield Harvesting**: stARB appreciation is periodically harvested and swapped to USDC to pay loan interest
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

### Deploy to Arbitrum Sepolia

```bash
# Set environment variables in .env
ADMIN_PRIVATE_KEY=your_private_key

# Deploy
bun hardhat run scripts/deploy/deploy_arbitrum.ts --network arbitrumSepolia
```

### Deploy to Arbitrum Mainnet

```bash
bun hardhat run scripts/deploy/deploy_arbitrum.ts --network arbitrum
```

## Network Configuration

### Arbitrum Sepolia Testnet

- **Chain ID**: 421614
- **RPC URL**: https://sepolia-rollup.arbitrum.io/rpc
- **Block Explorer**: https://sepolia.arbiscan.io

### Arbitrum One Mainnet

- **Chain ID**: 42161
- **RPC URL**: https://arb1.arbitrum.io/rpc
- **Block Explorer**: https://arbiscan.io

## Contract Addresses

After deployment, all contract addresses are saved to `deployed_contracts_arbitrum.json`.

## Key Differences from Mantle

| Aspect | Mantle | Arbitrum |
|--------|--------|----------|
| Collateral Token | mETH | stARB |
| Yield Source | Mantle staking rewards | ARB sequencer fee distribution |
| Expected APY | ~4-6% | ~8% |
| DEX Contract | MockFluxionDEX | MockArbitrumDEX |
| Integration | FluxionIntegration | ArbitrumSwapIntegration |
| Vault Contract | LeverageVault | StARBLeverageVault |

## Testing

The contracts use the same testing patterns as the Mantle implementation. Mock tokens allow easy testing without real asset acquisition.

### Test Flow

1. Mint MockStARB tokens
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

The backend's `BlockchainModule` conditionally loads Arbitrum providers when `NETWORK_TYPE=arbitrum`:

- `StArbPriceService` - Historical ARB/USD price tracking
- `ArbitrumDEXService` - DEX interaction layer
- `LeverageBlockchainService` - Position management (network-agnostic)

## License

MIT
