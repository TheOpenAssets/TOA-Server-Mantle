/**
 * Register assets in IssuerVault so recordDeposit() works during buyTokens.
 *
 * Call this for any asset whose PrimaryMarket listing already has an
 * issuerVaultForAsset entry set, but the asset was never registered
 * in the IssuerVault contract via registerAsset().
 *
 * Usage:
 *   bun hardhat run scripts/register-assets-in-vault.ts --network hashkey
 */

import { ethers } from "hardhat";

const ISSUER_VAULT_ADDRESS = "0x77f1C34Da561Dd38252277a8f1aEb8E14583b398";

const ASSETS = [
  {
    uuid:         "47b2197f-0b2e-4fcc-b8d8-9c937e47a0be",  // G M Finance
    tokenAddress: "0x5aC8d17a826524Ebf0C843D146cb811EE6bd5747",
    agreedRateBps: 1000,  // 10% p.a. — adjust per asset if needed
  },
  {
    uuid:         "53b2a7cf-5709-43d3-bc28-3c84319dd1ce",  // R K Ventures
    tokenAddress: "0xD2A336BbA7Cc336308983a1A47613db9658a0Cd8",
    agreedRateBps: 1000,
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const vault = await ethers.getContractAt("IssuerVault", ISSUER_VAULT_ADDRESS, deployer);

  for (const asset of ASSETS) {
    const assetIdBytes32 = ("0x" + asset.uuid.replace(/-/g, "").padEnd(64, "0")) as `0x${string}`;

    // Check if already registered to avoid duplicate tx
    const summary = await (vault as any).getDebtSummary(assetIdBytes32).catch(() => null);
    if (summary && summary.isRegistered) {
      console.log(`✔ Already registered: ${asset.uuid}`);
      continue;
    }

    console.log(`\nRegistering ${asset.uuid}...`);
    console.log(`  token:   ${asset.tokenAddress}`);
    console.log(`  issuer:  ${deployer.address}  (admin — update to real issuer wallet if needed)`);
    console.log(`  rateBps: ${asset.agreedRateBps}`);

    const tx = await (vault as any).registerAsset(
      assetIdBytes32,
      asset.tokenAddress,
      deployer.address,      // issuerAddress — replace with real issuer wallet if desired
      asset.agreedRateBps,
    );
    await tx.wait();
    console.log(`✔ Registered: ${tx.hash}`);
  }

  console.log("\n✅ All assets registered in IssuerVault. Purchases will now succeed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
