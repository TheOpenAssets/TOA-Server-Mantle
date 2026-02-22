import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * Register StARBLeverageVault in IdentityRegistry
 *
 * The compliance module checks both sender and receiver of RWA token transfers.
 * When the vault calls PrimaryMarket.buyTokens, the RWAToken is transferred
 * from platformCustody → vault, so the vault must be KYC-verified.
 */
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("🔑 Deployer:", deployer.address);

  // Load deployed addresses
  const manifest = JSON.parse(
    fs.readFileSync("./deployed_contracts_arbitrum.json", "utf-8")
  );

  const identityRegistryAddress = manifest.contracts.IdentityRegistry;
  const leverageVaultAddress = manifest.contracts.StARBLeverageVault;

  console.log("📋 IdentityRegistry:", identityRegistryAddress);
  console.log("📋 StARBLeverageVault:", leverageVaultAddress);

  const identityRegistry = await ethers.getContractAt(
    "IdentityRegistry",
    identityRegistryAddress
  );

  // Check current status
  const isAlreadyVerified = await identityRegistry.isVerified(leverageVaultAddress);
  if (isAlreadyVerified) {
    console.log("✅ StARBLeverageVault is already registered in IdentityRegistry");
    return;
  }

  // Register vault
  console.log("⏳ Registering StARBLeverageVault in IdentityRegistry...");
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
