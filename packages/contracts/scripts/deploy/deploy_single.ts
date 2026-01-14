/**
 * Stack-Oriented Deployment Orchestrator
 * =====================================
 *
 * This script deploys and wires OpenAssets by economic stack instead of
 * unsafe per-contract deployment.
 *
 * Each stack is an atomic unit. Redeploying any contract inside a stack
 * automatically redeploys and re-links all its dependency closure.
 *
 * Supported Stacks:
 *
 * 1) STACK=identity
 *    - AttestationRegistry
 *    - TrustedIssuersRegistry
 *    - IdentityRegistry
 *
 * 2) STACK=issuance
 *    - YieldVault
 *    - TokenFactory
 *    - PrimaryMarket
 *
 * 3) STACK=credit
 *    - SeniorPool
 *    - SolvencyVault
 *    - OAID
 *
 * 4) STACK=leverage
 *    - FluxionIntegration
 *    - LeverageVault
 *
 * 5) STACK=mocks
 *    - MockUSDC
 *    - MockMETH
 *    - MockFluxionDEX
 *
 * Usage:
 * ------
 * STACK=<stackName> npx hardhat run scripts/deploy/deploy_stack.ts --network <network>
 *
 * Examples:
 * ---------
 * STACK=identity  npx hardhat run scripts/deploy/deploy_stack.ts --network mantleSepolia
 * STACK=credit    npx hardhat run scripts/deploy/deploy_stack.ts --network mantleSepolia
 * STACK=leverage  npx hardhat run scripts/deploy/deploy_stack.ts --network mantleSepolia
 *
 * Safety:
 * -------
 * - Single-contract deployment is intentionally disabled.
 * - All dependency graphs are enforced.
 * - SeniorPool, SolvencyVault, OAID are always redeployed together.
 * - LeverageVault is always redeployed with FluxionIntegration.
 */

import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

const STACK = process.env.STACK;

if (!STACK) {
  throw new Error("STACK is required. Example: STACK=credit");
}

const deployPath = path.join(__dirname, "../../deployed_contracts.json");

function load() {
  return fs.existsSync(deployPath)
    ? JSON.parse(fs.readFileSync(deployPath, "utf8"))
    : { contracts: {} };
}

function save(state: any) {
  fs.writeFileSync(deployPath, JSON.stringify(state, null, 2));
}

function wipe(state: any, keys: string[]) {
  for (const k of keys) delete state.contracts[k];
}

