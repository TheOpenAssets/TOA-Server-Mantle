import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error("No deployer account available. Please set PRIVATE_KEY in .env file.");
  }

  console.log("Deploying SecondaryMarket with the account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const deployedContractsPath = path.join(__dirname, "../../deployed_contracts.json");
  const deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, "utf8"));

  const usdc = process.env.USDC_ADDRESS || deployedContracts.contracts.USDC;
  const identityRegistry = process.env.IDENTITY_REGISTRY_ADDRESS || deployedContracts.contracts.IdentityRegistry;

  if (!usdc) {
    throw new Error("USDC address missing in env and deployed_contracts.json");
  }
  if (!identityRegistry) {
    throw new Error("IdentityRegistry address missing in env and deployed_contracts.json");
  }

  console.log("Using USDC:", usdc);
  console.log("Using IdentityRegistry:", identityRegistry);

  const SecondaryMarket = await ethers.getContractFactory("SecondaryMarket");
  const secondaryMarket = await SecondaryMarket.deploy(usdc, identityRegistry);

  await secondaryMarket.waitForDeployment();
  const address = await secondaryMarket.getAddress();

  console.log("SecondaryMarket deployed to:", address);

  // Update deployed_contracts.json
  deployedContracts.contracts.SecondaryMarket = address;
  deployedContracts.timestamp = new Date().toISOString();
  fs.writeFileSync(deployedContractsPath, JSON.stringify(deployedContracts, null, 2));
  console.log("Updated deployed_contracts.json with SecondaryMarket address.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
