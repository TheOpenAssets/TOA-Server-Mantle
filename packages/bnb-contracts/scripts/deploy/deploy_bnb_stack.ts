import { ethers } from "hardhat";

async function waitForTx(txPromise: Promise<any>) {
  const tx = await txPromise;
  await tx.wait();
  return tx;
}

function getDeploymentMeta(chainId: bigint) {
  return {
    network: 'bnb',
    filename: 'deployed_contracts_bnb.json',
    nativeSymbol: 'tBNB',
  };
}

/**
 * Deploy BNB Leverage Stack
 * 
 * This script deploys the full ankrBNB-based leverage system for BNB:
 * - AnkrBNB (collateral token)
 * - MockUSDC (loan token)
 * - SeniorPool (USDC lending pool)
 * - MockBNBDEX (stARB/USDC swap)
 * - BNBSwapIntegration (slippage-protected swaps)
 * - BNBLeverageVault (core vault)
 * - Platform infrastructure contracts
 */

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const deployMeta = getDeploymentMeta(chainId);

  console.log(`📦 Deploying ${deployMeta.network.toUpperCase()} Leverage Stack`);
  console.log("🔑 Deployer:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), `${deployMeta.nativeSymbol}\n`);

  const deployedContracts: Record<string, string> = {};

  // Step 1: Deploy base tokens
  console.log("1️⃣ Deploying base tokens...");
  
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  deployedContracts.MockUSDC = await usdc.getAddress();
  console.log("   ✅ MockUSDC:", deployedContracts.MockUSDC);

  const AnkrBNB = await ethers.getContractFactory("AnkrBNB");
  const ankrBNB = await AnkrBNB.deploy();
  await ankrBNB.waitForDeployment();
  deployedContracts.AnkrBNB = await ankrBNB.getAddress();
  console.log("   ✅ AnkrBNB:", deployedContracts.AnkrBNB);

  // Step 2: Deploy SeniorPool
  console.log("\n2️⃣ Deploying SeniorPool...");
  
  const SeniorPool = await ethers.getContractFactory("SeniorPool");
  const seniorPool = await SeniorPool.deploy(deployedContracts.MockUSDC);
  await seniorPool.waitForDeployment();
  deployedContracts.SeniorPool = await seniorPool.getAddress();
  console.log("   ✅ SeniorPool:", deployedContracts.SeniorPool);

  // Fund SeniorPool with USDC
  console.log("   💵 Funding SeniorPool with 1M USDC...");
  const fundAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  await waitForTx(usdc.mint(deployer.address, fundAmount));
  await waitForTx(usdc.approve(deployedContracts.SeniorPool, fundAmount));
  await waitForTx(seniorPool.depositLiquidity(fundAmount));
  console.log("   ✅ SeniorPool funded");

  // Step 3: Deploy DEX infrastructure
  console.log("\n3️⃣ Deploying DEX infrastructure...");
  
  const initialExchangeRate = ethers.parseUnits("0.8", 6); // 1 stARB = 0.8 USDC
  const MockBNBDEX = await ethers.getContractFactory("MockBNBDEX");
  const dex = await MockBNBDEX.deploy(
    deployedContracts.AnkrBNB,
    deployedContracts.MockUSDC,
    initialExchangeRate
  );
  await dex.waitForDeployment();
  deployedContracts.MockBNBDEX = await dex.getAddress();
  console.log("   ✅ MockBNBDEX:", deployedContracts.MockBNBDEX);

  // Fund DEX with USDC liquidity
  console.log("   💵 Funding DEX with 500K USDC liquidity...");
  const dexFundAmount = ethers.parseUnits("500000", 6);
  await waitForTx(usdc.mint(deployer.address, dexFundAmount));
  await waitForTx(usdc.approve(deployedContracts.MockBNBDEX, dexFundAmount));
  await waitForTx(dex.addLiquidity(0, dexFundAmount));
  console.log("   ✅ DEX funded");

  // Step 4: Deploy BNBSwapIntegration
  console.log("\n4️⃣ Deploying BNBSwapIntegration...");
  
  const placeholderOracle = deployedContracts.AnkrBNB; // Using ankrBNB as placeholder oracle
  const BNBSwapIntegration = await ethers.getContractFactory("BNBSwapIntegration");
  const swapIntegration = await BNBSwapIntegration.deploy(
    deployedContracts.AnkrBNB,
    deployedContracts.MockUSDC,
    deployedContracts.MockBNBDEX,
    placeholderOracle
  );
  await swapIntegration.waitForDeployment();
  deployedContracts.BNBSwapIntegration = await swapIntegration.getAddress();
  console.log("   ✅ BNBSwapIntegration:", deployedContracts.BNBSwapIntegration);

  // Step 5: Deploy platform infrastructure
  console.log("\n5️⃣ Deploying platform infrastructure...");
  
  // AttestationRegistry
  const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
  const attestationRegistry = await AttestationRegistry.deploy();
  await attestationRegistry.waitForDeployment();
  deployedContracts.AttestationRegistry = await attestationRegistry.getAddress();
  console.log("   ✅ AttestationRegistry:", deployedContracts.AttestationRegistry);

  // TrustedIssuersRegistry
  const TrustedIssuersRegistry = await ethers.getContractFactory("TrustedIssuersRegistry");
  const trustedIssuersRegistry = await TrustedIssuersRegistry.deploy();
  await trustedIssuersRegistry.waitForDeployment();
  deployedContracts.TrustedIssuersRegistry = await trustedIssuersRegistry.getAddress();
  console.log("   ✅ TrustedIssuersRegistry:", deployedContracts.TrustedIssuersRegistry);

  // IdentityRegistry
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(
    deployedContracts.TrustedIssuersRegistry
  );
  await identityRegistry.waitForDeployment();
  deployedContracts.IdentityRegistry = await identityRegistry.getAddress();
  console.log("   ✅ IdentityRegistry:", deployedContracts.IdentityRegistry);

  // YieldVault
  const YieldVault = await ethers.getContractFactory("YieldVault");
  const yieldVault = await YieldVault.deploy(deployedContracts.MockUSDC, deployer.address);
  await yieldVault.waitForDeployment();
  deployedContracts.YieldVault = await yieldVault.getAddress();
  console.log("   ✅ YieldVault:", deployedContracts.YieldVault);

  // TokenFactory
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const tokenFactory = await TokenFactory.deploy(
    deployedContracts.AttestationRegistry,
    deployedContracts.IdentityRegistry,
    deployedContracts.TrustedIssuersRegistry,
    deployer.address,
    deployedContracts.YieldVault
  );
  await tokenFactory.waitForDeployment();
  deployedContracts.TokenFactory = await tokenFactory.getAddress();
  console.log("   ✅ TokenFactory:", deployedContracts.TokenFactory);

  // PrimaryMarket
  const PrimaryMarket = await ethers.getContractFactory("PrimaryMarket");
  const primaryMarket = await PrimaryMarket.deploy(
    deployedContracts.TokenFactory,
    deployer.address,
    deployedContracts.MockUSDC
  );
  await primaryMarket.waitForDeployment();
  deployedContracts.PrimaryMarket = await primaryMarket.getAddress();
  console.log("   ✅ PrimaryMarket:", deployedContracts.PrimaryMarket);

  // SecondaryMarket
  const SecondaryMarket = await ethers.getContractFactory("SecondaryMarket");
  const secondaryMarket = await SecondaryMarket.deploy(
    deployedContracts.MockUSDC,
    deployedContracts.IdentityRegistry
  );
  await secondaryMarket.waitForDeployment();
  deployedContracts.SecondaryMarket = await secondaryMarket.getAddress();
  console.log("   ✅ SecondaryMarket:", deployedContracts.SecondaryMarket);

  // Step 6: Deploy BNBLeverageVault
  console.log("\n6️⃣ Deploying BNBLeverageVault...");
  
  const BNBLeverageVault = await ethers.getContractFactory("BNBLeverageVault");
  const leverageVault = await BNBLeverageVault.deploy(
    deployedContracts.AnkrBNB,
    deployedContracts.MockUSDC,
    deployedContracts.SeniorPool,
    deployedContracts.BNBSwapIntegration
  );
  await leverageVault.waitForDeployment();
  deployedContracts.BNBLeverageVault = await leverageVault.getAddress();
  console.log("   ✅ BNBLeverageVault:", deployedContracts.BNBLeverageVault);

  // Step 7: Post-deployment configuration
  console.log("\n7️⃣ Configuring contracts...");
  
  // Set TokenFactory on YieldVault (required for YieldVault.registerAsset to work)
  await waitForTx(yieldVault.setFactory(deployedContracts.TokenFactory));
  console.log("   ✅ TokenFactory set as factory on YieldVault");

  // Set YieldVault on LeverageVault
  await waitForTx(leverageVault.setYieldVault(deployedContracts.YieldVault));
  console.log("   ✅ YieldVault address set on BNBLeverageVault");

  // Set PrimaryMarket on LeverageVault
  await waitForTx(leverageVault.setPrimaryMarket(deployedContracts.PrimaryMarket));
  console.log("   ✅ PrimaryMarket address set on BNBLeverageVault");

  // Authorize LeverageVault to borrow from SeniorPool
  await waitForTx(seniorPool.setLeverageVault(deployedContracts.BNBLeverageVault));
  console.log("   ✅ BNBLeverageVault authorized on SeniorPool");

  // Register platform custody (deployer) in IdentityRegistry
  // Required so ComplianceModule allows transfers FROM platformCustody in buyTokens
  const identityRegistryInstance = await ethers.getContractAt("IdentityRegistry", deployedContracts.IdentityRegistry);
  await waitForTx(identityRegistryInstance.registerIdentity(deployer.address));
  console.log("   ✅ Platform custody (deployer) registered in IdentityRegistry");

  // Mint test ankrBNB to deployer
  const testAnkrBNBAmount = ethers.parseEther("10000"); // 10K ankrBNB
  await waitForTx(ankrBNB.mint(deployer.address, testAnkrBNBAmount));
  console.log("   ✅ Minted 10K ankrBNB to deployer for testing");

  // Step 8: Save deployment manifest
  console.log("\n8️⃣ Saving deployment manifest...");
  
  const fs = require("fs");
  const manifest = {
    network: deployMeta.network,
    chainId: chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts
  };

  fs.writeFileSync(
    `./${deployMeta.filename}`,
    JSON.stringify(manifest, null, 2)
  );
  console.log(`   ✅ Manifest saved to ${deployMeta.filename}`);

  // Summary
  console.log("\n✅ Deployment complete!");
  console.log("\n📋 Contract Summary:");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  Object.entries(deployedContracts).forEach(([name, address]) => {
    console.log(`${name.padEnd(30)} ${address}`);
  });
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
