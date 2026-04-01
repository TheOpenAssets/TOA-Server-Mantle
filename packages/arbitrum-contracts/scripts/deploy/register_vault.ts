import { ethers } from "hardhat";
import * as fs from "fs";

function resolveManifestFilename(chainId: bigint): string {
  if (process.env.DEPLOYMENT_MANIFEST) {
    return process.env.DEPLOYMENT_MANIFEST;
  }

  if (chainId === 97n) {
    return "./deployed_contracts_bnb.json";
  }

  return "./deployed_contracts_arbitrum.json";
}

/**
 * Register BNBLeverageVault in IdentityRegistry
 *
 * The compliance module checks both sender and receiver of RWA token transfers.
 * When the vault calls PrimaryMarket.buyTokens, the RWAToken is transferred
 * from platformCustody → vault, so the vault must be KYC-verified.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const manifestFilename = resolveManifestFilename(chainId);

  console.log("🔑 Deployer:", deployer.address);
  console.log("📄 Manifest:", manifestFilename);

  // Load deployed addresses
  const manifest = JSON.parse(
    fs.readFileSync(manifestFilename, "utf-8")
  );

  const identityRegistryAddress = manifest.contracts.IdentityRegistry;
  const leverageVaultAddress = manifest.contracts.BNBLeverageVault || manifest.contracts.StARBLeverageVault;

  console.log("📋 IdentityRegistry:", identityRegistryAddress);
  console.log("📋 BNBLeverageVault:", leverageVaultAddress);

  const identityRegistry = await ethers.getContractAt(
    "IdentityRegistry",
    identityRegistryAddress
  );

  // Check current status
  const isAlreadyVerified = await identityRegistry.isVerified(leverageVaultAddress);
  if (isAlreadyVerified) {
    console.log("✅ BNBLeverageVault is already registered in IdentityRegistry");
    return;
  }

  // Register vault
  console.log("⏳ Registering BNBLeverageVault in IdentityRegistry...");
  const tx = await identityRegistry.registerIdentity(leverageVaultAddress);
  await tx.wait();
  console.log("✅ Registered! tx:", tx.hash);

  // Verify
  const nowVerified = await identityRegistry.isVerified(leverageVaultAddress);
  console.log("🔍 Verification status:", nowVerified);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
