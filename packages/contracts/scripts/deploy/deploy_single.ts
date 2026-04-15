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
 * 6) STACK=issuervault
 *    - IssuerVault (only — YieldVault and PrimaryMarket are reused, not redeployed)
 *    Post-deploy wiring:
 *      - Revokes old IssuerVault in YieldVault and PrimaryMarket
 *      - Authorizes new IssuerVault in YieldVault and PrimaryMarket
 *      - Re-registers per-asset vault routing in PrimaryMarket
 *      - Re-registers existing assets inside the new IssuerVault
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

interface DeployedContracts {
  networks?: {
    [key: string]: {
      contracts: Record<string, string>;
      network: string;
      timestamp?: string;
    };
  };
  contracts?: Record<string, string>;
}

const STACK = process.env.STACK;

if (!STACK) {
  throw new Error("STACK is required. Example: STACK=credit");
}

const deployPath = path.join(__dirname, "../../deployed_contracts.json");

function getNetworkKey(networkName: string): string {
  const networkMap: Record<string, string> = {
    mantleSepolia: 'mantle-sepolia',
    mantleTestnet: 'mantle-testnet',
    mantle: 'mantle-mainnet',
  };
  return networkMap[networkName] || `mantle-${networkName}`;
}

function load(): DeployedContracts {
  if (!fs.existsSync(deployPath)) {
    return { networks: {} };
  }
  const data = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  
  // Migrate legacy format
  if (data.contracts && !data.networks) {
    const legacyNetwork = data.network || 'mantle-testnet';
    return {
      networks: {
        [legacyNetwork]: {
          contracts: data.contracts,
          network: legacyNetwork,
          timestamp: data.timestamp,
        },
      },
    };
  }
  
  return data;
}

function save(state: DeployedContracts) {
  fs.writeFileSync(deployPath, JSON.stringify(state, null, 2));
}

function wipe(state: DeployedContracts, networkKey: string, keys: string[]) {
  if (state.networks?.[networkKey]?.contracts) {
    for (const k of keys) {
      delete state.networks[networkKey].contracts[k];
    }
  }
}

