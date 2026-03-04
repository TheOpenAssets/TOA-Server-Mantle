import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * Deploy Credit Coin Leverage Stack
 * 
 * This script deploys the full CTC-based leverage system for Credit Coin:
 * - MockCTC (collateral token)
 * - MockUSDC (loan token)
 * - SeniorPool (USDC lending pool)
 * - MockCTCDEX (CTC/USDC swap)
 * - CTCDEXIntegration (slippage-protected swaps)
 * - CTCLeverageVault (core vault)
 * - Platform infrastructure contracts
 */

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying Credit Coin Leverage Stack");
  console.log("Deployer:", deployer.address);
  // console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "CTC");

  const deployedContracts: Record<string, string> = {};

  // Step 1: Deploy base tokens
  console.log("[1] Deploying base tokens...");
  
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  deployedContracts.MockUSDC = await usdc.getAddress();
  console.log("   [OK] MockUSDC:", deployedContracts.MockUSDC);

  const MockCTC = await ethers.getContractFactory("MockCTC");
  const ctc = await MockCTC.deploy();
  await ctc.waitForDeployment();
  deployedContracts.MockCTC = await ctc.getAddress();
  console.log("   [OK] MockCTC:", deployedContracts.MockCTC);

  // Step 2: Deploy SeniorPool
  console.log("\n[2] Deploying SeniorPool...");
  
  const SeniorPool = await ethers.getContractFactory("SeniorPool");
  const seniorPool = await SeniorPool.deploy(deployedContracts.MockUSDC);
  await seniorPool.waitForDeployment();
  deployedContracts.SeniorPool = await seniorPool.getAddress();
  console.log("   [OK] SeniorPool:", deployedContracts.SeniorPool);

  // Fund SeniorPool with USDC
  console.log("   [FUND] Funding SeniorPool with 1M USDC...");
  const fundAmount = ethers.parseUnits("1000000", 6); // 1M USDC
  const mintTx = await usdc.mint(deployer.address, fundAmount);
  await mintTx.wait();
  const approveTx = await usdc.approve(deployedContracts.SeniorPool, fundAmount);
  await approveTx.wait();
  const depositTx = await seniorPool.depositLiquidity(fundAmount);
  await depositTx.wait();
  console.log("   [OK] SeniorPool funded");

  // Step 3: Deploy DEX infrastructure
  console.log("\n[3] Deploying DEX infrastructure...");
  
  const initialExchangeRate = ethers.parseUnits("0.5", 6); // 1 CTC = 0.5 USDC (placeholder)
  const MockCTCDEX = await ethers.getContractFactory("MockCTCDEX");
  const dex = await MockCTCDEX.deploy(
    deployedContracts.MockCTC,
    deployedContracts.MockUSDC,
    initialExchangeRate
  );
  await dex.waitForDeployment();
  deployedContracts.MockCTCDEX = await dex.getAddress();
  console.log("   [OK] MockCTCDEX:", deployedContracts.MockCTCDEX);

  // Fund DEX with USDC liquidity
  console.log("   [FUND] Funding DEX with 500K USDC liquidity...");
  const dexFundAmount = ethers.parseUnits("500000", 6);
  const mintDexTx = await usdc.mint(deployer.address, dexFundAmount);
  await mintDexTx.wait();
  const approveDexTx = await usdc.approve(deployedContracts.MockCTCDEX, dexFundAmount);
  await approveDexTx.wait();
  const addLiqTx = await dex.addLiquidity(0, dexFundAmount);
  await addLiqTx.wait();
  console.log("   [OK] DEX funded");

  // Step 4: Deploy CTCDEXIntegration
  console.log("\n[4] Deploying CTCDEXIntegration...");
  
  const CTCDEXIntegration = await ethers.getContractFactory("CTCDEXIntegration");
  const swapIntegration = await CTCDEXIntegration.deploy(
    deployedContracts.MockCTC,
    deployedContracts.MockUSDC,
    deployedContracts.MockCTCDEX
  );
  await swapIntegration.waitForDeployment();
  deployedContracts.CTCDEXIntegration = await swapIntegration.getAddress();
  console.log("   [OK] CTCDEXIntegration:", deployedContracts.CTCDEXIntegration);

  // Step 5: Deploy platform infrastructure
  console.log("\n[5] Deploying platform infrastructure...");
  
  const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
  const attestationRegistry = await AttestationRegistry.deploy();
  await attestationRegistry.waitForDeployment();
  deployedContracts.AttestationRegistry = await attestationRegistry.getAddress();
  console.log("   [OK] AttestationRegistry:", deployedContracts.AttestationRegistry);

  const TrustedIssuersRegistry = await ethers.getContractFactory("TrustedIssuersRegistry");
  const trustedIssuersRegistry = await TrustedIssuersRegistry.deploy();
  await trustedIssuersRegistry.waitForDeployment();
  deployedContracts.TrustedIssuersRegistry = await trustedIssuersRegistry.getAddress();
  console.log("   [OK] TrustedIssuersRegistry:", deployedContracts.TrustedIssuersRegistry);

  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(deployedContracts.TrustedIssuersRegistry);
  await identityRegistry.waitForDeployment();
  deployedContracts.IdentityRegistry = await identityRegistry.getAddress();
  console.log("   [OK] IdentityRegistry:", deployedContracts.IdentityRegistry);

  const YieldVault = await ethers.getContractFactory("YieldVault");
  const yieldVault = await YieldVault.deploy(deployedContracts.MockUSDC, deployer.address);
  await yieldVault.waitForDeployment();
  deployedContracts.YieldVault = await yieldVault.getAddress();
  console.log("   [OK] YieldVault:", deployedContracts.YieldVault);

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
  console.log("   [OK] TokenFactory:", deployedContracts.TokenFactory);

  const PrimaryMarket = await ethers.getContractFactory("PrimaryMarket");
  const primaryMarket = await PrimaryMarket.deploy(
    deployedContracts.TokenFactory,
    deployer.address,
    deployedContracts.MockUSDC
  );
  await primaryMarket.waitForDeployment();
  deployedContracts.PrimaryMarket = await primaryMarket.getAddress();
  console.log("   [OK] PrimaryMarket:", deployedContracts.PrimaryMarket);

  const SecondaryMarket = await ethers.getContractFactory("SecondaryMarket");
  const secondaryMarket = await SecondaryMarket.deploy(
    deployedContracts.MockUSDC,
    deployedContracts.IdentityRegistry
  );
  await secondaryMarket.waitForDeployment();
  deployedContracts.SecondaryMarket = await secondaryMarket.getAddress();
  console.log("   [OK] SecondaryMarket:", deployedContracts.SecondaryMarket);

  const OAID = await ethers.getContractFactory("OAID");
  const oaid = await OAID.deploy();
  await oaid.waitForDeployment();
  deployedContracts.OAID = await oaid.getAddress();
  console.log("   [OK] OAID:", deployedContracts.OAID);

  const SolvencyVault = await ethers.getContractFactory("SolvencyVault");
  const solvencyVault = await SolvencyVault.deploy(
    deployedContracts.MockUSDC,
    deployedContracts.SeniorPool
  );
  await solvencyVault.waitForDeployment();
  deployedContracts.SolvencyVault = await solvencyVault.getAddress();
  console.log("   [OK] SolvencyVault:", deployedContracts.SolvencyVault);

  // Step 6: Deploy CTCLeverageVault
  console.log("\n[6] Deploying CTCLeverageVault...");
  
  const CTCLeverageVault = await ethers.getContractFactory("CTCLeverageVault");
  const leverageVault = await CTCLeverageVault.deploy(
    deployedContracts.MockCTC,
    deployedContracts.MockUSDC,
    deployedContracts.SeniorPool,
    deployedContracts.CTCDEXIntegration
  );
  await leverageVault.waitForDeployment();
  deployedContracts.CTCLeverageVault = await leverageVault.getAddress();
  console.log("   [OK] CTCLeverageVault:", deployedContracts.CTCLeverageVault);

  // Step 7: Post-deployment configuration
  console.log("\n[7] Configuring contracts...");
  
  await yieldVault.setFactory(deployedContracts.TokenFactory);
  console.log("   [OK] TokenFactory set as factory on YieldVault");

  await leverageVault.setYieldVault(deployedContracts.YieldVault);
  console.log("   [OK] YieldVault address set on CTCLeverageVault");

  await leverageVault.setPrimaryMarket(deployedContracts.PrimaryMarket);
  console.log("   [OK] PrimaryMarket address set on CTCLeverageVault");

  await seniorPool.setLeverageVault(deployedContracts.CTCLeverageVault);
  console.log("   [OK] CTCLeverageVault authorized on SeniorPool");

  await seniorPool.setSolvencyVault(deployedContracts.SolvencyVault);
  console.log("   [OK] SolvencyVault authorized on SeniorPool");

  await solvencyVault.setPrimaryMarket(deployedContracts.PrimaryMarket);
  console.log("   [OK] PrimaryMarket set on SolvencyVault");

  await oaid.setSolvencyVault(deployedContracts.SolvencyVault);
  console.log("   [OK] SolvencyVault set on OAID");

  // Step 8: Save deployment manifest
  console.log("\n[8] Saving deployment manifest...");
  
  const manifest = {
    network: "creditcoin",
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: deployedContracts
  };

  fs.writeFileSync(
    "./deployed_contracts_creditcoin.json",
    JSON.stringify(manifest, null, 2)
  );
  console.log("   [OK] Manifest saved to deployed_contracts_creditcoin.json");

  // Step 9: Update addresses.ts file
  console.log("\n[9] Updating addresses.ts file...");

  const addressesPath = "./src/addresses.ts";
  let addressesContent = fs.readFileSync(addressesPath, "utf8");

  // Update each contract address in the CreditCoinContracts object
  for (const [contractName, address] of Object.entries(deployedContracts)) {
    // Create regex to match the specific contract line
    const regex = new RegExp(`(${contractName}:\\s*)'0x[0-9a-fA-F]{40}'`, 'g');
    addressesContent = addressesContent.replace(regex, `$1'${address}'`);
  }

  fs.writeFileSync(addressesPath, addressesContent);
  console.log("   [OK] addresses.ts updated with deployed contract addresses");

  // Summary
  console.log("\n[SUCCESS] Deployment complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
