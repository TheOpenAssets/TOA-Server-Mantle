# RWA Platform Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Architecture Overview](#architecture-overview)
3. [Smart Contract Deployment](#smart-contract-deployment)
4. [Backend Configuration](#backend-configuration)
5. [Historical Price Data Setup](#historical-price-data-setup)
6. [Testing & Verification](#testing--verification)
7. [Production Deployment](#production-deployment)

---

## Prerequisites

### Required Tools
- Node.js v18+
- npm or yarn
- Hardhat
- MongoDB instance
- Redis instance (Railway/Redis Cloud)
- Mantle Sepolia testnet RPC URL
- Private keys for:
  - Admin wallet (asset operations)
  - Platform wallet (yield/USDC operations)
  - Faucet wallet (for test token distribution)

### Important Notes
- **No on-chain price oracle**: mETH price is managed entirely in the backend via MethPriceService
- **Historical CSV data**: Real mETH price history is loaded from CSV file
- **Exact swap functions**: DEX uses exact amounts calculated by backend (no RPC calls for price queries)
- **Single-transaction faucets**: Faucet contracts mint directly to receiver address

---

## Architecture Overview

### Mock Contracts (Simplified)
1. **MockMETH**: Pure ERC20 token (no price oracle, 400k total supply)
2. **MockUSDC**: Pure ERC20 token (100 billion total supply, 6 decimals)
3. **MockFluxionDEX**: Exact swap functions (backend provides amounts)
4. **Faucet**: USDC faucet (single transaction)
5. **METHFaucet**: mETH faucet (single transaction)

### Backend Services
1. **MethPriceService**: Manages historical price data from CSV
   - Loads configurable days of historical data
   - Updates price automatically via cron
   - Provides price conversions (mETH ↔ USDC)
   - All price queries are instant (in-memory Map)

2. **Faucet Service**:
   - `/faucet/usdc` - 1000 USDC (single transaction)
   - `/faucet/meth` - 10 mETH (single transaction)

### Key Benefits
- ⚡ **Zero RPC calls for price queries** (all in-memory)
- 🔄 **Single transaction swaps** (backend calculates, contract executes)
- 📊 **Real historical data** (6 months of actual mETH prices)
- ⚙️ **Configurable updates** (via environment variables)

### Environment Variables
Create `.env` files in both `packages/backend` and `packages/contracts`:

**packages/contracts/.env**:
```bash
# Network
MANTLE_SEPOLIA_RPC_URL=https://rpc.sepolia.mantle.xyz
ETHERSCAN_API_KEY=your_mantle_explorer_api_key

# Wallets
ADMIN_PRIVATE_KEY=0x...
PLATFORM_PRIVATE_KEY=0x...

# Demo Mode
DEMO_MODE=true
```

**packages/backend/.env**:
```bash
# Database
MONGO_URI=mongodb://localhost:27017/rwa-platform

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
# OR for Railway/Redis Cloud:
# REDIS_URL=rediss://...
# REDIS_TLS=true

# Blockchain
RPC_URL=https://rpc.sepolia.mantle.xyz
ADMIN_PRIVATE_KEY=0x...
PLATFORM_PRIVATE_KEY=0x...

# JWT
JWT_SECRET=your-secret-key-here

# Demo Mode
DEMO_MODE=true
```

---

## Smart Contract Deployment

### Step 1: Deploy Core Contracts

```bash
cd packages/contracts

# Compile contracts
npx hardhat compile

# Deploy core contracts (USDC, Registries, etc.)
npx hardhat run scripts/deploy/deploy-core.ts --network mantleTestnet
```

This deploys:
- MockUSDC
- AttestationRegistry
- IdentityRegistry
- TokenFactory
- YieldVault
- PrimaryMarket

### Step 2: Deploy Mock Tokens & Faucets

Update deployment script `packages/contracts/scripts/deploy/deploy-leverage.ts`:

```typescript
import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Deploying Leverage System Contracts...\n');

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MNT\n`);

  // Read existing deployed contracts
  const deployedPath = path.join(__dirname, '../../deployed_contracts.json');
  const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));
  const usdcAddress = deployed.contracts.USDC;

  if (!usdcAddress) {
    throw new Error('USDC address not found in deployed_contracts.json');
  }

  // 1. Deploy MockMETH (400k total supply, no price oracle)
  console.log('📝 Deploying MockMETH...');
  const MockMETH = await ethers.getContractFactory('MockMETH');
  const mockMETH = await MockMETH.deploy();
  await mockMETH.waitForDeployment();
  const mockMETHAddress = await mockMETH.getAddress();
  console.log(`✅ MockMETH deployed: ${mockMETHAddress}`);
  console.log(`   Total Supply: 400,000 mETH (no on-chain price oracle)\n`);

  // 2. Deploy METHFaucet
  console.log('📝 Deploying METHFaucet...');
  const METHFaucet = await ethers.getContractFactory('METHFaucet');
  const methFaucet = await METHFaucet.deploy(mockMETHAddress);
  await methFaucet.waitForDeployment();
  const methFaucetAddress = await methFaucet.getAddress();
  console.log(`✅ METHFaucet deployed: ${methFaucetAddress}\n`);

  // 3. Deploy Faucet (USDC)
  console.log('📝 Deploying Faucet (USDC)...');
  const Faucet = await ethers.getContractFactory('Faucet');
  const faucet = await Faucet.deploy(usdcAddress);
  await faucet.waitForDeployment();
  const faucetAddress = await faucet.getAddress();
  console.log(`✅ Faucet deployed: ${faucetAddress}\n`);

  // 4. Deploy MockFluxionDEX (exact swap functions)
  console.log('📝 Deploying MockFluxionDEX...');
  const MockFluxionDEX = await ethers.getContractFactory('MockFluxionDEX');
  const mockDEX = await MockFluxionDEX.deploy(mockMETHAddress, usdcAddress);
  await mockDEX.waitForDeployment();
  const mockDEXAddress = await mockDEX.getAddress();
  console.log(`✅ MockFluxionDEX deployed: ${mockDEXAddress}`);
  console.log(`   Uses exact swap functions (backend calculates amounts)\n`);

  // 5. Deploy SeniorPool
  console.log('📝 Deploying SeniorPool...');
  const SeniorPool = await ethers.getContractFactory('SeniorPool');
  const seniorPool = await SeniorPool.deploy(usdcAddress);
  await seniorPool.waitForDeployment();
  const seniorPoolAddress = await seniorPool.getAddress();
  console.log(`✅ SeniorPool deployed: ${seniorPoolAddress}\n`);

  // 6. Deploy FluxionIntegration
  console.log('📝 Deploying FluxionIntegration...');
  const FluxionIntegration = await ethers.getContractFactory('FluxionIntegration');
  const fluxionIntegration = await FluxionIntegration.deploy(mockDEXAddress, mockMETHAddress, usdcAddress);
  await fluxionIntegration.waitForDeployment();
  const fluxionIntegrationAddress = await fluxionIntegration.getAddress();
  console.log(`✅ FluxionIntegration deployed: ${fluxionIntegrationAddress}\n`);

  // 7. Deploy LeverageVault
  console.log('📝 Deploying LeverageVault...');
  const LeverageVault = await ethers.getContractFactory('LeverageVault');
  const leverageVault = await LeverageVault.deploy(
    mockMETHAddress,
    usdcAddress,
    seniorPoolAddress,
    fluxionIntegrationAddress
  );
  await leverageVault.waitForDeployment();
  const leverageVaultAddress = await leverageVault.getAddress();
  console.log(`✅ LeverageVault deployed: ${leverageVaultAddress}\n`);

  // 8. Set LeverageVault as authorized borrower on SeniorPool
  console.log('🔗 Authorizing LeverageVault on SeniorPool...');
  await seniorPool.setLeverageVault(leverageVaultAddress);
  console.log('✅ LeverageVault authorized\n');

  // 9. Fund SeniorPool with initial liquidity
  console.log('💰 Funding SeniorPool with 500,000 USDC...');
  const usdc = await ethers.getContractAt('MockUSDC', usdcAddress);
  await usdc.mint(deployer.address, ethers.parseUnits('500000', 6));
  await usdc.approve(seniorPoolAddress, ethers.parseUnits('500000', 6));
  await seniorPool.depositLiquidity(ethers.parseUnits('500000', 6));
  console.log('✅ SeniorPool funded\n');

  // 10. Fund MockFluxionDEX with liquidity
  console.log('💰 Funding MockFluxionDEX with liquidity...');
  await usdc.mint(mockDEXAddress, ethers.parseUnits('1000000', 6)); // 1M USDC
  await mockMETH.mint(mockDEXAddress, ethers.parseEther('500')); // 500 mETH
  console.log('✅ DEX funded\n');

  // Save deployed addresses
  deployed.contracts = {
    ...deployed.contracts,
    MockMETH: mockMETHAddress,
    METHFaucet: methFaucetAddress,
    Faucet: faucetAddress,
    MockFluxionDEX: mockDEXAddress,
    SeniorPool: seniorPoolAddress,
    FluxionIntegration: fluxionIntegrationAddress,
    LeverageVault: leverageVaultAddress,
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  console.log('\n✅ All contracts deployed successfully!\n');
  console.log('📋 Deployment Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`MockMETH:             ${mockMETHAddress}`);
  console.log(`METHFaucet:           ${methFaucetAddress}`);
  console.log(`Faucet (USDC):        ${faucetAddress}`);
  console.log(`MockFluxionDEX:       ${mockDEXAddress}`);
  console.log(`SeniorPool:           ${seniorPoolAddress}`);
  console.log(`FluxionIntegration:   ${fluxionIntegrationAddress}`);
  console.log(`LeverageVault:        ${leverageVaultAddress}`);
  console.log('═══════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

Deploy leverage contracts:
```bash
npx hardhat run scripts/deploy/deploy-leverage.ts --network mantleTestnet
```

### Step 3: Verify Deployment

```bash
# Verify each contract on Mantle Explorer
npx hardhat verify --network mantleTestnet <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

---

## Backend Configuration

### Step 1: Add Historical Price Data Configuration

Add to `packages/backend/.env`:

```bash
# mETH Price Configuration
METH_PRICE_UPDATE_INTERVAL_SECONDS=14400  # 4 hours
METH_PRICE_HISTORY_DAYS=180              # 6 months
```

**Understanding the configuration:**
- **Update Interval**: How often the price updates (in seconds)
  - `14400` = 4 hours → 6 updates/day
  - `3600` = 1 hour → 24 updates/day
  - `300` = 5 minutes → 288 updates/day (for testing)

- **History Days**: How many days of historical data to load
  - `180` days with 6 updates/day = ~30 days of runtime
  - `180` days with 24 updates/day = ~7.5 days of runtime

### Step 2: Verify Module Configuration

Ensure `packages/backend/src/app.module.ts` includes:

```typescript
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    // ... other modules
    ScheduleModule.forRoot(), // Required for MethPriceService cron jobs
    // ... other modules
  ],
})
export class AppModule {}
```

And `packages/backend/src/modules/blockchain/blockchain.module.ts` exports MethPriceService:

```typescript
@Global()
@Module({
  providers: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
    MethPriceService, // ✅ Included
    EventProcessor,
  ],
  exports: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
    MethPriceService, // ✅ Exported
  ],
})
export class BlockchainModule {}
```

### Step 3: Update Blockchain Config

Ensure `packages/backend/src/config/blockchain.config.ts` includes all contract addresses:

```typescript
export default () => {
  const deployedContracts = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), '../contracts/deployed_contracts.json'),
      'utf-8'
    )
  );

  return {
    blockchain: {
      rpcUrl: process.env.RPC_URL,
      contracts: {
        ...deployedContracts.contracts,
        // Mock tokens & faucets
        MockMETH: deployedContracts.contracts.MockMETH,
        METHFaucet: deployedContracts.contracts.METHFaucet,
        Faucet: deployedContracts.contracts.Faucet,
        MockFluxionDEX: deployedContracts.contracts.MockFluxionDEX,
        // Leverage system
        SeniorPool: deployedContracts.contracts.SeniorPool,
        FluxionIntegration: deployedContracts.contracts.FluxionIntegration,
        LeverageVault: deployedContracts.contracts.LeverageVault,
      },
    },
  };
};
```

### Step 4: Install Dependencies

```bash
cd packages/backend
npm install
```

### Step 5: Build Backend

```bash
npm run build
```

### Step 6: Start Backend Services

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run start:prod
```

