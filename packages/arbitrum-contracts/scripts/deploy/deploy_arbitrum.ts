import { ethers } from "hardhat";

/**
 * Deploy Arbitrum Leverage Stack
 * 
 * This script deploys the full stARB-based leverage system for Arbitrum:
 * - MockStARB (collateral token)
 * - MockUSDC (loan token)
 * - SeniorPool (USDC lending pool)
 * - MockArbitrumDEX (stARB/USDC swap)
 * - ArbitrumSwapIntegration (slippage-protected swaps)
 * - StARBLeverageVault (core vault)
 * - Platform infrastructure contracts
 */

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("📦 Deploying Arbitrum Leverage Stack");
  console.log("🔑 Deployer:", deployer.address);
  console.log("💰 Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const deployedContracts: Record<string, string> = {};

  // Step 1: Deploy base tokens
  console.log("1️⃣ Deploying base tokens...");
  
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  deployedContracts.MockUSDC = await usdc.getAddress();
  console.log("   ✅ MockUSDC:", deployedContracts.MockUSDC);

  const MockStARB = await ethers.getContractFactory("MockStARB");
  const stARB = await MockStARB.deploy();
  await stARB.waitForDeployment();
  deployedContracts.MockStARB = await stARB.getAddress();
  console.log("   ✅ MockStARB:", deployedContracts.MockStARB);

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
  await usdc.mint(deployer.address, fundAmount);
  await usdc.approve(deployedContracts.SeniorPool, fundAmount);
  await seniorPool.depositLiquidity(fundAmount);
  console.log("   ✅ SeniorPool funded");

  // Step 3: Deploy DEX infrastructure
  console.log("\n3️⃣ Deploying DEX infrastructure...");
  
  const initialExchangeRate = ethers.parseUnits("0.8", 6); // 1 stARB = 0.8 USDC
  const MockArbitrumDEX = await ethers.getContractFactory("MockArbitrumDEX");
  const dex = await MockArbitrumDEX.deploy(
    deployedContracts.MockStARB,
    deployedContracts.MockUSDC,
    initialExchangeRate
  );
  await dex.waitForDeployment();
  deployedContracts.MockArbitrumDEX = await dex.getAddress();
  console.log("   ✅ MockArbitrumDEX:", deployedContracts.MockArbitrumDEX);

  // Fund DEX with USDC liquidity
  console.log("   💵 Funding DEX with 500K USDC liquidity...");
  const dexFundAmount = ethers.parseUnits("500000", 6);
  await usdc.mint(deployer.address, dexFundAmount);
  await usdc.approve(deployedContracts.MockArbitrumDEX, dexFundAmount);
  await dex.addLiquidity(0, dexFundAmount);
  console.log("   ✅ DEX funded");

  // Step 4: Deploy ArbitrumSwapIntegration
  console.log("\n4️⃣ Deploying ArbitrumSwapIntegration...");
  
  const placeholderOracle = deployedContracts.MockStARB; // Using stARB as placeholder oracle
  const ArbitrumSwapIntegration = await ethers.getContractFactory("ArbitrumSwapIntegration");
  const swapIntegration = await ArbitrumSwapIntegration.deploy(
    deployedContracts.MockStARB,
    deployedContracts.MockUSDC,
    deployedContracts.MockArbitrumDEX,
    placeholderOracle
  );
  await swapIntegration.waitForDeployment();
  deployedContracts.ArbitrumSwapIntegration = await swapIntegration.getAddress();
  console.log("   ✅ ArbitrumSwapIntegration:", deployedContracts.ArbitrumSwapIntegration);

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

  // Step 6: Deploy StARBLeverageVault
  console.log("\n6️⃣ Deploying StARBLeverageVault...");
  
  const StARBLeverageVault = await ethers.getContractFactory("StARBLeverageVault");
  const leverageVault = await StARBLeverageVault.deploy(
    deployedContracts.MockStARB,
    deployedContracts.MockUSDC,
    deployedContracts.SeniorPool,
    deployedContracts.ArbitrumSwapIntegration
  );
  await leverageVault.waitForDeployment();
  deployedContracts.StARBLeverageVault = await leverageVault.getAddress();
  console.log("   ✅ StARBLeverageVault:", deployedContracts.StARBLeverageVault);

  // Step 7: Post-deployment configuration
  console.log("\n7️⃣ Configuring contracts...");
  
  // Set TokenFactory on YieldVault (required for YieldVault.registerAsset to work)
  await yieldVault.setFactory(deployedContracts.TokenFactory);
  console.log("   ✅ TokenFactory set as factory on YieldVault");

  // Set YieldVault on LeverageVault
  await leverageVault.setYieldVault(deployedContracts.YieldVault);
  console.log("   ✅ YieldVault address set on StARBLeverageVault");

  // Set PrimaryMarket on LeverageVault
  await leverageVault.setPrimaryMarket(deployedContracts.PrimaryMarket);
  console.log("   ✅ PrimaryMarket address set on StARBLeverageVault");

  // Authorize LeverageVault to borrow from SeniorPool
  await seniorPool.setLeverageVault(deployedContracts.StARBLeverageVault);
  console.log("   ✅ StARBLeverageVault authorized on SeniorPool");

  // Register platform custody (deployer) in IdentityRegistry
  // Required so ComplianceModule allows transfers FROM platformCustody in buyTokens
  const identityRegistryInstance = await ethers.getContractAt("IdentityRegistry", deployedContracts.IdentityRegistry);
  await identityRegistryInstance.registerIdentity(deployer.address);
  console.log("   ✅ Platform custody (deployer) registered in IdentityRegistry");

  // Mint test stARB to deployer
  const testStARBAmount = ethers.parseEther("10000"); // 10K stARB
  await stARB.mint(deployer.address, testStARBAmount);
  console.log("   ✅ Minted 10K stARB to deployer for testing");

  // Step 8: Save deployment manifest
  console.log("\n8️⃣ Saving deployment manifest...");
  
  const fs = require("fs");
  const manifest = {
    network: "arbitrum",
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts
  };

  fs.writeFileSync(
    "./deployed_contracts_arbitrum.json",
    JSON.stringify(manifest, null, 2)
  );
  console.log("   ✅ Manifest saved to deployed_contracts_arbitrum.json");

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