async function main() {
  console.log("\n═══════════════════════════════════════════════");
  console.log(`🚀 STACK DEPLOYMENT: ${STACK?.toUpperCase()}`);
  console.log(`🌐 Network: ${network.name}`);
  console.log("═══════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}\n`);

  const state = load();

  // ------------------------------------------------------------------
  // IDENTITY STACK
  // ------------------------------------------------------------------
  if (STACK === "identity") {
    console.log("[IDENTITY STACK] Redeploying compliance layer");

    wipe(state, ["AttestationRegistry", "TrustedIssuersRegistry", "IdentityRegistry"]);

    const Att = await (await ethers.getContractFactory("AttestationRegistry")).deploy();
    await Att.waitForDeployment();
    state.contracts.AttestationRegistry = Att.target;
    console.log("AttestationRegistry:", Att.target);

    const Trust = await (await ethers.getContractFactory("TrustedIssuersRegistry")).deploy();
    await Trust.waitForDeployment();
    state.contracts.TrustedIssuersRegistry = Trust.target;
    console.log("TrustedIssuersRegistry:", Trust.target);

    const ID = await (await ethers.getContractFactory("IdentityRegistry")).deploy(Trust.target);
    await ID.waitForDeployment();
    state.contracts.IdentityRegistry = ID.target;
    console.log("IdentityRegistry:", ID.target);
  }

  // ------------------------------------------------------------------
  // ISSUANCE STACK
  // ------------------------------------------------------------------
  if (STACK === "issuance") {
    console.log("[ISSUANCE STACK] Redeploying Yield + Factory + PrimaryMarket");

    wipe(state, ["YieldVault", "TokenFactory", "PrimaryMarketplace"]);

    const usdc = state.contracts.USDC;
    const identity = state.contracts.IdentityRegistry;
    const att = state.contracts.AttestationRegistry;
    const trusted = state.contracts.TrustedIssuersRegistry;

    const Yield = await (await ethers.getContractFactory("YieldVault")).deploy(usdc, deployer.address);
    await Yield.waitForDeployment();
    state.contracts.YieldVault = Yield.target;
    console.log("YieldVault:", Yield.target);

    const Factory = await (await ethers.getContractFactory("TokenFactory")).deploy(
      att, identity, trusted, deployer.address, Yield.target
    );
    await Factory.waitForDeployment();
    state.contracts.TokenFactory = Factory.target;
    console.log("TokenFactory:", Factory.target);

    await Yield.setFactory(Factory.target);
    console.log("YieldVault.setFactory -> OK");

    const PM = await (await ethers.getContractFactory("PrimaryMarket")).deploy(
      Factory.target, deployer.address, usdc
    );
    await PM.waitForDeployment();
    state.contracts.PrimaryMarketplace = PM.target;
    console.log("PrimaryMarket:", PM.target);
  }

  // ------------------------------------------------------------------
  // CREDIT STACK (ATOMIC)
  // ------------------------------------------------------------------
  if (STACK === "credit") {
    console.log("[CREDIT STACK] Redeploying SeniorPool + SolvencyVault + OAID (atomic)");

    wipe(state, ["SeniorPool", "SolvencyVault", "OAID"]);

    const usdc = state.contracts.USDC;

    const Pool = await (await ethers.getContractFactory("SeniorPool")).deploy(usdc);
    await Pool.waitForDeployment();
    state.contracts.SeniorPool = Pool.target;
    console.log("SeniorPool:", Pool.target);

    const Solvency = await (await ethers.getContractFactory("SolvencyVault")).deploy(usdc, Pool.target);
    await Solvency.waitForDeployment();
    state.contracts.SolvencyVault = Solvency.target;
    console.log("SolvencyVault:", Solvency.target);

    const OAID = await (await ethers.getContractFactory("OAID")).deploy();
    await OAID.waitForDeployment();
    state.contracts.OAID = OAID.target;
    console.log("OAID:", OAID.target);

    await Pool.setSolvencyVault(Solvency.target);
    await Solvency.setOAID(OAID.target);
    await OAID.setSolvencyVault(Solvency.target);

    console.log("SeniorPool ↔ SolvencyVault ↔ OAID fully linked");

    const usdcToken = await ethers.getContractAt("MockUSDC", usdc);
    const amt = ethers.parseUnits("500000", 6);
    await usdcToken.mint(deployer.address, amt);
    await usdcToken.approve(Pool.target, amt);
    await Pool.depositLiquidity(amt);

    console.log("SeniorPool seeded with 500,000 USDC");
  }

  // ------------------------------------------------------------------
  // LEVERAGE STACK
  // ------------------------------------------------------------------
  if (STACK === "leverage") {
    console.log("[LEVERAGE STACK] Redeploying FluxionIntegration + LeverageVault");

    wipe(state, ["FluxionIntegration", "LeverageVault"]);

    const usdc = state.contracts.USDC;
    const meth = state.contracts.MockMETH;
    const dex = state.contracts.MockFluxionDEX;
    const pool = state.contracts.SeniorPool;
    const yieldVault = state.contracts.YieldVault;
    const market = state.contracts.PrimaryMarketplace;
    const identity = state.contracts.IdentityRegistry;

    const Flux = await (await ethers.getContractFactory("FluxionIntegration")).deploy(
      meth, usdc, dex, meth
    );
    await Flux.waitForDeployment();
    state.contracts.FluxionIntegration = Flux.target;
    console.log("FluxionIntegration:", Flux.target);

    const Lev = await (await ethers.getContractFactory("LeverageVault")).deploy(
      meth, usdc, pool, Flux.target
    );
    await Lev.waitForDeployment();
    state.contracts.LeverageVault = Lev.target;
    console.log("LeverageVault:", Lev.target);

    await Lev.setYieldVault(yieldVault);
    await Lev.setPrimaryMarket(market);

    const Pool = await ethers.getContractAt("SeniorPool", pool);
    await Pool.setLeverageVault(Lev.target);

    const ID = await ethers.getContractAt("IdentityRegistry", identity);
    await ID.registerIdentity(Lev.target);

    console.log("LeverageVault fully wired and registered");
  }

  // ------------------------------------------------------------------
  // MOCK STACK
  // ------------------------------------------------------------------
  if (STACK === "mocks") {
    console.log("[MOCK STACK] Redeploying MockUSDC, MockMETH, MockFluxionDEX");

    wipe(state, ["USDC", "MockMETH", "MockFluxionDEX"]);

    const USDC = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await USDC.waitForDeployment();
    state.contracts.USDC = USDC.target;
    console.log("MockUSDC:", USDC.target);

    const METH = await (await ethers.getContractFactory("contracts/test/MockMETH.sol:MockMETH")).deploy();
    await METH.waitForDeployment();
    state.contracts.MockMETH = METH.target;
    console.log("MockMETH:", METH.target);

    const DEX = await (await ethers.getContractFactory("MockFluxionDEX")).deploy(
      METH.target, USDC.target, ethers.parseUnits("3000", 6)
    );
    await DEX.waitForDeployment();
    state.contracts.MockFluxionDEX = DEX.target;
    console.log("MockFluxionDEX:", DEX.target);
  }

  state.network = network.name;
  state.timestamp = new Date().toISOString();
  save(state);

  console.log("\n═══════════════════════════════════════════════");
  console.log("🎯 STACK DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════");
  console.table(state.contracts);
}

main().catch(err => {
  console.error("\n❌ STACK DEPLOYMENT FAILED");
  console.error(err);
  process.exit(1);
});