**Expected startup logs:**
```
[MethPriceService] Initializing mETH Price Service...
[MethPriceService] Configuration: Update interval = 14400s, History window = 180 days
[MethPriceService] Loaded 180 days of historical data from CSV
[MethPriceService] Date range: 2024-07-04 to 2024-12-31
[MethPriceService] mETH Price Service initialized with 180 days of historical data
[MethPriceService] Current mETH price: $3456.78
[MethPriceService] Price will update every 14400s (6.0 times/day)
[MethPriceService] 180 days of data will last approximately 30 days of runtime
[MethPriceService] Scheduled price updates with cron expression: 0 */4 * * *
```

---

## Historical Price Data Setup

### Step 1: Obtain CSV Data

Place the historical mETH price CSV file at:
```
packages/backend/Data/meth-usd-max.csv
```

**CSV Format:**
```csv
timestamp,price
2024-07-04 00:00:00 UTC,2850.32
2024-07-05 00:00:00 UTC,2856.45
2024-07-06 00:00:00 UTC,2862.11
...
```

### Step 2: Verify CSV Loading

Start the backend and check logs:

```bash
npm run start:dev
```

Look for:
- ✅ `Loaded X days of historical data from CSV`
- ✅ `Date range: YYYY-MM-DD to YYYY-MM-DD`
- ✅ `Current mETH price: $XXXX.XX`

