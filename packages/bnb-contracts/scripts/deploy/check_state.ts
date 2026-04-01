import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const manifestName = "deployed_contracts_bnb.json";
  const manifestPath = path.join(__dirname, `../../${manifestName}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const tokenFactory = await ethers.getContractAt("TokenFactory", manifest.contracts.TokenFactory);
  const yieldVault = await ethers.getContractAt("YieldVault", manifest.contracts.YieldVault);

  const tfOwner = await tokenFactory.owner();
  const yvFactory = await yieldVault.factory();

  console.log("Deployer:             ", deployer.address);
  console.log("TokenFactory.owner(): ", tfOwner);
  console.log("YieldVault.factory(): ", yvFactory);
  console.log("TF owner == deployer: ", tfOwner.toLowerCase() === deployer.address.toLowerCase());
  console.log("YV factory == TF:     ", yvFactory.toLowerCase() === manifest.contracts.TokenFactory.toLowerCase());
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(e); process.exit(1); });