async function main() {
  console.log("\n═══════════════════════════════════════════════");
  console.log(`🚀 STACK DEPLOYMENT: ${STACK?.toUpperCase()}`);
  console.log(`🌐 Network: ${network.name}`);
  console.log("═══════════════════════════════════════════════\n");

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}\n`);

  const state = load();
  const networkKey = getNetworkKey(network.name);
  
  if (!state.networks) state.networks = {};
  if (!state.networks[networkKey]) {
    state.networks[networkKey] = {
      contracts: {},
      network: network.name,
    };
  }
  
  const contracts = state.networks[networkKey].contracts;
  
  const set = (k: string, v: string) => {
    state.networks![networkKey].contracts[k] = v;
    state.networks![networkKey].timestamp = new Date().toISOString();
    save(state);
  };

  // ------------------------------------------------------------------
  // IDENTITY STACK
  // ------------------------------------------------------------------
  if (STACK === "identity") {
    console.log("[IDENTITY STACK] Redeploying compliance layer");

    wipe(state, networkKey, ["AttestationRegistry", "TrustedIssuersRegistry", "IdentityRegistry"]);

    const Att = await (await ethers.getContractFactory("AttestationRegistry")).deploy();
    await Att.waitForDeployment();
    set("AttestationRegistry", Att.target as string);
    console.log("AttestationRegistry:", Att.target);

    const Trust = await (await ethers.getContractFactory("TrustedIssuersRegistry")).deploy();
    await Trust.waitForDeployment();
    set("TrustedIssuersRegistry", Trust.target as string);
    console.log("TrustedIssuersRegistry:", Trust.target);

    const ID = await (await ethers.getContractFactory("IdentityRegistry")).deploy(Trust.target);
    await ID.waitForDeployment();
    set("IdentityRegistry", ID.target as string);
    console.log("IdentityRegistry:", ID.target);
  }

  // ------------------------------------------------------------------
  // ISSUANCE STACK
  // ------------------------------------------------------------------
  if (STACK === "issuance") {
    console.log("[ISSUANCE STACK] Redeploying Yield + Factory + PrimaryMarket");

    wipe(state, networkKey, ["YieldVault", "TokenFactory", "PrimaryMarketplace"]);

    const usdc = contracts.USDC;
    const identity = contracts.IdentityRegistry;
    const att = contracts.AttestationRegistry;
    const trusted = contracts.TrustedIssuersRegistry;

    if (!usdc) throw new Error("USDC not deployed");

    const Yield = await (await ethers.getContractFactory("YieldVault")).deploy(usdc, deployer.address);
    await Yield.waitForDeployment();
    set("YieldVault", Yield.target as string);
    console.log("YieldVault:", Yield.target);

    const Factory = await (await ethers.getContractFactory("TokenFactory")).deploy(
      att, identity, trusted, deployer.address, Yield.target
    );
    await Factory.waitForDeployment();
    set("TokenFactory", Factory.target as string);
    console.log("TokenFactory:", Factory.target);

    await (Yield as any).setFactory(Factory.target);
    console.log("YieldVault.setFactory -> OK");

    const PM = await (await ethers.getContractFactory("PrimaryMarket")).deploy(
      Factory.target, deployer.address, usdc
    );
    await PM.waitForDeployment();
    set("PrimaryMarketplace", PM.target as string);
    console.log("PrimaryMarketplace:", PM.target);
  }

  // ------------------------------------------------------------------
  // CREDIT STACK (ATOMIC)
  // ------------------------------------------------------------------
  if (STACK === "credit") {
    console.log("[CREDIT STACK] Redeploying SeniorPool + SolvencyVault + OAID (atomic)");

    wipe(state, networkKey, ["SeniorPool", "SolvencyVault", "OAID"]);

    const usdc = contracts.USDC;
    if (!usdc) throw new Error("USDC not deployed");

    const Pool = await (await ethers.getContractFactory("SeniorPool")).deploy(usdc);
    await Pool.waitForDeployment();
    set("SeniorPool", Pool.target as string);
    console.log("SeniorPool:", Pool.target);

    const Solvency = await (await ethers.getContractFactory("SolvencyVault")).deploy(usdc, Pool.target);
    await Solvency.waitForDeployment();
    set("SolvencyVault", Solvency.target as string);
    console.log("SolvencyVault:", Solvency.target);

    const OAID = await (await ethers.getContractFactory("OAID")).deploy();
    await OAID.waitForDeployment();
    set("OAID", OAID.target as string);
    console.log("OAID:", OAID.target);

    await (Pool as any).setSolvencyVault(Solvency.target);
    await (Solvency as any).setOAID(OAID.target);
    await (OAID as any).setSolvencyVault(Solvency.target);

    console.log("SeniorPool ↔ SolvencyVault ↔ OAID fully linked");

    const usdcToken = await ethers.getContractAt("MockUSDC", usdc);
    const amt = ethers.parseUnits("500000", 6);
    await (usdcToken as any).mint(deployer.address, amt);
    await (usdcToken as any).approve(Pool.target, amt);
    await (Pool as any).depositLiquidity(amt);

    console.log("SeniorPool seeded with 500,000 USDC");
  }

  // ------------------------------------------------------------------
  // LEVERAGE STACK
  // ------------------------------------------------------------------
  if (STACK === "leverage") {
    console.log("[LEVERAGE STACK] Redeploying FluxionIntegration + LeverageVault");

    wipe(state, networkKey, ["FluxionIntegration", "LeverageVault"]);

    const usdc = contracts.USDC;
    const meth = contracts.MockMETH;
    const dex = contracts.MockFluxionDEX;
    const pool = contracts.SeniorPool;
    const yieldVault = contracts.YieldVault;
    const market = contracts.PrimaryMarketplace;
    const identity = contracts.IdentityRegistry;

    if (!meth || !usdc || !dex) throw new Error("Mocks not deployed");

    const Flux = await (await ethers.getContractFactory("FluxionIntegration")).deploy(
      meth, usdc, dex, meth
    );
    await Flux.waitForDeployment();
    set("FluxionIntegration", Flux.target as string);
    console.log("FluxionIntegration:", Flux.target);

    const Lev = await (await ethers.getContractFactory("LeverageVault")).deploy(
      meth, usdc, pool, Flux.target
    );
    await Lev.waitForDeployment();
    set("LeverageVault", Lev.target as string);
    console.log("LeverageVault:", Lev.target);

    await (Lev as any).setYieldVault(yieldVault);
    await (Lev as any).setPrimaryMarket(market);

    const Pool = await ethers.getContractAt("SeniorPool", pool!);
    await (Pool as any).setLeverageVault(Lev.target);

    const ID = await ethers.getContractAt("IdentityRegistry", identity!);
    await (ID as any).registerIdentity(Lev.target);

    console.log("LeverageVault fully wired and registered");
  }

  // ------------------------------------------------------------------
  // ISSUERVAULT STACK
  // Only IssuerVault is redeployed. YieldVault and PrimaryMarket are
  // existing contracts — only their authorization mappings are updated.
  // ------------------------------------------------------------------
  if (STACK === "issuervault") {
    console.log("[ISSUERVAULT STACK] Redeploying IssuerVault only");

    const usdc        = contracts.USDC;
    const primaryMkt  = contracts.PrimaryMarketplace;
    const yieldVlt    = contracts.YieldVault;
    const oldVault    = contracts.IssuerVault;

    if (!usdc)       throw new Error("USDC not deployed — run STACK=mocks first");
    if (!primaryMkt) throw new Error("PrimaryMarketplace not deployed — run STACK=issuance first");
    if (!yieldVlt)   throw new Error("YieldVault not deployed — run STACK=issuance first");

    // 1. Deploy new IssuerVault
    const IV = await (await ethers.getContractFactory("IssuerVault")).deploy(
      usdc, primaryMkt, yieldVlt
    );
    await IV.waitForDeployment();
    const newVaultAddr = IV.target as string;
    set("IssuerVault", newVaultAddr);
    console.log("IssuerVault (new):", newVaultAddr);

    // 2. Revoke old IssuerVault from YieldVault and PrimaryMarket
    if (oldVault && oldVault !== newVaultAddr) {
      console.log(`Revoking old IssuerVault (${oldVault}) from YieldVault and PrimaryMarket...`);
      const yv = await ethers.getContractAt("YieldVault", yieldVlt);
      await (yv as any).authorizeVault(oldVault, false);
      console.log("  ✔ Revoked from YieldVault");

      const pm = await ethers.getContractAt("PrimaryMarket", primaryMkt);
      await (pm as any).authorizeVault(oldVault, false);
      console.log("  ✔ Revoked from PrimaryMarket");
    }

    // 3. Authorize new IssuerVault in YieldVault
    const yv = await ethers.getContractAt("YieldVault", yieldVlt);
    await (yv as any).authorizeVault(newVaultAddr, true);
    console.log("IssuerVault authorized in YieldVault ✔");

    // 4. Authorize new IssuerVault in PrimaryMarket (general whitelist)
    const pm = await ethers.getContractAt("PrimaryMarket", primaryMkt);
    await (pm as any).authorizeVault(newVaultAddr, true);
    console.log("IssuerVault authorized in PrimaryMarket ✔");

    // 5. Re-register per-asset vault routing in PrimaryMarket for all existing assets
    //    Add new assets here as they are created.
    const EXISTING_ASSETS = [
      { uuid: "47b2197f-0b2e-4fcc-b8d8-9c937e47a0be", name: "G M Finance",   tokenAddress: "0x5aC8d17a826524Ebf0C843D146cb811EE6bd5747", rateBps: 1000 },
      { uuid: "53b2a7cf-5709-43d3-bc28-3c84319dd1ce", name: "R K Ventures",  tokenAddress: "0xD2A336BbA7Cc336308983a1A47613db9658a0Cd8", rateBps: 1000 },
    ];

    for (const asset of EXISTING_ASSETS) {
      const assetIdBytes32 = ("0x" + asset.uuid.replace(/-/g, "").padEnd(64, "0")) as `0x${string}`;

      // Update per-asset routing in PrimaryMarket
      await (pm as any).registerIssuerVault(assetIdBytes32, newVaultAddr);
      console.log(`PrimaryMarket.registerIssuerVault → ${asset.name} ✔`);

      // Register asset in new IssuerVault
      await (IV as any).registerAsset(
        assetIdBytes32,
        asset.tokenAddress,
        deployer.address,   // deployer acts as issuer — update to real issuer wallet if needed
        asset.rateBps,
      );
      console.log(`IssuerVault.registerAsset → ${asset.name} ✔`);
    }

    console.log("\n✅ IssuerVault redeployed and fully wired.");
    console.log(`   New address: ${newVaultAddr}`);
    console.log("   ACTION REQUIRED: Update addresses.ts → HashkeyContracts.IssuerVault");
  }

  // ------------------------------------------------------------------
  // MOCK STACK
  // ------------------------------------------------------------------
  if (STACK === "mocks") {
    console.log("[MOCK STACK] Redeploying MockUSDC, MockMETH, MockFluxionDEX");

    wipe(state, networkKey, ["USDC", "MockMETH", "MockFluxionDEX"]);

    const USDC = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await USDC.waitForDeployment();
    set("USDC", USDC.target as string);
    console.log("MockUSDC:", USDC.target);

    const METH = await (await ethers.getContractFactory("contracts/test/MockMETH.sol:MockMETH")).deploy();
    await METH.waitForDeployment();
    set("MockMETH", METH.target as string);
    console.log("MockMETH:", METH.target);

    const DEX = await (await ethers.getContractFactory("MockFluxionDEX")).deploy(
      METH.target, USDC.target, ethers.parseUnits("3000", 6)
    );
    await DEX.waitForDeployment();
    set("MockFluxionDEX", DEX.target as string);
    console.log("MockFluxionDEX:", DEX.target);
  }

  save(state);

  console.log("\n═══════════════════════════════════════════════");
  console.log("🎯 STACK DEPLOYMENT COMPLETE");
  console.log("═══════════════════════════════════════════════");
  console.table(state.networks![networkKey].contracts);
}

main().catch(err => {
  console.error("\n❌ STACK DEPLOYMENT FAILED");
  console.error(err);
  process.exit(1);
});
