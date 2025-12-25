import { ethers, network } from "hardhat";

async function main() {
  console.log("Starting deployment on network:", network.name);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  // 0. Configuration & Setup
  let usdcAddress = process.env.USDC_ADDRESS;
  let faucetAddress: string | undefined;
  const platformCustody = deployer.address; // Default to deployer for initial setup
  
  if (!usdcAddress) {
    if (network.name === "localhost" || network.name === "hardhat") {
      console.warn("⚠️  No USDC_ADDRESS found in env. Deploying MockUSDC for local testing...");
      throw new Error("USDC_ADDRESS is missing. Please set it in your .env file.");
    } else {
      console.warn("⚠️  No USDC_ADDRESS found in env. Deploying MockUSDC for testnet...");
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const mockUSDC = await MockUSDC.deploy();
      await mockUSDC.waitForDeployment();
      usdcAddress = await mockUSDC.getAddress();
      console.log("✅ MockUSDC deployed to:", usdcAddress);

      // Deploy Faucet
      console.log("\nDeploying Faucet...");
      const Faucet = await ethers.getContractFactory("Faucet");
      const faucet = await Faucet.deploy(usdcAddress);
      await faucet.waitForDeployment();
      faucetAddress = await faucet.getAddress();
      console.log("✅ Faucet deployed to:", faucetAddress);
    }
  }
  console.log("Using USDC Address:", usdcAddress);

  // 1. Deploy AttestationRegistry
  console.log("\n1. Deploying AttestationRegistry...");
  const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
  const attestationRegistry = await AttestationRegistry.deploy();
  await attestationRegistry.waitForDeployment();
  const attestationRegistryAddress = await attestationRegistry.getAddress();
  console.log("✅ AttestationRegistry deployed to:", attestationRegistryAddress);

  // 2. Deploy TrustedIssuersRegistry
  console.log("\n2. Deploying TrustedIssuersRegistry...");
  const TrustedIssuersRegistry = await ethers.getContractFactory("TrustedIssuersRegistry");
  const trustedIssuersRegistry = await TrustedIssuersRegistry.deploy();
  await trustedIssuersRegistry.waitForDeployment();
  const trustedIssuersRegistryAddress = await trustedIssuersRegistry.getAddress();
  console.log("✅ TrustedIssuersRegistry deployed to:", trustedIssuersRegistryAddress);

  // 3. Deploy IdentityRegistry
  console.log("\n3. Deploying IdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identityRegistry = await IdentityRegistry.deploy(trustedIssuersRegistryAddress);
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("✅ IdentityRegistry deployed to:", identityRegistryAddress);

  // 4. Deploy YieldVault
  console.log("\n4. Deploying YieldVault...");
  const YieldVault = await ethers.getContractFactory("YieldVault");
  const yieldVault = await YieldVault.deploy(usdcAddress, platformCustody);
  await yieldVault.waitForDeployment();
  const yieldVaultAddress = await yieldVault.getAddress();
  console.log("✅ YieldVault deployed to:", yieldVaultAddress);

  // 5. Deploy TokenFactory
  console.log("\n5. Deploying TokenFactory...");
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const tokenFactory = await TokenFactory.deploy(
    attestationRegistryAddress,
    identityRegistryAddress,
    trustedIssuersRegistryAddress,
    platformCustody,
    yieldVaultAddress
  );
  await tokenFactory.waitForDeployment();
  const tokenFactoryAddress = await tokenFactory.getAddress();
  console.log("✅ TokenFactory deployed to:", tokenFactoryAddress);

  // 6. Set Factory in YieldVault
  console.log("   -> Linking TokenFactory to YieldVault...");
  const txVault = await yieldVault.setFactory(tokenFactoryAddress);
  await txVault.wait();
  console.log("   ✅ Done");

  // 7. Deploy PrimaryMarketplace
  console.log("\n6. Deploying PrimaryMarketplace...");
  const PrimaryMarketplace = await ethers.getContractFactory("PrimaryMarket");
  const primaryMarketplace = await PrimaryMarketplace.deploy(
    tokenFactoryAddress,
    platformCustody,
    usdcAddress
  );
  await primaryMarketplace.waitForDeployment();
  const primaryMarketplaceAddress = await primaryMarketplace.getAddress();
  console.log("✅ PrimaryMarketplace deployed to:", primaryMarketplaceAddress);

  console.log("\n🎉 Deployment Complete! Summary:");
  const summary: any = {
    AttestationRegistry: attestationRegistryAddress,
    TrustedIssuersRegistry: trustedIssuersRegistryAddress,
    IdentityRegistry: identityRegistryAddress,
    YieldVault: yieldVaultAddress,
    TokenFactory: tokenFactoryAddress,
    PrimaryMarketplace: primaryMarketplaceAddress,
    USDC: usdcAddress,
  };
  if (faucetAddress) {
    summary.Faucet = faucetAddress;
  }
  console.table(summary);

  // Save to deployed_contracts.json
  const fs = require("fs");
  const path = require("path");
  const deployPath = path.join(__dirname, "../../deployed_contracts.json");
  const data = {
    network: network.name,
    timestamp: new Date().toISOString(),
    contracts: {
      AttestationRegistry: attestationRegistryAddress,
      TrustedIssuersRegistry: trustedIssuersRegistryAddress,
      IdentityRegistry: identityRegistryAddress,
      YieldVault: yieldVaultAddress,
      TokenFactory: tokenFactoryAddress,
      PrimaryMarketplace: primaryMarketplaceAddress,
      USDC: usdcAddress,
      ...(faucetAddress && { Faucet: faucetAddress }),
    }
  };

  fs.writeFileSync(deployPath, JSON.stringify(data, null, 2));
  console.log(`\n📝 Addresses saved to ${deployPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
