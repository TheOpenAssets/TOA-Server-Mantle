import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

function resolveManifestFilename(chainId: bigint): string {
  if (process.env.DEPLOYMENT_MANIFEST) {
    return process.env.DEPLOYMENT_MANIFEST;
  }

  if (chainId === 97n) {
    return "deployed_contracts_bnb.json";
  }

  return "deployed_contracts_arbitrum.json";
}

/**
 * Post-deployment fix: Set TokenFactory as the authorized factory on YieldVault.
 *
 * This is a one-time call required because deploy_arbitrum.ts was missing this step.
 * YieldVault.setFactory() can only be called once (when factory == address(0)).
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const manifestFile = resolveManifestFilename(chainId);
  console.log("🔧 Setting TokenFactory on YieldVault");
  console.log("🔑 Caller:", deployer.address);
  console.log("📄 Manifest:", manifestFile);

  const manifestPath = path.join(__dirname, `../../${manifestFile}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const yieldVaultAddress = manifest.contracts.YieldVault;
  const tokenFactoryAddress = manifest.contracts.TokenFactory;

  if (!yieldVaultAddress || !tokenFactoryAddress) {
    throw new Error(`YieldVault or TokenFactory address not found in ${manifestFile}`);
  }

  console.log("📄 YieldVault:    ", yieldVaultAddress);
  console.log("📄 TokenFactory:  ", tokenFactoryAddress);

  const yieldVault = await ethers.getContractAt("YieldVault", yieldVaultAddress);

  // Check current factory value
  const currentFactory = await yieldVault.factory();
  console.log("\n🔍 Current factory address:", currentFactory);

  if (currentFactory !== ethers.ZeroAddress) {
    if (currentFactory.toLowerCase() === tokenFactoryAddress.toLowerCase()) {
      console.log("✅ Factory already correctly set to TokenFactory. Nothing to do.");
    } else {
      console.error("❌ Factory is already set to a DIFFERENT address:", currentFactory);
      console.error("   Cannot override — YieldVault.setFactory() is a one-time call.");
    }
    return;
  }

  console.log("\n⚙️  Calling yieldVault.setFactory(tokenFactory)...");
  const tx = await yieldVault.setFactory(tokenFactoryAddress);
  await tx.wait();
  console.log("   ✅ Transaction confirmed:", tx.hash);

  // Verify
  const newFactory = await yieldVault.factory();
  console.log("   ✅ YieldVault.factory() is now:", newFactory);

  if (newFactory.toLowerCase() === tokenFactoryAddress.toLowerCase()) {
    console.log("\n🎉 Success! TokenFactory is now authorized to call YieldVault.registerAsset()");
  } else {
    console.error("\n❌ Verification failed — factory address mismatch");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
