import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const privateKey = process.env.ADMIN_PRIVATE_KEY;
    if (!privateKey) throw new Error("❌ ADMIN_PRIVATE_KEY missing");

    const deployer = new ethers.Wallet(privateKey, ethers.provider);
    const deployedPath = path.join(__dirname, "../../deployed_contracts.json");
    const data = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
    const c = data.contracts;

    console.log(`🚀 Replacing PrimaryMarketplace on ${network.name}`);

    let currentNonce = await ethers.provider.getTransactionCount(deployer.address);
    const getNonce = () => ({ nonce: currentNonce++ });

    // 1. Deploy New Primary Marketplace
    console.log("🔹 Phase 1: Deployment");
    const PrimaryMarket = await ethers.getContractFactory("PrimaryMarket", deployer);
    const newPrimaryMarket = await PrimaryMarket.deploy(
        c.TokenFactory,
        deployer.address,
        c.USDC,
        getNonce()
    );
    await newPrimaryMarket.waitForDeployment();
    const newAddr = await newPrimaryMarket.getAddress();
    console.log(`   ➔ New PrimaryMarketplace: ${newAddr}`);

    // 2. Register in Identity Registry
    console.log("\n🔹 Phase 2: Compliance Registration");
    const ir = await ethers.getContractAt("IdentityRegistry", c.IdentityRegistry, deployer);
    console.log(`   🔐 Registering in IdentityRegistry...`);
    await (await ir.registerIdentity(newAddr, getNonce())).wait();
    console.log("   ✅ Registered");

    // 3. Update Vault Links
    console.log("\n🔹 Phase 3: Updating System Links");

    const leverageVault = await ethers.getContractAt("LeverageVault", c.LeverageVault, deployer);
    console.log("   🔗 Updating LeverageVault...");
    await (await leverageVault.setPrimaryMarket(newAddr, getNonce())).wait();

    const solvencyVault = await ethers.getContractAt("SolvencyVault", c.SolvencyVault, deployer);
    console.log("   🔗 Updating SolvencyVault...");
    await (await solvencyVault.setPrimaryMarket(newAddr, getNonce())).wait();

    // 4. Update JSON
    console.log("\n🔹 Phase 4: Persistence");
    data.contracts.PrimaryMarketplace = newAddr;
    data.timestamp = new Date().toISOString();
    fs.writeFileSync(deployedPath, JSON.stringify(data, null, 2));
    console.log("   ✅ deployed_contracts.json updated");

    // --- FINAL AUDIT ---
    console.log("\n🔍 Final Verification:");
    const isVerified = await ir.isVerified(newAddr);
    const lvLink = await leverageVault.primaryMarket();

    console.table([
        { Component: "Identity Registry", Status: isVerified ? "✅ Verified" : "❌ Failed" },
        { Component: "LeverageVault Link", Status: lvLink === newAddr ? "✅ Correct" : "❌ Mismatch" }
    ]);
}

main().catch(console.error);