### Step 3: Fallback Behavior

If CSV is not found, the service will use **simulated data**:
- Generates 180 days of synthetic prices
- Starts at $2850 with 5% APY growth
- Logs warning: `CSV file not found at [path]. Using simulated data.`

### Step 4: Test Price Updates

The price will automatically update based on your `METH_PRICE_UPDATE_INTERVAL_SECONDS`:

```bash
# Watch for price updates in logs
tail -f logs/backend.log | grep "Price updated"
```

Expected output:
```
[MethPriceService] Running scheduled price update...
[MethPriceService] Price updated: $3456.78 → $3459.12 (2024-08-15)
```

### Step 5: Verify Price API

Test the price service endpoints:

```bash
# Get current price
curl http://localhost:3000/leverage/meth-price

# Get price chart data (last 30 days)
curl http://localhost:3000/leverage/price-chart?days=30

# Get price statistics
curl http://localhost:3000/leverage/price-stats
```

---

## Testing & Verification

### 1. Test Faucet Endpoints

**Request USDC:**
```bash
curl -X POST http://localhost:3000/faucet/usdc \
  -H "Content-Type: application/json" \
  -d '{"receiverAddress": "0xYourWalletAddress"}'
```

**Request mETH:**
```bash
curl -X POST http://localhost:3000/faucet/meth \
  -H "Content-Type: application/json" \
  -d '{"receiverAddress": "0xYourWalletAddress"}'
```

