import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const contractName = process.env.CONTRACT_NAME;
  if (!contractName) {
    console.error("Usage: CONTRACT_NAME=<contractName> npx hardhat --network <network> run scripts/deploy/deploy_single.ts");
    process.exit(1);
  }

  console.log(`Deploying ${contractName} on network: ${network.name}`);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Load existing deployed contracts
  const deployPath = path.join(__dirname, "../../deployed_contracts.json");
  let deployedData: any = {};
  if (fs.existsSync(deployPath)) {
    deployedData = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  }

  // Ensure we have data for the current network
  if (!deployedData.contracts) {
    deployedData.contracts = {};
  }

  const platformCustody = process.env.PLATFORM_CUSTODY || deployer.address;

  // Get USDC address
  let usdcAddress = process.env.USDC_ADDRESS || deployedData.contracts.USDC;
  if (!usdcAddress && (contractName === "YieldVault" || contractName === "PrimaryMarketplace" || contractName === "Faucet" || contractName === "FAUCET_USDC")) {
    console.log("Deploying MockUSDC as dependency...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    usdcAddress = await mockUSDC.getAddress();
    deployedData.contracts.USDC = usdcAddress;
    console.log("✅ MockUSDC deployed to:", usdcAddress);
  }

  let contractAddress: string;

  switch (contractName) {
    case "AttestationRegistry":
      const AttestationRegistry = await ethers.getContractFactory("AttestationRegistry");
      const attestationRegistry = await AttestationRegistry.deploy();
      await attestationRegistry.waitForDeployment();
      contractAddress = await attestationRegistry.getAddress();
      break;

    case "TrustedIssuersRegistry":
      const TrustedIssuersRegistry = await ethers.getContractFactory("TrustedIssuersRegistry");
      const trustedIssuersRegistry = await TrustedIssuersRegistry.deploy();
      await trustedIssuersRegistry.waitForDeployment();
      contractAddress = await trustedIssuersRegistry.getAddress();
      break;

    case "IdentityRegistry":
      const trustedIssuersAddr = deployedData.contracts.TrustedIssuersRegistry;
      if (!trustedIssuersAddr) throw new Error("TrustedIssuersRegistry not deployed");
      const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
      const identityRegistry = await IdentityRegistry.deploy(trustedIssuersAddr);
      await identityRegistry.waitForDeployment();
      contractAddress = await identityRegistry.getAddress();
      break;

    case "YieldVault":
      if (!usdcAddress) throw new Error("USDC address not available");
      const YieldVault = await ethers.getContractFactory("YieldVault");
      const yieldVault = await YieldVault.deploy(usdcAddress, platformCustody);
      await yieldVault.waitForDeployment();
      contractAddress = await yieldVault.getAddress();
      break;

    case "TokenFactory":
      const attestationAddr = deployedData.contracts.AttestationRegistry;
      const identityAddr = deployedData.contracts.IdentityRegistry;
      const trustedAddr = deployedData.contracts.TrustedIssuersRegistry;
      const yieldVaultAddr = deployedData.contracts.YieldVault;
      if (!attestationAddr || !identityAddr || !trustedAddr || !yieldVaultAddr) {
        throw new Error("Required contracts not deployed");
      }
      const TokenFactory = await ethers.getContractFactory("TokenFactory");
      const tokenFactory = await TokenFactory.deploy(
        attestationAddr,
        identityAddr,
        trustedAddr,
        platformCustody,
        yieldVaultAddr
      );
      await tokenFactory.waitForDeployment();
      contractAddress = await tokenFactory.getAddress();
      // Link to YieldVault
      const yieldVaultContract = await ethers.getContractAt("YieldVault", yieldVaultAddr);
      await yieldVaultContract.setFactory(contractAddress);
      break;

    case "PrimaryMarketplace":
      const tokenFactoryAddr = deployedData.contracts.TokenFactory;
      if (!tokenFactoryAddr || !usdcAddress) throw new Error("Dependencies not deployed");
      const PrimaryMarketplace = await ethers.getContractFactory("PrimaryMarket");
      const primaryMarketplace = await PrimaryMarketplace.deploy(
        tokenFactoryAddr,
        platformCustody,
        usdcAddress
      );
      await primaryMarketplace.waitForDeployment();
      contractAddress = await primaryMarketplace.getAddress();
      break;

    case "MockUSDC":
      const MockUSDC = await ethers.getContractFactory("MockUSDC");
      const mockUSDC = await MockUSDC.deploy();
      await mockUSDC.waitForDeployment();
      contractAddress = await mockUSDC.getAddress();
      break;

    case "Faucet":
      if (!usdcAddress) throw new Error("USDC not available");
      const Faucet = await ethers.getContractFactory("Faucet");
      const faucet = await Faucet.deploy(usdcAddress);
      await faucet.waitForDeployment();
      contractAddress = await faucet.getAddress();
      break;

    case "FAUCET_USDC": {
      if (!usdcAddress) throw new Error("USDC not available");
      const FaucetUSDC = await ethers.getContractFactory("Faucet");
      const faucetUSDC = await FaucetUSDC.deploy(usdcAddress);
      await faucetUSDC.waitForDeployment();
      contractAddress = await faucetUSDC.getAddress();
      console.log("✅ USDC Faucet deployed with USDC at:", usdcAddress);
      break;
    }

    case "SeniorPool": {
      if (!usdcAddress) throw new Error("USDC not available");
      const SeniorPool = await ethers.getContractFactory("SeniorPool");
      const seniorPool = await SeniorPool.deploy(usdcAddress);
      await seniorPool.waitForDeployment();
      contractAddress = await seniorPool.getAddress();
      console.log(`✅ SeniorPool deployed to: ${contractAddress}`);

      // Fund SeniorPool
      try {
        console.log("💰 Funding SeniorPool with 500,000 USDC...");
        const usdc = await ethers.getContractAt("MockUSDC", usdcAddress); // Assuming MockUSDC
        const amount = ethers.parseUnits("500000", 6);
        
        // Mint to deployer if possible (for MockUSDC)
        try {
            await usdc.mint(deployer.address, amount);
            console.log("   Minted 500k USDC to deployer");
        } catch (e) {
            console.log("   Could not mint USDC (might not be MockUSDC), hoping for existing balance...");
        }

        await usdc.approve(contractAddress, amount);
        await seniorPool.depositLiquidity(amount);
        console.log("✅ SeniorPool funded with 500,000 USDC");
      } catch (e) {
        console.error("⚠️ Failed to fund SeniorPool:", e.message);
      }
      break;
    }

    case "FluxionIntegration": {
      const mockMETHAddr = deployedData.contracts.MockMETH;
      const mockDEXAddr = deployedData.contracts.MockFluxionDEX;
      if (!mockMETHAddr || !usdcAddress || !mockDEXAddr) {
        throw new Error("Required contracts not deployed (MockMETH, USDC, MockFluxionDEX)");
      }
      const FluxionIntegration = await ethers.getContractFactory("FluxionIntegration");
      // Backend passes mETH price as parameter, oracle is placeholder
      const fluxionIntegration = await FluxionIntegration.deploy(
        mockMETHAddr,
        usdcAddress,
        mockDEXAddr,
        mockMETHAddr // Placeholder oracle
      );
      await fluxionIntegration.waitForDeployment();
      contractAddress = await fluxionIntegration.getAddress();
      console.log(`✅ FluxionIntegration deployed to: ${contractAddress}`);

      // POST-DEPLOYMENT STEPS
      console.log('\n🔧 Running post-deployment configuration...\n');

      // 1. Update LeverageVault to use new FluxionIntegration
      const leverageVaultAddr = deployedData.contracts.LeverageVault;
      if (leverageVaultAddr) {
        try {
          console.log(`🔗 Updating LeverageVault (${leverageVaultAddr}) to use new FluxionIntegration...`);
          const leverageVault = await ethers.getContractAt("LeverageVault", leverageVaultAddr);

          // Check if LeverageVault has a method to update FluxionIntegration
          // For now, we'll just log a warning since the contract might need manual update
          const currentFluxion = await leverageVault.fluxionIntegration();
          if (currentFluxion !== contractAddress) {
            console.log(`⚠️  Current FluxionIntegration: ${currentFluxion}`);
            console.log(`⚠️  New FluxionIntegration: ${contractAddress}`);
            console.log(`⚠️  MANUAL ACTION REQUIRED: LeverageVault was deployed with old FluxionIntegration.`);
            console.log(`⚠️  You may need to redeploy LeverageVault or update its reference if possible.\n`);
          } else {
            console.log('✅ LeverageVault already using this FluxionIntegration\n');
          }
        } catch (e) {
          console.error("⚠️ Failed to check LeverageVault:", e.message);
        }
      } else {
        console.warn("⚠️ LeverageVault not found. Deploy LeverageVault after this.\n");
      }

      // 2. Check/Fund SeniorPool (if exists and needed)
      const seniorPoolAddr = deployedData.contracts.SeniorPool;
      if (seniorPoolAddr) {
        try {
          console.log('💰 Checking SeniorPool funding...');
          const seniorPool = await ethers.getContractAt("SeniorPool", seniorPoolAddr);
          const totalLiquidity = await seniorPool.totalLiquidity();
          console.log(`   Current SeniorPool liquidity: ${ethers.formatUnits(totalLiquidity, 6)} USDC`);

          if (totalLiquidity === 0n) {
            console.log('   SeniorPool has no liquidity. Funding with 500,000 USDC...');
            const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);
            const amount = ethers.parseUnits("500000", 6);

            try {
              await usdc.mint(deployer.address, amount);
              console.log('   Minted 500k USDC to deployer');
            } catch (e) {
              console.log('   Could not mint USDC (might not be MockUSDC)');
            }

            await usdc.approve(seniorPoolAddr, amount);
            await seniorPool.depositLiquidity(amount);
            console.log('✅ SeniorPool funded with 500,000 USDC\n');
          } else {
            console.log('✅ SeniorPool already funded\n');
          }
        } catch (e) {
          console.error("⚠️ Failed to check/fund SeniorPool:", e.message);
        }
      }

      // 3. Check/Fund MockFluxionDEX (if exists and needed)
      if (mockDEXAddr) {
        try {
          console.log('💰 Checking DEX liquidity...');
          const mockMETH = await ethers.getContractAt("contracts/test/MockMETH.sol:MockMETH", mockMETHAddr);
          const usdc = await ethers.getContractAt("MockUSDC", usdcAddress);

          const dexMETHBalance = await mockMETH.balanceOf(mockDEXAddr);
          const dexUSDCBalance = await usdc.balanceOf(mockDEXAddr);

          console.log(`   DEX mETH balance: ${ethers.formatEther(dexMETHBalance)} mETH`);
          console.log(`   DEX USDC balance: ${ethers.formatUnits(dexUSDCBalance, 6)} USDC`);

          if (dexMETHBalance === 0n || dexUSDCBalance === 0n) {
            console.log('   DEX needs liquidity. Funding...');

            if (dexUSDCBalance === 0n) {
              await usdc.mint(mockDEXAddr, ethers.parseUnits("1000000", 6)); // 1M USDC
              console.log('   Added 1,000,000 USDC to DEX');
            }

            if (dexMETHBalance === 0n) {
              await mockMETH.mint(mockDEXAddr, ethers.parseEther("500")); // 500 mETH
              console.log('   Added 500 mETH to DEX');
            }

            console.log('✅ DEX funded\n');
          } else {
            console.log('✅ DEX already has liquidity\n');
          }
        } catch (e: any) {
          console.error("⚠️ Failed to check/fund DEX:", e.message);
        }
      }

      console.log('═══════════════════════════════════════════');
      console.log('📋 FluxionIntegration Deployment Summary');
      console.log('═══════════════════════════════════════════');
      console.log(`FluxionIntegration: ${contractAddress}`);
      console.log(`MockMETH:           ${mockMETHAddr}`);
      console.log(`USDC:               ${usdcAddress}`);
      console.log(`MockFluxionDEX:     ${mockDEXAddr}`);
      if (leverageVaultAddr) {
        console.log(`LeverageVault:      ${leverageVaultAddr}`);
      }
      console.log('═══════════════════════════════════════════\n');

      break;
    }

    case "LeverageVault": {
      const mockMETHAddr = deployedData.contracts.MockMETH;
      const seniorPoolAddr = deployedData.contracts.SeniorPool;
      const fluxionIntegrationAddr = deployedData.contracts.FluxionIntegration;
      if (!mockMETHAddr || !usdcAddress || !seniorPoolAddr || !fluxionIntegrationAddr) {
        throw new Error("Required contracts not deployed (MockMETH, USDC, SeniorPool, FluxionIntegration)");
      }
      const LeverageVault = await ethers.getContractFactory("LeverageVault");
      // No price oracle needed - backend passes mETH price as parameter
      const leverageVault = await LeverageVault.deploy(
        mockMETHAddr,
        usdcAddress,
        seniorPoolAddr,
        fluxionIntegrationAddr
      );
      await leverageVault.waitForDeployment();
      contractAddress = await leverageVault.getAddress();
      console.log(`✅ LeverageVault deployed to: ${contractAddress}`);

      // 1. Set PrimaryMarket
      const primaryMarketAddr = deployedData.contracts.PrimaryMarketplace;
      if (primaryMarketAddr) {
        try {
            console.log(`🔗 Setting PrimaryMarket: ${primaryMarketAddr}`);
            await leverageVault.setPrimaryMarket(primaryMarketAddr);
            console.log("✅ PrimaryMarket set");
        } catch (e) {
            console.error("⚠️ Failed to set PrimaryMarket:", e.message);
        }
      } else {
          console.warn("⚠️ PrimaryMarketplace not found in deployed contracts");
      }

      // 2. Link to SeniorPool
      try {
        const seniorPool = await ethers.getContractAt("SeniorPool", seniorPoolAddr);
        const currentVault = await seniorPool.leverageVault();
        if (currentVault === ethers.ZeroAddress) {
            console.log(`🔗 Linking SeniorPool to LeverageVault...`);
            await seniorPool.setLeverageVault(contractAddress);
            console.log("✅ SeniorPool linked");
        } else if (currentVault !== contractAddress) {
            console.warn(`⚠️ SeniorPool already linked to ${currentVault}. Cannot link to new LeverageVault.`);
        } else {
            console.log("✅ SeniorPool already linked");
        }
      } catch (e) {
          console.error("⚠️ Failed to link SeniorPool:", e.message);
      }

      // 3. Register in IdentityRegistry
      const identityRegistryAddr = deployedData.contracts.IdentityRegistry;
      if (identityRegistryAddr) {
          try {
            const identityRegistry = await ethers.getContractAt("IdentityRegistry", identityRegistryAddr);
            if (!(await identityRegistry.isVerified(contractAddress))) {
                console.log(`🔐 Registering LeverageVault in IdentityRegistry...`);
                await identityRegistry.registerIdentity(contractAddress);
                console.log("✅ LeverageVault registered");
            } else {
                console.log("✅ LeverageVault already registered");
            }
          } catch (e) {
              console.error("⚠️ Failed to register identity:", e.message);
          }
      } else {
          console.warn("⚠️ IdentityRegistry not found in deployed contracts");
      }
      break;
    }

    default:
      throw new Error(`Unknown contract: ${contractName}`);
  }

  console.log(`✅ ${contractName} deployed to: ${contractAddress}`);

  // Update deployed_contracts.json
  deployedData.network = network.name;
  deployedData.timestamp = new Date().toISOString();
  deployedData.contracts[contractName] = contractAddress;

  fs.writeFileSync(deployPath, JSON.stringify(deployedData, null, 2));
  console.log(`📝 Address saved to ${deployPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});