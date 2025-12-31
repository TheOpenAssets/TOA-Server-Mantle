# RWA Platform Deployment Guide

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Smart Contract Deployment](#smart-contract-deployment)
3. [Backend Configuration](#backend-configuration)
4. [Demo Mode Setup](#demo-mode-setup)
5. [Testing & Verification](#testing--verification)

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

### Step 2: Deploy Leverage Contracts

Create deployment script `packages/contracts/scripts/deploy/deploy-leverage.ts`:

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

  // 1. Deploy MockMETH
  console.log('📝 Deploying MockMETH...');
  const MockMETH = await ethers.getContractFactory('MockMETH');
  const mockMETH = await MockMETH.deploy();
  await mockMETH.waitForDeployment();
  const mockMETHAddress = await mockMETH.getAddress();
  console.log(`✅ MockMETH deployed: ${mockMETHAddress}\n`);

  // Set initial mETH price to $3000
  console.log('💰 Setting initial mETH price to $3000...');
  await mockMETH.setPrice(3000);
  console.log('✅ mETH price set\n');

  // 2. Deploy MockFluxionDEX
  console.log('📝 Deploying MockFluxionDEX...');
  const MockFluxionDEX = await ethers.getContractFactory('MockFluxionDEX');
  const mockDEX = await MockFluxionDEX.deploy(mockMETHAddress, usdcAddress);
  await mockDEX.waitForDeployment();
  const mockDEXAddress = await mockDEX.getAddress();
  console.log(`✅ MockFluxionDEX deployed: ${mockDEXAddress}\n`);

  // Set initial exchange rate (1 mETH = 3000 USDC)
  console.log('💱 Setting DEX exchange rate (1 mETH = 3000 USDC)...');
  await mockDEX.setExchangeRate(ethers.parseUnits('3000', 6));
  console.log('✅ Exchange rate set\n');

  // 3. Deploy SeniorPool
  console.log('📝 Deploying SeniorPool...');
  const SeniorPool = await ethers.getContractFactory('SeniorPool');
  const seniorPool = await SeniorPool.deploy(usdcAddress);
  await seniorPool.waitForDeployment();
  const seniorPoolAddress = await seniorPool.getAddress();
  console.log(`✅ SeniorPool deployed: ${seniorPoolAddress}\n`);

  // Enable demo mode on SeniorPool
  console.log('⚡ Enabling demo mode on SeniorPool (360x time acceleration)...');
  await seniorPool.setDemoMode(true, 360);
  console.log('✅ Demo mode enabled\n');

  // 4. Deploy FluxionIntegration
  console.log('📝 Deploying FluxionIntegration...');
  const FluxionIntegration = await ethers.getContractFactory('FluxionIntegration');
  const fluxionIntegration = await FluxionIntegration.deploy(mockDEXAddress, mockMETHAddress, usdcAddress);
  await fluxionIntegration.waitForDeployment();
  const fluxionIntegrationAddress = await fluxionIntegration.getAddress();
  console.log(`✅ FluxionIntegration deployed: ${fluxionIntegrationAddress}\n`);

  // 5. Deploy LeverageVault
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

  // 6. Set LeverageVault as authorized borrower on SeniorPool
  console.log('🔗 Authorizing LeverageVault on SeniorPool...');
  await seniorPool.setLeverageVault(leverageVaultAddress);
  console.log('✅ LeverageVault authorized\n');

  // 7. Fund SeniorPool with initial liquidity
  console.log('💰 Funding SeniorPool with 500,000 USDC...');
  const usdc = await ethers.getContractAt('MockUSDC', usdcAddress);
  await usdc.mint(deployer.address, ethers.parseUnits('500000', 6));
  await usdc.approve(seniorPoolAddress, ethers.parseUnits('500000', 6));
  await seniorPool.depositLiquidity(ethers.parseUnits('500000', 6));
  console.log('✅ SeniorPool funded\n');

  // 8. Fund MockFluxionDEX with liquidity
  console.log('💰 Funding MockFluxionDEX with liquidity...');
  await usdc.mint(mockDEXAddress, ethers.parseUnits('1000000', 6)); // 1M USDC
  await mockMETH.mint(mockDEXAddress, ethers.parseEther('500')); // 500 mETH
  console.log('✅ DEX funded\n');

  // Save deployed addresses
  deployed.contracts = {
    ...deployed.contracts,
    MockMETH: mockMETHAddress,
    MockFluxionDEX: mockDEXAddress,
    SeniorPool: seniorPoolAddress,
    FluxionIntegration: fluxionIntegrationAddress,
    LeverageVault: leverageVaultAddress,
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  console.log('\n✅ All leverage contracts deployed successfully!\n');
  console.log('📋 Deployment Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`MockMETH:             ${mockMETHAddress}`);
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

### Step 1: Update Blockchain Config

Edit `packages/backend/src/config/blockchain.config.ts`:

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
        // Leverage contracts
        MockMETH: deployedContracts.contracts.MockMETH,
        MockFluxionDEX: deployedContracts.contracts.MockFluxionDEX,
        SeniorPool: deployedContracts.contracts.SeniorPool,
        FluxionIntegration: deployedContracts.contracts.FluxionIntegration,
        LeverageVault: deployedContracts.contracts.LeverageVault,
      },
    },
  };
};
```

### Step 2: Install Dependencies

```bash
cd packages/backend
npm install
```

### Step 3: Build Backend

```bash
npm run build
```

### Step 4: Start Backend Services

```bash
# Development mode (with hot reload)
npm run start:dev

# Production mode
npm run start:prod
```

---

## Demo Mode Setup

### Demo Mode Features
- ⚡ **360x time acceleration** - 1 minute = 6 hours
- 🤖 **Harvest keeper**: Runs every 4 minutes (instead of 24 hours)
- 📊 **Health monitor**: Runs every 1 minute (instead of 5 minutes)
- 📈 **Interest accrual**: Accelerated 360x in SeniorPool

### Environment Variable

Set in both `.env` files:
```bash
DEMO_MODE=true
```

### Demo Scenario Scripts

Create `scripts/demo/` directory with the following scripts:

**1. Create Test Position** (`scripts/demo/create-position.sh`):
```bash
#!/bin/bash

# User creates leveraged position
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

**2. Monitor Position** (`scripts/demo/monitor.sh`):
```bash
#!/bin/bash

watch -n 5 'curl -s http://localhost:3000/leverage/position/1 \
  -H "Authorization: Bearer $JWT_TOKEN" | jq'
```

**3. Scenario: Perfect Coverage** (`scripts/demo/scenario-perfect.sh`):
```bash
#!/bin/bash

# Maintain mETH price at $3000 (stable health factor)
cast send $MOCK_METH_ADDRESS "setPrice(uint256)" 3000 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

echo "✅ Scenario: mETH stable at $3000 - yield should cover interest"
```

**4. Scenario: Price Increase** (`scripts/demo/scenario-surplus.sh`):
```bash
#!/bin/bash

# Increase mETH price to $3500 (surplus yield)
cast send $MOCK_METH_ADDRESS "setPrice(uint256)" 3500 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

cast send $MOCK_FLUXION_DEX "setExchangeRate(uint256)" 3500000000 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

echo "✅ Scenario: mETH increased to $3500 - surplus yield expected"
```

**5. Scenario: Price Decrease** (`scripts/demo/scenario-shortfall.sh`):
```bash
#!/bin/bash

# Decrease mETH price to $2700 (shortfall)
cast send $MOCK_METH_ADDRESS "setPrice(uint256)" 2700 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

cast send $MOCK_FLUXION_DEX "setExchangeRate(uint256)" 2700000000 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

echo "⚠️  Scenario: mETH decreased to $2700 - yield shortfall, health degrading"
```

**6. Scenario: Liquidation** (`scripts/demo/scenario-liquidation.sh`):
```bash
#!/bin/bash

# Crash mETH price to $1500 (trigger liquidation at 110%)
cast send $MOCK_METH_ADDRESS "setPrice(uint256)" 1500 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

cast send $MOCK_FLUXION_DEX "setExchangeRate(uint256)" 1500000000 \
  --rpc-url $RPC_URL --private-key $ADMIN_PRIVATE_KEY

echo "🚨 Scenario: mETH crashed to $1500 - liquidation should trigger!"
```

Make scripts executable:
```bash
chmod +x scripts/demo/*.sh
```

---

## Testing & Verification

### 1. Verify Contract Deployment

```bash
# Check mETH price
cast call $MOCK_METH_ADDRESS "getPrice()(uint256)" --rpc-url $RPC_URL

# Check SeniorPool liquidity
cast call $SENIOR_POOL_ADDRESS "availableLiquidity()(uint256)" --rpc-url $RPC_URL

# Check demo mode status
cast call $SENIOR_POOL_ADDRESS "demoMode()(bool)" --rpc-url $RPC_URL
```

### 2. Test Backend Endpoints

**Get mETH Price**:
```bash
curl http://localhost:3000/leverage/meth-price \
  -H "Authorization: Bearer $JWT_TOKEN"
```

**Get Swap Quote**:
```bash
curl http://localhost:3000/leverage/quote/1000000000000000000 \
  -H "Authorization: Bearer $JWT_TOKEN"
```

### 3. Test Automation Services

**Check Harvest Keeper Logs**:
```bash
tail -f logs/backend.log | grep "HarvestKeeperService"
```

**Check Health Monitor Logs**:
```bash
tail -f logs/backend.log | grep "HealthMonitorService"
```

### 4. Test Complete Flow

1. **Create Position**:
   ```bash
   ./scripts/demo/create-position.sh
   ```

2. **Monitor Position**:
   ```bash
   ./scripts/demo/monitor.sh
   ```

3. **Wait 4 minutes** for first harvest (demo mode)

4. **Trigger Scenarios**:
   ```bash
   # Test surplus
   ./scripts/demo/scenario-surplus.sh

   # Wait 4 minutes, observe harvest

   # Test liquidation
   ./scripts/demo/scenario-liquidation.sh

   # Wait 1 minute, observe liquidation
   ```

### 5. Verify Database Records

```bash
# Connect to MongoDB
mongosh $MONGO_URI

# Check leverage positions
use rwa-platform
db.leveragepositions.find().pretty()

# Check harvest history
db.leveragepositions.findOne({positionId: 1}).harvestHistory
```

---

## Production Deployment Checklist

- [ ] Deploy all smart contracts to Mantle mainnet
- [ ] Verify contracts on Mantle Explorer
- [ ] Set `DEMO_MODE=false` in production
- [ ] Configure production MongoDB cluster
- [ ] Configure production Redis cluster
- [ ] Set up monitoring (DataDog, Sentry, etc.)
- [ ] Configure backup strategies
- [ ] Set up alerts for liquidation events
- [ ] Test with small amounts first
- [ ] Audit smart contracts
- [ ] Set up multi-sig for admin operations

---

## Troubleshooting

### Issue: Harvest not running
**Solution**: Check that `DEMO_MODE=true` and ScheduleModule is registered

### Issue: Position creation fails
**Solution**: Ensure SeniorPool has sufficient liquidity and LeverageVault is authorized

### Issue: DEX swap fails
**Solution**: Check MockFluxionDEX has sufficient liquidity (USDC + mETH)

### Issue: Health monitor not triggering
**Solution**: Verify cron job is running (`@Cron('*/1 * * * *')` for demo mode)

---

## Support

For issues or questions:
- GitHub Issues: [repository-url]/issues
- Documentation: [docs-url]