Expected response:
```json
{
  "success": true,
  "message": "Successfully sent 1000 USDC to 0x...",
  "transactionHash": "0x...",
  "amount": "1000",
  "receiverAddress": "0x...",
  "explorerUrl": "https://explorer.sepolia.mantle.xyz/tx/0x..."
}
```

### 2. Verify Contract Deployment

```bash
# Check mETH balance (should be 400k for deployer)
cast call $MOCK_METH_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url $RPC_URL

# Check USDC balance (should be 100B for deployer)
cast call $MOCK_USDC_ADDRESS "balanceOf(address)(uint256)" $DEPLOYER_ADDRESS --rpc-url $RPC_URL

# Check SeniorPool liquidity
cast call $SENIOR_POOL_ADDRESS "availableLiquidity()(uint256)" --rpc-url $RPC_URL

# Check DEX reserves
cast call $MOCK_DEX_ADDRESS "mETHReserve()(uint256)" --rpc-url $RPC_URL
cast call $MOCK_DEX_ADDRESS "usdcReserve()(uint256)" --rpc-url $RPC_URL
```

### 3. Test MethPriceService

**Get Current Price:**
```bash
curl http://localhost:3000/leverage/meth-price
```

Expected response:
```json
{
  "price": 3456.78,
  "priceInUSDCWei": 3456780000,
  "timestamp": "2024-12-31T00:00:00.000Z"
}
```

**Get Price Chart:**
```bash
curl "http://localhost:3000/leverage/price-chart?days=7"
```

**Get Price Statistics:**
```bash
curl http://localhost:3000/leverage/price-stats
```

Expected response:
```json
{
  "current": 3456.78,
  "min": 2850.12,
  "max": 3500.45,
  "avg": 3123.56,
  "changePercent": 21.3
}
```

### 4. Test Price-Based Conversions

The MethPriceService provides automatic conversions:

```bash
# Test mETH → USDC conversion
curl "http://localhost:3000/leverage/quote/meth-to-usdc?amount=1000000000000000000"

# Test USDC → mETH conversion
curl "http://localhost:3000/leverage/quote/usdc-to-meth?amount=3000000000"
```

### 5. Verify Price Updates

Monitor automatic price updates:

```bash
# Watch logs for scheduled updates
tail -f logs/backend.log | grep "MethPriceService"
```

You should see updates every `METH_PRICE_UPDATE_INTERVAL_SECONDS`:
```
[MethPriceService] Running scheduled price update...
[MethPriceService] Price updated: $3456.78 → $3459.12 (2024-08-15)
```

### 6. Test Leverage Flow

