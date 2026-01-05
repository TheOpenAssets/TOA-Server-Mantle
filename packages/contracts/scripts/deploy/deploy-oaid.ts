import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Deploying OAID (On-chain Asset ID)...\n');

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MNT\n`);

  // Read existing deployed contracts
  const deployedPath = path.join(__dirname, '../../deployed_contracts.json');
  const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));

  // Get SolvencyVault address
  const solvencyVaultAddress = deployed.contracts.SolvencyVault;
  if (!solvencyVaultAddress) {
    throw new Error('SolvencyVault address not found. Deploy SolvencyVault first.');
  }

  console.log(`Using SolvencyVault: ${solvencyVaultAddress}\n`);

  // Deploy OAID
  let oaidAddress = deployed.contracts.OAID;
  if (!oaidAddress) {
    console.log('📝 Deploying OAID...');
    const OAID = await ethers.getContractFactory('OAID');
    const oaid = await OAID.deploy();
    await oaid.waitForDeployment();
    oaidAddress = await oaid.getAddress();
    console.log(`✅ OAID deployed: ${oaidAddress}\n`);

    // Set SolvencyVault as authorized vault
    console.log('🔗 Authorizing SolvencyVault on OAID...');
    await oaid.setSolvencyVault(solvencyVaultAddress);
    console.log('✅ SolvencyVault authorized on OAID\n');
  } else {
    console.log(`✅ Using existing OAID: ${oaidAddress}\n`);
  }

  // Set OAID on SolvencyVault
  console.log('🔗 Setting OAID on SolvencyVault...');
  const solvencyVault = await ethers.getContractAt('SolvencyVault', solvencyVaultAddress);
  await solvencyVault.setOAID(oaidAddress);
  console.log('✅ OAID set on SolvencyVault\n');

  // Save deployed addresses
  deployed.contracts = {
    ...deployed.contracts,
    OAID: oaidAddress,
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  console.log('\n✅ OAID deployment complete!\n');
  console.log('📋 Deployment Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`OAID:                 ${oaidAddress}`);
  console.log(`SolvencyVault:        ${solvencyVaultAddress}`);
  console.log('═══════════════════════════════════════════\n');

  console.log('📝 OAID Integration:');
  console.log('- Credit lines will be issued when users deposit collateral');
  console.log('- External protocols can verify credit via OAID contract');
  console.log('- Credit limits = LTV × collateral value\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
