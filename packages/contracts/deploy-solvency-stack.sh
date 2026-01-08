#!/bin/bash

# Deploy Solvency Stack (OAID, SeniorPool, SolvencyVault)
# This script deploys all contracts needed for the solvency vault system

set -e

echo "🚀 Starting Solvency Stack Deployment..."
echo "========================================"

# Deploy OAID
echo ""
echo "📋 Step 1/3: Deploying OAID..."
CONTRACT_NAME=OAID npx hardhat run scripts/deploy/deploy_single.ts --network mantleTestnet
echo "✅ OAID deployed"

# Wait 10 seconds
echo ""
echo "⏳ Waiting 10 seconds..."
sleep 10

# Deploy SeniorPool
echo ""
echo "💰 Step 2/3: Deploying SeniorPool..."
CONTRACT_NAME=SeniorPool npx hardhat run scripts/deploy/deploy_single.ts --network mantleTestnet
echo "✅ SeniorPool deployed"

# Wait 10 seconds
echo ""
echo "⏳ Waiting 10 seconds..."
sleep 10

# Deploy SolvencyVault
echo ""
echo "🏦 Step 3/3: Deploying SolvencyVault..."
CONTRACT_NAME=SolvencyVault npx hardhat run scripts/deploy/deploy_single.ts --network mantleTestnet
echo "✅ SolvencyVault deployed"

echo ""
echo "========================================"
echo "✅ Solvency Stack Deployment Complete!"
echo ""
echo "Deployed contracts:"
echo "  - OAID"
echo "  - SeniorPool"
echo "  - SolvencyVault"
echo ""
echo "Check deployed_contracts.json for addresses"
