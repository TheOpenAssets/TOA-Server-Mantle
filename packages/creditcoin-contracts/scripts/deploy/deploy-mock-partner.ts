import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy MockPartnerProtocol to Creditcoin EVM testnet.
 *
 * This contract acts as the demo "Aave Demo" partner in the partner gateway
 * feature. The platform wallet (deployer) becomes the owner and is the only
 * address allowed to call recordLoan() and repay().
 *
 * Run:
 *   npx hardhat run scripts/deploy/deploy-mock-partner.ts --network creditcoinTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=== MockPartnerProtocol Deployment ===");
  console.log(`Network : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance : ${ethers.formatEther(balance)} CTC`);

  if (balance === 0n) {
    throw new Error("Deployer has zero balance — top up with CTC testnet tokens first.");
  }

  // ── Deploy ──────────────────────────────────────────────────────────────
  console.log("\nDeploying MockPartnerProtocol...");
  const Factory = await ethers.getContractFactory("MockPartnerProtocol");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`Deployed MockPartnerProtocol at: ${address}`);

  // ── Update deployed_contracts_creditcoin.json ───────────────────────────
  const manifestPath = path.join(__dirname, "../../deployed_contracts_creditcoin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.contracts.MockPartnerProtocol = address;
  manifest.timestamp = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Updated deployed_contracts_creditcoin.json`);

  // ── Update src/addresses.ts ─────────────────────────────────────────────
  const addressesPath = path.join(__dirname, "../../src/addresses.ts");
  let src = fs.readFileSync(addressesPath, "utf8");

  if (src.includes("MockPartnerProtocol:")) {
    // Replace existing entry
    src = src.replace(
      /(MockPartnerProtocol:\s*)'0x[0-9a-fA-F]{40}'(.*)?/,
      `$1'${address}'$2`,
    );
  } else {
    // Insert before closing brace of the object
    src = src.replace(
      /(\} as const;)/,
      `  MockPartnerProtocol: '${address}',\n$1`,
    );
  }

  fs.writeFileSync(addressesPath, src);
  console.log(`Updated src/addresses.ts`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== Done ===");
  console.log(`MockPartnerProtocol : ${address}`);
  console.log(`Owner (onlyOwner)   : ${deployer.address}`);
  console.log(`\nExplorer: https://creditcoin-testnet.blockscout.com/address/${address}`);
  console.log(
    `\nAdd to backend .env (or update frontend handover doc):\nMOCK_PARTNER_PROTOCOL_ADDRESS=${address}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
