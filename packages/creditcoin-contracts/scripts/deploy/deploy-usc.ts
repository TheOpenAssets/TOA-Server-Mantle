import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Deploy USCCreditVerifier to Creditcoin EVM testnet.
 *
 * The contract wraps the 0x0FD2 STARK-proof precompile native to
 * Creditcoin CC3. Only the deployer (owner) may call verifyAndRecord,
 * so deploy with the same key the backend platform wallet uses.
 *
 * Run:
 *   npx hardhat run scripts/deploy/deploy-usc.ts --network creditcoinTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=== USCCreditVerifier Deployment ===");
  console.log(`Network : ${network.name} (chainId ${network.chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance : ${ethers.formatEther(balance)} CTC`);

  if (balance === 0n) {
    throw new Error("Deployer has zero balance — top up with CTC testnet tokens first.");
  }

  // ── Deploy ──────────────────────────────────────────────────────────────
  console.log("\nDeploying USCCreditVerifier...");
  const Factory = await ethers.getContractFactory("USCCreditVerifier");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`Deployed USCCreditVerifier at: ${address}`);

  // ── Update deployed_contracts_creditcoin.json ───────────────────────────
  const manifestPath = path.join(__dirname, "../../deployed_contracts_creditcoin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.contracts.USCCreditVerifier = address;
  manifest.timestamp = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Updated deployed_contracts_creditcoin.json`);

  // ── Update src/addresses.ts ─────────────────────────────────────────────
  const addressesPath = path.join(__dirname, "../../src/addresses.ts");
  let src = fs.readFileSync(addressesPath, "utf8");
  src = src.replace(
    /(USCCreditVerifier:\s*)'0x[0-9a-fA-F]{40}'(.*)?/,
    `$1'${address}'$2`,
  );
  fs.writeFileSync(addressesPath, src);
  console.log(`Updated src/addresses.ts`);

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log("\n=== Done ===");
  console.log(`USCCreditVerifier : ${address}`);
  console.log(`Owner (onlyOwner) : ${deployer.address}`);
  console.log(`0x0FD2 precompile  : 0x0000000000000000000000000000000000000FD2`);
  console.log(`\nExplorer: https://creditcoin-testnet.blockscout.com/address/${address}`);
  console.log(
    `\nAdd to backend .env:\nCREDITCOIN_USC_VERIFIER_ADDRESS=${address}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
