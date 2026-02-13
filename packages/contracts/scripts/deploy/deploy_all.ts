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

interface DeployedContracts {
  networks?: {
    [key: string]: {
      contracts: Record<string, string>;
      network: string;
      timestamp?: string;
    };
  };
  // Legacy format support
  contracts?: Record<string, string>;
  network?: string;
}

function getNetworkKey(networkName: string): string {
  const networkMap: Record<string, string> = {
    mantleSepolia: 'mantle-sepolia',
    mantleTestnet: 'mantle-testnet',
    mantle: 'mantle-mainnet',
  };
  return networkMap[networkName] || `mantle-${networkName}`;
}

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
  let deployed: DeployedContracts = fs.existsSync(deployPath)
    ? JSON.parse(fs.readFileSync(deployPath, "utf8"))
    : { networks: {} };

  // Migrate legacy format if needed
  if (deployed.contracts && !deployed.networks) {
    console.log("   🔄 Migrating legacy format to multi-chain structure...");
    const legacyNetwork = deployed.network || 'mantle-testnet';
    deployed.networks = {
      [legacyNetwork]: {
        contracts: deployed.contracts,
        network: legacyNetwork,
        timestamp: deployed.timestamp,
      },
    };
    delete deployed.contracts;
    delete deployed.network;
  }

  const networkKey = getNetworkKey(network.name);
  if (!deployed.networks) deployed.networks = {};
  if (!deployed.networks[networkKey]) {
    deployed.networks[networkKey] = {
      contracts: {},
      network: network.name,
    };
  }

  const save = () => fs.writeFileSync(deployPath, JSON.stringify(deployed, null, 2));
  const set = (k: string, v: string) => {
    deployed.networks![networkKey].contracts[k] = v;
    deployed.networks![networkKey].timestamp = new Date().toISOString();
    save();
    console.log(`   📌 ${k} = ${v}`);
  };

  const existingContracts = deployed.networks[networkKey].contracts;

  // ------------------------------------------------------------------
  console.log("\n[1] USDC SETUP");
  // ------------------------------------------------------------------
  if (!existingContracts.USDC) {
    console.log("   ➜ Deploying MockUSDC...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    set("USDC", await usdc.getAddress());
  } else {
    console.log(`   ✔ Using existing USDC: ${existingContracts.USDC}`);
  }

  const USDC = existingContracts.USDC;

  // ------------------------------------------------------------------
  console.log("\n[2] COMPLIANCE REGISTRIES");
  // ------------------------------------------------------------------
  if (!existingContracts.AttestationRegistry) {
    console.log("   ➜ Deploying AttestationRegistry...");
    const x = await (await ethers.getContractFactory("AttestationRegistry")).deploy();
    await x.waitForDeployment();
    set("AttestationRegistry", await x.getAddress());
  }

  if (!existingContracts.TrustedIssuersRegistry) {
    console.log("   ➜ Deploying TrustedIssuersRegistry...");
    const x = await (await ethers.getContractFactory("TrustedIssuersRegistry")).deploy();
    await x.waitForDeployment();
    set("TrustedIssuersRegistry", await x.getAddress());
  }

  if (!existingContracts.IdentityRegistry) {
    console.log("   ➜ Deploying IdentityRegistry...");
    const x = await (await ethers.getContractFactory("IdentityRegistry")).deploy(existingContracts.TrustedIssuersRegistry);
    await x.waitForDeployment();
    set("IdentityRegistry", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[3] YIELD VAULT");
  // ------------------------------------------------------------------
  if (!existingContracts.YieldVault) {
    console.log(`   ➜ Deploying YieldVault (USDC=${USDC})`);
    const x = await (await ethers.getContractFactory("YieldVault")).deploy(USDC, deployer.address);
    await x.waitForDeployment();
    set("YieldVault", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[4] TOKEN FACTORY");
  // ------------------------------------------------------------------
  if (!existingContracts.TokenFactory) {
    console.log("   ➜ Deploying TokenFactory with:");
    console.log("      AttestationRegistry:", existingContracts.AttestationRegistry);
    console.log("      IdentityRegistry:   ", existingContracts.IdentityRegistry);
    console.log("      TrustedIssuers:    ", existingContracts.TrustedIssuersRegistry);
    console.log("      YieldVault:        ", existingContracts.YieldVault);

    const x = await (await ethers.getContractFactory("TokenFactory")).deploy(
      existingContracts.AttestationRegistry,
      existingContracts.IdentityRegistry,
      existingContracts.TrustedIssuersRegistry,
      deployer.address,
      existingContracts.YieldVault
    );
    await x.waitForDeployment();
    set("TokenFactory", await x.getAddress());

    console.log("   🔗 Linking TokenFactory → YieldVault");
    const yieldVault = await ethers.getContractAt("YieldVault", existingContracts.YieldVault);
    await yieldVault.setFactory(x.target);
    console.log("   ✔ Factory linked");
  }

  // ------------------------------------------------------------------
  console.log("\n[5] PRIMARY MARKET");
  // ------------------------------------------------------------------
  if (!existingContracts.PrimaryMarketplace) {
    console.log("   ➜ Deploying PrimaryMarket...");
    const x = await (await ethers.getContractFactory("PrimaryMarket")).deploy(
      existingContracts.TokenFactory,
      deployer.address,
      USDC
    );
    await x.waitForDeployment();
    set("PrimaryMarketplace", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[6] SENIOR POOL + LIQUIDITY");
  // ------------------------------------------------------------------
  if (!existingContracts.SeniorPool) {
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
  if (!existingContracts.MockMETH) {
    console.log("   ➜ Deploying MockMETH...");
    const x = await (await ethers.getContractFactory("contracts/test/MockMETH.sol:MockMETH")).deploy();
    await x.waitForDeployment();
    set("MockMETH", await x.getAddress());
  }

  if (!existingContracts.MockFluxionDEX) {
    console.log("   ➜ Deploying MockFluxionDEX (3000 USDC/mETH)...");
    const x = await (await ethers.getContractFactory("MockFluxionDEX")).deploy(
      existingContracts.MockMETH, USDC, ethers.parseUnits("3000", 6)
    );
    await x.waitForDeployment();
    set("MockFluxionDEX", await x.getAddress());
  }

  if (!existingContracts.FluxionIntegration) {
    console.log("   ➜ Deploying FluxionIntegration...");
    const x = await (await ethers.getContractFactory("FluxionIntegration")).deploy(
      existingContracts.MockMETH,
      USDC,
      existingContracts.MockFluxionDEX,
      existingContracts.MockMETH
    );
    await x.waitForDeployment();
    set("FluxionIntegration", await x.getAddress());
  }

  // ------------------------------------------------------------------
  console.log("\n[8] LEVERAGE VAULT");
  // ------------------------------------------------------------------
  if (!existingContracts.LeverageVault) {
    console.log("   ➜ Deploying LeverageVault...");
    const x = await (await ethers.getContractFactory("LeverageVault")).deploy(
      existingContracts.MockMETH,
      USDC,
      existingContracts.SeniorPool,
      existingContracts.FluxionIntegration
    );
    await x.waitForDeployment();
    set("LeverageVault", await x.getAddress());

    console.log("   🔗 Linking LeverageVault → YieldVault");
    await x.setYieldVault(existingContracts.YieldVault);

    console.log("   🔗 Linking LeverageVault → PrimaryMarket");
    await x.setPrimaryMarket(existingContracts.PrimaryMarketplace);

    console.log("   🔗 Authorizing in SeniorPool");
    const seniorPool = await ethers.getContractAt("SeniorPool", existingContracts.SeniorPool);
    if (await seniorPool.leverageVault() === ethers.ZeroAddress) {
      await seniorPool.setLeverageVault(x.target);
      console.log("   ✔ SeniorPool linked to LeverageVault");
    }
  }

  // ------------------------------------------------------------------
  console.log("\n[9] SOLVENCY VAULT");
  // ------------------------------------------------------------------
  if (!existingContracts.SolvencyVault) {
    console.log("   ➜ Deploying SolvencyVault...");
    const x = await (await ethers.getContractFactory("SolvencyVault")).deploy(
      USDC, existingContracts.SeniorPool
    );
    await x.waitForDeployment();
    set("SolvencyVault", await x.getAddress());

    const seniorPool = await ethers.getContractAt("SeniorPool", existingContracts.SeniorPool);
    if (await seniorPool.solvencyVault() === ethers.ZeroAddress) {
      await seniorPool.setSolvencyVault(x.target);
      console.log("   ✔ SeniorPool linked to SolvencyVault");
    }

    console.log("   🔗 Linking SolvencyVault → YieldVault");
    await x.setYieldVault(existingContracts.YieldVault);

    console.log("   🔗 Linking SolvencyVault → PrimaryMarket");
    await x.setPrimaryMarket(existingContracts.PrimaryMarketplace);
  }

  // ------------------------------------------------------------------
  console.log("\n[10] OAID CREDIT IDENTITY");
  // ------------------------------------------------------------------
  if (!existingContracts.OAID) {
    console.log("   ➜ Deploying OAID...");
    const x = await (await ethers.getContractFactory("OAID")).deploy();
    await x.waitForDeployment();
    set("OAID", await x.getAddress());

    const solvencyVault = await ethers.getContractAt("SolvencyVault", existingContracts.SolvencyVault);
    console.log("   🔗 Mutual authorization: OAID ↔ SolvencyVault");
    await solvencyVault.setOAID(x.target);
    await x.setSolvencyVault(existingContracts.SolvencyVault);
  }

  // ------------------------------------------------------------------
  console.log("\n[11] IDENTITY REGISTRATION");
  // ------------------------------------------------------------------
  const id = await ethers.getContractAt("IdentityRegistry", existingContracts.IdentityRegistry);
  const toRegister = [
    existingContracts.TokenFactory,
    existingContracts.PrimaryMarketplace,
    existingContracts.LeverageVault,
    existingContracts.SolvencyVault
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

  save();

  console.log("\n═══════════════════════════════════════════════");
  console.log("🎯 SYSTEM BOOTSTRAP COMPLETE");
  console.log("═══════════════════════════════════════════════");
  console.table(deployed.networks![networkKey].contracts);
}

main().catch(e => {
  console.error("\n❌ DEPLOYMENT FAILED");
  console.error(e);
  process.exit(1);
});
