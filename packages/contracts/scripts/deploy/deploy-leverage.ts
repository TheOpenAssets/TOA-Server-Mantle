import { ethers } from 'hardhat';
import fs from 'fs';
import path from 'path';

async function main() {
  console.log('🚀 Deploying Leverage System Contracts...\n');

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} MNT\n`);

  // Read existing deployed contracts
  const deployedPath = path.join(__dirname, '../../deployed_contracts.json');
  const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));
  const usdcAddress = deployed.contracts.USDC;

  if (!usdcAddress) {
    throw new Error('USDC address not found in deployed_contracts.json');
  }

  // 1. Deploy MockMETH (400k total supply, no price oracle)
  let mockMETHAddress = deployed.contracts.MockMETH;
  if (!mockMETHAddress) {
    console.log('📝 Deploying MockMETH...');
    const MockMETH = await ethers.getContractFactory('contracts/test/MockMETH.sol:MockMETH');
    const mockMETH = await MockMETH.deploy();
    await mockMETH.waitForDeployment();
    mockMETHAddress = await mockMETH.getAddress();
    console.log(`✅ MockMETH deployed: ${mockMETHAddress}`);
    console.log(`   Total Supply: 400,000 mETH (no on-chain price oracle)\n`);
  } else {
    console.log(`✅ Using existing MockMETH: ${mockMETHAddress}\n`);
  }

  // 2. Deploy METHFaucet
  let methFaucetAddress = deployed.contracts.METHFaucet;
  if (!methFaucetAddress) {
    console.log('📝 Deploying METHFaucet...');
    const METHFaucet = await ethers.getContractFactory('METHFaucet');
    const methFaucet = await METHFaucet.deploy(mockMETHAddress);
    await methFaucet.waitForDeployment();
    methFaucetAddress = await methFaucet.getAddress();
    console.log(`✅ METHFaucet deployed: ${methFaucetAddress}\n`);
  } else {
    console.log(`✅ Using existing METHFaucet: ${methFaucetAddress}\n`);
  }

  // 3. Deploy Faucet (USDC) - if not already deployed
  let faucetAddress = deployed.contracts.Faucet;
  if (!faucetAddress) {
    console.log('📝 Deploying Faucet (USDC)...');
    const Faucet = await ethers.getContractFactory('Faucet');
    const faucet = await Faucet.deploy(usdcAddress);
    await faucet.waitForDeployment();
    faucetAddress = await faucet.getAddress();
    console.log(`✅ Faucet deployed: ${faucetAddress}\n`);
  } else {
    console.log(`✅ Using existing Faucet: ${faucetAddress}\n`);
  }

  // 4. Deploy MockFluxionDEX (exact swap functions)
  let mockDEXAddress = deployed.contracts.MockFluxionDEX;
  if (!mockDEXAddress) {
    console.log('📝 Deploying MockFluxionDEX...');
    const MockFluxionDEX = await ethers.getContractFactory('MockFluxionDEX');
    const initialExchangeRate = ethers.parseUnits('3000', 6); // 3000 USDC per mETH
    const mockDEX = await MockFluxionDEX.deploy(mockMETHAddress, usdcAddress, initialExchangeRate);
    await mockDEX.waitForDeployment();
    mockDEXAddress = await mockDEX.getAddress();
    console.log(`✅ MockFluxionDEX deployed: ${mockDEXAddress}`);
    console.log(`   Initial exchange rate: 3000 USDC per mETH`)
    console.log(`   Uses exact swap functions (backend calculates amounts)\n`);
  } else {
    console.log(`✅ Using existing MockFluxionDEX: ${mockDEXAddress}\n`);
  }

  // 5. Deploy SeniorPool
  let seniorPoolAddress = deployed.contracts.SeniorPool;
  if (!seniorPoolAddress) {
    console.log('📝 Deploying SeniorPool...');
    const SeniorPool = await ethers.getContractFactory('SeniorPool');
    const seniorPool = await SeniorPool.deploy(usdcAddress);
    await seniorPool.waitForDeployment();
    seniorPoolAddress = await seniorPool.getAddress();
    console.log(`✅ SeniorPool deployed: ${seniorPoolAddress}\n`);
  } else {
    console.log(`✅ Using existing SeniorPool: ${seniorPoolAddress}\n`);
  }

  // 6. Deploy FluxionIntegration
  let fluxionIntegrationAddress = deployed.contracts.FluxionIntegration;
  if (!fluxionIntegrationAddress) {
    console.log('📝 Deploying FluxionIntegration...');
    const FluxionIntegration = await ethers.getContractFactory('FluxionIntegration');
    // Constructor params: _mETH, _usdc, _dex, _priceOracle
    // Note: Using mockMETH as placeholder for oracle since pricing is now backend-managed
    const fluxionIntegration = await FluxionIntegration.deploy(
      mockMETHAddress,
      usdcAddress,
      mockDEXAddress,
      mockMETHAddress // Placeholder oracle (not used)
    );
    await fluxionIntegration.waitForDeployment();
    fluxionIntegrationAddress = await fluxionIntegration.getAddress();
    console.log(`✅ FluxionIntegration deployed: ${fluxionIntegrationAddress}\n`);
  } else {
    console.log(`✅ Using existing FluxionIntegration: ${fluxionIntegrationAddress}\n`);
  }

  // 7. Deploy LeverageVault
  let leverageVaultAddress = deployed.contracts.LeverageVault;
  if (!leverageVaultAddress) {
    console.log('📝 Deploying LeverageVault...');
    const LeverageVault = await ethers.getContractFactory('LeverageVault');
    // No price oracle needed - backend passes mETH price as parameter in function calls
    const leverageVault = await LeverageVault.deploy(
      mockMETHAddress,
      usdcAddress,
      seniorPoolAddress,
      fluxionIntegrationAddress
    );
    await leverageVault.waitForDeployment();
    leverageVaultAddress = await leverageVault.getAddress();
    console.log(`✅ LeverageVault deployed: ${leverageVaultAddress}\n`);
  } else {
    console.log(`✅ Using existing LeverageVault: ${leverageVaultAddress}\n`);
  }

  // Get contract instances for post-deployment configuration
  const seniorPool = await ethers.getContractAt('SeniorPool', seniorPoolAddress);
  const mockMETH = await ethers.getContractAt('contracts/test/MockMETH.sol:MockMETH', mockMETHAddress);
  const usdc = await ethers.getContractAt('MockUSDC', usdcAddress);

  // 8. Set LeverageVault as authorized borrower on SeniorPool
  console.log('🔗 Authorizing LeverageVault on SeniorPool...');
  await seniorPool.setLeverageVault(leverageVaultAddress);
  console.log('✅ LeverageVault authorized\n');

  // 9. Fund SeniorPool with initial liquidity
  console.log('💰 Funding SeniorPool with 500,000 USDC...');
  await usdc.mint(deployer.address, ethers.parseUnits('500000', 6));
  await usdc.approve(seniorPoolAddress, ethers.parseUnits('500000', 6));
  await seniorPool.depositLiquidity(ethers.parseUnits('500000', 6));
  console.log('✅ SeniorPool funded\n');

  // 10. Fund MockFluxionDEX with liquidity
  console.log('💰 Funding MockFluxionDEX with liquidity...');
  await usdc.mint(mockDEXAddress, ethers.parseUnits('1000000', 6)); // 1M USDC
  await mockMETH.mint(mockDEXAddress, ethers.parseEther('500')); // 500 mETH
  console.log('✅ DEX funded\n');

  // Save deployed addresses
  deployed.contracts = {
    ...deployed.contracts,
    MockMETH: mockMETHAddress,
    METHFaucet: methFaucetAddress,
    Faucet: faucetAddress,
    MockFluxionDEX: mockDEXAddress,
    SeniorPool: seniorPoolAddress,
    FluxionIntegration: fluxionIntegrationAddress,
    LeverageVault: leverageVaultAddress,
  };

  fs.writeFileSync(deployedPath, JSON.stringify(deployed, null, 2));

  console.log('\n✅ All contracts deployed successfully!\n');
  console.log('📋 Deployment Summary:');
  console.log('═══════════════════════════════════════════');
  console.log(`MockMETH:             ${mockMETHAddress}`);
  console.log(`METHFaucet:           ${methFaucetAddress}`);
  console.log(`Faucet (USDC):        ${faucetAddress}`);
  console.log(`MockFluxionDEX:       ${mockDEXAddress}`);
  console.log(`SeniorPool:           ${seniorPoolAddress}`);
  console.log(`FluxionIntegration:   ${fluxionIntegrationAddress}`);
  console.log(`LeverageVault:        ${leverageVaultAddress}`);
  console.log('═══════════════════════════════════════════\n');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });