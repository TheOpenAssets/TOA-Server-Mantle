#!/bin/bash
set -e

echo "============================================================"
echo "Redeploy YieldVault with Fixed claimYield Function"
echo "============================================================"
echo ""

if [ -z "$DEPLOYER_KEY" ]; then
  echo "❌ Error: DEPLOYER_KEY environment variable not set"
  exit 1
fi

echo "📝 Deploying YieldVault..."
cd packages/contracts

# Deploy YieldVault
npx hardhat run scripts/deploy/04_deploy_yield_vault.js --network mantleTestnet

echo ""
echo "✅ YieldVault redeployed!"
echo ""
echo "⚠️  IMPORTANT: You need to update SolvencyVault configuration:"
echo "   Run: node scripts/register-solvency-vault.js"
echo "   This will set the new YieldVault address in SolvencyVault"
echo ""
