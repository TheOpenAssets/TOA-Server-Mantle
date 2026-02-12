/**
 * Full System Deployment Orchestrator
 * ----------------------------------
 *
 * This script deploys and fully wires the complete OpenAssets protocol stack:
 *
 * - Compliance Layer
 *   AttestationRegistry
 *   TrustedIssuersRegistry
 *   IdentityRegistry (auto-registers system contracts)
 *
 * - Asset & Yield Layer
 *   YieldVault
 *   TokenFactory (linked into YieldVault)
 *
 * - Markets
 *   PrimaryMarket (linked into LeverageVault & SolvencyVault)
 *
 * - Liquidity & Credit
 *   SeniorPool (auto-funded with MockUSDC)
 *   SolvencyVault (linked to SeniorPool, YieldVault, PrimaryMarket, OAID)
 *   OAID (mutually authorized with SolvencyVault)
 *
 * - Leverage System
 *   MockMETH
 *   MockFluxionDEX (auto-funded)
 *   FluxionIntegration
 *   LeverageVault (linked to YieldVault, PrimaryMarket, SeniorPool, IdentityRegistry)
 *
 * All post-deployment actions are executed automatically:
 * - Vault linking
 * - Factory linking
 * - Market linking
 * - Credit authorization
 * - Liquidity seeding
 * - Compliance registration
 *
 * The script is idempotent: it can be re-run safely and will reuse
 * existing deployments from deployed_contracts.json.
 *
 * Usage:
 * ------
 * npx hardhat run scripts/deploy/deploy_all.ts --network <network>
 *
 * Example:
 * --------
 * npx hardhat run scripts/deploy/deploy_all.ts --network mantleSepolia
 *
 * Requirements:
 * -------------
 * - Hardhat environment configured
 * - PRIVATE_KEY in .env
 * - deployed_contracts.json will be created/updated automatically
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  console.log("\n═══════════════════════════════════════════════");
  console.log(`🚀 OpenAssets Full Stack Deployment`);
  console.log(`🌐 Network: ${network.name}`);
  console.log("═══════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("Deployer not found. Check your hardhat configuration and environment variables.");
  }
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`💰 Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  const deployPath = path.join(__dirname, "../../deployed_contracts.json");
  let deployed: any = fs.existsSync(deployPath)
    ? JSON.parse(fs.readFileSync(deployPath, "utf8"))
    : { contracts: {} };

  const save = () => fs.writeFileSync(deployPath, JSON.stringify(deployed, null, 2));
  const set = (k: string, v: string) => {
    deployed.contracts[k] = v;
    save();
    console.log(`   📌 ${k} = ${v}`);
  };

  // ------------------------------------------------------------------
  console.log("\n[1] USDC SETUP");
  // ------------------------------------------------------------------
  if (!deployed.contracts.USDC) {
    console.log("   ➜ Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    set("USDC", await usdc.getAddress());
  } else {
    console.log(`   ✔ Using existing USDC: ${deployed.contracts.USDC}`);
  }

  const USDC = deployed.contracts.USDC;

  // ------------------------------------------------------------------
  console.log("\n[2] COMPLIANCE REGISTRIES");
  // ------------------------------------------------------------------
  if (!deployed.contracts.AttestationRegistry) {
    console.log("   ➜ Deploying AttestationRegistry...");
    const x = await (await ethers.getContractFactory("AttestationRegistry")).deploy();
    await x.waitForDeployment();
    set("AttestationRegistry", await x.getAddress());
  }

  if (!deployed.contracts.TrustedIssuersRegistry) {
    console.log("   ➜ Deploying TrustedIssuersRegistry...");
    const x = await (await ethers.getContractFactory("TrustedIssuersRegistry")).deploy();
    await x.waitForDeployment();
    set("TrustedIssuersRegistry", await x.getAddress());
  }

  if (!deployed.contracts.IdentityRegistry) {
    console.log("   ➜ Deploying IdentityRegistry...");
    const x = await (await ethers.getContractFactory("IdentityRegistry")).deploy(deployed.contracts.TrustedIssuersRegistry);
    await x.waitForDeployment();
    set("IdentityRegistry", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[3] YIELD VAULT");
  // ------------------------------------------------------------------
  if (!deployed.contracts.YieldVault) {
    console.log(`   ➜ Deploying YieldVault (USDC=${USDC})`);
    const x = await (await ethers.getContractFactory("YieldVault")).deploy(USDC, deployer.address);
    await x.waitForDeployment();
    set("YieldVault", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[4] TOKEN FACTORY");
  // ------------------------------------------------------------------
  if (!deployed.contracts.TokenFactory) {
    console.log("   ➜ Deploying TokenFactory with:");
    console.log("      AttestationRegistry:", deployed.contracts.AttestationRegistry);
    console.log("      IdentityRegistry:   ", deployed.contracts.IdentityRegistry);
    console.log("      TrustedIssuers:    ", deployed.contracts.TrustedIssuersRegistry);
    console.log("      YieldVault:        ", deployed.contracts.YieldVault);

    const x = await (await ethers.getContractFactory("TokenFactory")).deploy(
      deployed.contracts.AttestationRegistry,
      deployed.contracts.IdentityRegistry,
      deployed.contracts.TrustedIssuersRegistry,
      deployer.address,
      deployed.contracts.YieldVault
    );
    await x.waitForDeployment();
    set("TokenFactory", await x.getAddress());

    console.log("   🔗 Linking TokenFactory → YieldVault");
    const yieldVault = await ethers.getContractAt("YieldVault", deployed.contracts.YieldVault);
    await yieldVault.setFactory(x.target);
    console.log("   ✔ Factory linked");
  }

  // ------------------------------------------------------------------
  console.log("\n[5] PRIMARY MARKET");
  // ------------------------------------------------------------------
  if (!deployed.contracts.PrimaryMarketplace) {
    console.log("   ➜ Deploying PrimaryMarket...");
    const x = await (await ethers.getContractFactory("PrimaryMarket")).deploy(
      deployed.contracts.TokenFactory,
      deployer.address,
      USDC
    );
    await x.waitForDeployment();
    set("PrimaryMarketplace", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[6] SENIOR POOL + LIQUIDITY");
  // ------------------------------------------------------------------
  if (!deployed.contracts.SeniorPool) {
    console.log("   ➜ Deploying SeniorPool...");
    const x = await (await ethers.getContractFactory("SeniorPool")).deploy(USDC);
    await x.waitForDeployment();
    set("SeniorPool", await x.getAddress());

    console.log("   💰 Seeding SeniorPool with 500,000 USDC");
    const usdc = await ethers.getContractAt("MockUSDC", USDC);
    const amt = ethers.parseUnits("500000", 6);
    await usdc.mint(deployer.address, amt);
    await usdc.approve(x.target, amt);
    await x.depositLiquidity(amt);
    console.log("   ✔ Liquidity deposited");
  }

  // ------------------------------------------------------------------
  console.log("\n[7] LEVERAGE PRIMITIVES (mETH, DEX, Fluxion)");
  // ------------------------------------------------------------------
  if (!deployed.contracts.MockMETH) {
    console.log("   ➜ Deploying MockMETH...");
    const x = await (await ethers.getContractFactory("contracts/test/MockMETH.sol:MockMETH")).deploy();
    await x.waitForDeployment();
    set("MockMETH", await x.getAddress());
  }

  if (!deployed.contracts.MockFluxionDEX) {
    console.log("   ➜ Deploying MockFluxionDEX (3000 USDC/mETH)...");
    const x = await (await ethers.getContractFactory("MockFluxionDEX")).deploy(
      deployed.contracts.MockMETH, USDC, ethers.parseUnits("3000", 6)
    );
    await x.waitForDeployment();
    set("MockFluxionDEX", await x.getAddress());
  }

  if (!deployed.contracts.FluxionIntegration) {
    console.log("   ➜ Deploying FluxionIntegration...");
    const x = await (await ethers.getContractFactory("FluxionIntegration")).deploy(
      deployed.contracts.MockMETH,
      USDC,
      deployed.contracts.MockFluxionDEX,
      deployed.contracts.MockMETH
    );
    await x.waitForDeployment();
    set("FluxionIntegration", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[8] LEVERAGE VAULT");
  // ------------------------------------------------------------------
  if (!deployed.contracts.LeverageVault) {
    console.log("   ➜ Deploying LeverageVault...");
    const x = await (await ethers.getContractFactory("LeverageVault")).deploy(
      deployed.contracts.MockMETH,
      USDC,
      deployed.contracts.SeniorPool,
      deployed.contracts.FluxionIntegration
    );
    await x.waitForDeployment();
    set("LeverageVault", await x.getAddress());

    console.log("   🔗 Linking LeverageVault → YieldVault");
    await x.setYieldVault(deployed.contracts.YieldVault);

    console.log("   🔗 Linking LeverageVault → PrimaryMarket");
    await x.setPrimaryMarket(deployed.contracts.PrimaryMarketplace);

    console.log("   🔗 Authorizing in SeniorPool");
    const seniorPool = await ethers.getContractAt("SeniorPool", deployed.contracts.SeniorPool);
    if (await seniorPool.leverageVault() === ethers.ZeroAddress) {
      await seniorPool.setLeverageVault(x.target);
      console.log("   ✔ SeniorPool linked to LeverageVault");
    }
  }

  // ------------------------------------------------------------------
  console.log("\n[9] SOLVENCY VAULT");
  // ------------------------------------------------------------------
  if (!deployed.contracts.SolvencyVault) {
    console.log("   ➜ Deploying SolvencyVault...");
    const x = await (await ethers.getContractFactory("SolvencyVault")).deploy(
      USDC, deployed.contracts.SeniorPool
    );
    await x.waitForDeployment();
    set("SolvencyVault", await x.getAddress());

    const seniorPool = await ethers.getContractAt("SeniorPool", deployed.contracts.SeniorPool);
    if (await seniorPool.solvencyVault() === ethers.ZeroAddress) {
      await seniorPool.setSolvencyVault(x.target);
      console.log("   ✔ SeniorPool linked to SolvencyVault");
    }

    console.log("   🔗 Linking SolvencyVault → YieldVault");
    await x.setYieldVault(deployed.contracts.YieldVault);

    console.log("   🔗 Linking SolvencyVault → PrimaryMarket");
    await x.setPrimaryMarket(deployed.contracts.PrimaryMarketplace);
  }

  // ------------------------------------------------------------------
  console.log("\n[10] OAID CREDIT IDENTITY");
  // ------------------------------------------------------------------
  if (!deployed.contracts.OAID) {
    console.log("   ➜ Deploying OAID...");
    const x = await (await ethers.getContractFactory("OAID")).deploy();
    await x.waitForDeployment();
    set("OAID", await x.getAddress());

    const solvencyVault = await ethers.getContractAt("SolvencyVault", deployed.contracts.SolvencyVault);
    console.log("   🔗 Mutual authorization: OAID ↔ SolvencyVault");
    await solvencyVault.setOAID(x.target);
    await x.setSolvencyVault(deployed.contracts.SolvencyVault);
  }

  // ------------------------------------------------------------------
  console.log("\n[11] IDENTITY REGISTRATION");
  // ------------------------------------------------------------------
  const id = await ethers.getContractAt("IdentityRegistry", deployed.contracts.IdentityRegistry);
  const toRegister = [
    deployed.contracts.TokenFactory,
    deployed.contracts.PrimaryMarketplace,
    deployed.contracts.LeverageVault,
    deployed.contracts.SolvencyVault
  ];

  for (const addr of toRegister) {
    const ok = await id.isVerified(addr);
    if (!ok) {
      console.log(`   🔐 Registering ${addr}`);
      await id.registerIdentity(addr);
      console.log("   ✔ Registered");
    } else {
      console.log(`   ✔ Already verified: ${addr}`);
    }
  }

  deployed.network = network.name;
  deployed.timestamp = new Date().toISOString();
  save();

  console.log("\n═══════════════════════════════════════════════");
  console.log("🎯 SYSTEM BOOTSTRAP COMPLETE");
  console.log("═══════════════════════════════════════════════");
  console.table(deployed.contracts);
}

main().catch(e => {
  console.error("\n❌ DEPLOYMENT FAILED");
  console.error(e);
  process.exit(1);
});
