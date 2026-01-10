import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Deploying SolvencyVault...\n');

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MNT\n`);

  // Read existing deployed contracts
  const deployedPath = path.join(__dirname, '../../deployed_contracts.json');
  const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));

  // Get required addresses
  const usdcAddress = deployed.contracts.USDC;
  const seniorPoolAddress = deployed.contracts.SeniorPool;

  if (!usdcAddress) {
    throw new Error('USDC address not found in deployed_contracts.json');
  }
  if (!seniorPoolAddress) {
    throw new Error('SeniorPool address not found in deployed_contracts.json');
  }

  console.log(`Using USDC: ${usdcAddress}`);
  console.log(`Using SeniorPool: ${seniorPoolAddress}\n`);

  // Deploy SolvencyVault
  let solvencyVaultAddress = deployed.contracts.SolvencyVault;
  if (!solvencyVaultAddress) {
    console.log('📝 Deploying SolvencyVault...');
    const SolvencyVault = await ethers.getContractFactory('SolvencyVault');
    const solvencyVault = await SolvencyVault.deploy(usdcAddress, seniorPoolAddress);
    await solvencyVault.waitForDeployment();
    solvencyVaultAddress = await solvencyVault.getAddress();
    console.log(`✅ SolvencyVault deployed: ${solvencyVaultAddress}\n`);

    // Set PrimaryMarket on SolvencyVault if available
    const primaryMarketAddress = deployed.contracts.PrimaryMarketplace;
    if (primaryMarketAddress) {
      console.log(`🔗 Setting PrimaryMarket on SolvencyVault: ${primaryMarketAddress}...`);
      await solvencyVault.setPrimaryMarket(primaryMarketAddress);
      console.log('✅ PrimaryMarket set\n');
    } else {
      console.warn('⚠️ PrimaryMarketplace address not found. Set it manually later.\n');
    }
  } else {
    console.log(`✅ Using existing SolvencyVault: ${solvencyVaultAddress}\n`);
  }

  // Authorize SolvencyVault on SeniorPool
  console.log('🔗 Authorizing SolvencyVault on SeniorPool...');
  const seniorPool = await ethers.getContractAt('SeniorPool', seniorPoolAddress);
  
  try {
    const currentSolvencyVault = await seniorPool.solvencyVault();
    if (currentSolvencyVault === ethers.ZeroAddress) {
      await seniorPool.setSolvencyVault(solvencyVaultAddress);
      console.log('✅ SolvencyVault authorized on SeniorPool\n');
    } else if (currentSolvencyVault === solvencyVaultAddress) {
      console.log('✅ SolvencyVault already authorized on SeniorPool\n');
    } else {
      console.warn(`⚠️ SeniorPool already has a different SolvencyVault: ${currentSolvencyVault}\n`);
    }
  } catch (error) {
    console.warn('⚠️ Could not check/set SolvencyVault on SeniorPool. Set it manually if needed.\n');
  }

  // Save deployed addresses
  deployed.contracts = {
    ...deployed.contracts,
    SolvencyVault: solvencyVaultAddress,
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  console.log('\n✅ SolvencyVault deployment complete!\n');
  console.log('📋 Deployment Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`SolvencyVault:        ${solvencyVaultAddress}`);
  console.log(`USDC:                 ${usdcAddress}`);
  console.log(`SeniorPool:           ${seniorPoolAddress}`);
  console.log('═══════════════════════════════════════════\n');

  console.log('📝 Next Steps:');
  console.log('1. Deploy OAID (optional): npx hardhat run scripts/deploy/deploy-oaid.ts --network mantleSepolia');
  console.log('2. Fund SeniorPool with USDC liquidity');
  console.log('3. Test deposit/borrow/repay flow\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