**Create Test Position:**
```bash
curl -X POST http://localhost:3000/leverage/initiate \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "assetId": "test-asset-001",
    "tokenAddress": "0x...",
    "tokenAmount": "100000000000000000000",
    "pricePerToken": "800000",
    "mETHCollateral": "50000000000000000000"
  }'
```

**Monitor Position:**
```bash
# Get position details
curl http://localhost:3000/leverage/position/1 \
  -H "Authorization: Bearer $JWT_TOKEN"

# Watch position health
watch -n 10 'curl -s http://localhost:3000/leverage/position/1/health \
  -H "Authorization: Bearer $JWT_TOKEN" | jq'
```

### 7. Verify Exact Swap Functions

The backend uses `MethPriceService` to calculate exact amounts, then calls the DEX:

```bash
# Backend flow for leverage purchase:
# 1. Get current mETH price from MethPriceService (no RPC call)
# 2. Calculate exact USDC amount needed
# 3. Call DEX.swapMETHForUSDCExact(methAmount, exactUSDCOut) - single transaction
# 4. No separate setExchangeRate call needed!
```

### 8. Test Price Scenarios

Since price is managed in the backend, you can test different scenarios by:

1. **Adjusting update interval** (for faster testing):
   ```bash
   # In .env
   METH_PRICE_UPDATE_INTERVAL_SECONDS=60  # Update every minute
   ```

2. **Manually triggering price update** (via backend admin endpoint):
   ```bash
   curl -X POST http://localhost:3000/admin/meth-price/update \
     -H "Authorization: Bearer $ADMIN_JWT_TOKEN"
   ```

3. **Monitoring impact on positions**:
   - Price increases → Collateral value goes up → Health improves
   - Price decreases → Collateral value goes down → Health degrades
   - All automatic based on historical data!

---

## Production Deployment

### Checklist

- [ ] Deploy all smart contracts to Mantle mainnet
- [ ] Verify contracts on Mantle Explorer
- [ ] Place real mETH price CSV in `packages/backend/Data/`
- [ ] Configure production MongoDB cluster
- [ ] Configure production Redis cluster
- [ ] Set appropriate `METH_PRICE_UPDATE_INTERVAL_SECONDS` (production: 14400+)
- [ ] Set up monitoring (DataDog, Sentry, etc.)
- [ ] Configure backup strategies
- [ ] Set up alerts for price service failures
- [ ] Test faucet endpoints work correctly
- [ ] Verify MethPriceService loads CSV successfully
- [ ] Test with small amounts first
- [ ] Audit smart contracts
- [ ] Set up multi-sig for admin operations

### Production Configuration

**Recommended settings for `.env`:**
```bash
# Price updates every 4 hours (production)
METH_PRICE_UPDATE_INTERVAL_SECONDS=14400

# Load 180 days of historical data
METH_PRICE_HISTORY_DAYS=180

# Production database
MONGODB_URI=mongodb+srv://...

# Production Redis
REDIS_URL=rediss://...
REDIS_TLS=true
```

---

## Troubleshooting

### Issue: CSV file not found
**Solution**: Ensure `packages/backend/Data/meth-usd-max.csv` exists. Service will fall back to simulated data if not found.

### Issue: Price not updating
**Solution**: Check ScheduleModule is registered in app.module.ts and cron expression is valid.

### Issue: Faucet transaction fails
**Solution**: Ensure faucet contract has enough tokens to mint, and receiver address is valid.

### Issue: DEX swap fails
**Solution**: Check MockFluxionDEX has sufficient liquidity (USDC + mETH reserves).

### Issue: Position creation fails
**Solution**: Ensure SeniorPool has sufficient liquidity and LeverageVault is authorized.

### Issue: MethPriceService not found
**Solution**: Verify MethPriceService is exported in blockchain.module.ts.

---

## Architecture Benefits

### Zero RPC Calls for Price Queries
- Old: Every price query required on-chain read
- New: All prices in-memory (Map data structure)
- Result: Instant price queries, no rate limiting

### Single Transaction Swaps
- Old: `setExchangeRate()` + `swap()` = 2 transactions
- New: Backend calculates + `swapExact()` = 1 transaction
- Result: 50% fewer transactions, lower gas costs

### Real Historical Data
- Old: Manual price updates or simulated data
- New: Real mETH price history from CSV
- Result: Realistic testing scenarios

### Configurable Updates
- Update interval adjustable from 1 minute to 24+ hours
- History window adjustable from 7 days to 365+ days
- Perfect for both testing and production

---

## Support

For issues or questions:
- GitHub Issues: [repository-url]/issues
- Documentation: [docs-url]
