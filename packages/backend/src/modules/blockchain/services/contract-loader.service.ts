import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

interface DeployedContracts {
  networks?: {
    [key: string]: {
      contracts: Record<string, string>;
      network: string;
      timestamp?: string;
    };
  };
  // Legacy format support
  contracts?: Record<string, string>;
}

@Injectable()
export class ContractLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ContractLoaderService.name);
  private contracts: Record<string, string> = {};
  private abis: Record<string, any> = {};
  private currentNetwork: string;

  constructor(private configService: ConfigService) {
    this.currentNetwork = this.configService.get('blockchain.network') || 'mantle-testnet';
  }

  onModuleInit() {
    this.loadContracts();
    this.loadAbis();
  }

  private getNetworkKey(): string {
    const chainId = this.configService.get('blockchain.chainId');
    const networkMap: Record<number, string> = {
      5003: 'mantle-sepolia',
      5000: 'mantle-mainnet',
    };
    
    if (chainId && networkMap[chainId]) {
      return networkMap[chainId];
    }
    
    return this.currentNetwork;
  }

  private loadContracts() {
    const envContracts = this.configService.get('blockchain.contracts');
    const networkType = this.configService.get('network.networkType');

    // Try to load from deployed_contracts.json
    try {
      // Navigate to monorepo root (up two levels from packages/backend)
      const monorepoRoot = path.join(process.cwd(), '../..');
      
      // Determine which contracts package to use based on network type
      let deployPath: string;
      if (networkType === 'arbitrum') {
        deployPath = path.join(monorepoRoot, 'packages/arbitrum-contracts/deployed_contracts_arbitrum.json');
      } else {
        deployPath = path.join(monorepoRoot, 'packages/contracts/deployed_contracts.json');
      }
      
      if (fs.existsSync(deployPath)) {
        const data: DeployedContracts = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
        
        // For Arbitrum, the deployment file has a simple flat format
        if (networkType === 'arbitrum') {
          this.contracts = { ...data.contracts, ...envContracts };
          this.logger.log(`Loaded ${Object.keys(data.contracts || {}).length} Arbitrum contract addresses from ${deployPath}`);
        } else {
          // Standard multi-chain or legacy format for Mantle/Stellar
          const networkKey = this.getNetworkKey();
          this.logger.log(`Loading contracts for network: ${networkKey}`);
          
          // Handle multi-chain structure
          if (data.networks && data.networks[networkKey]) {
            this.contracts = { ...data.networks[networkKey].contracts, ...envContracts };
            this.logger.log(`Loaded ${Object.keys(data.networks[networkKey].contracts).length} contract addresses from ${deployPath}`);
          }
          // Fallback to legacy format
          else if (data.contracts) {
            this.logger.warn('Using legacy deployed_contracts.json format. Consider migrating to multi-chain structure.');
            this.contracts = { ...data.contracts, ...envContracts };
            this.logger.log(`Loaded ${Object.keys(data.contracts).length} contract addresses (legacy format)`);
          } else {
            this.logger.warn(`No contracts found for network ${networkKey} in deployed_contracts.json`);
            this.contracts = envContracts || {};
          }
        }
      } else {
        this.logger.warn(`deployed_contracts.json not found at ${deployPath}. Relying on env vars.`);
        this.contracts = envContracts || {};
      }
    } catch (e) {
      this.logger.error('Failed to load deployed_contracts.json', e);
      this.contracts = envContracts || {};
    }

    // Normalize naming aliases so backend lookups work regardless of manifest key conventions:
    // Arbitrum uses 'PrimaryMarket', Mantle uses 'PrimaryMarketplace' — treat as identical
    if (this.contracts['PrimaryMarket'] && !this.contracts['PrimaryMarketplace']) {
      this.contracts['PrimaryMarketplace'] = this.contracts['PrimaryMarket'];
    }
    if (this.contracts['PrimaryMarketplace'] && !this.contracts['PrimaryMarket']) {
      this.contracts['PrimaryMarket'] = this.contracts['PrimaryMarketplace'];
    }
    // Arbitrum uses 'MockUSDC', shared backend code uses 'USDC'
    if (this.contracts['MockUSDC'] && !this.contracts['USDC']) {
      this.contracts['USDC'] = this.contracts['MockUSDC'];
    }
    // Arbitrum uses 'StARBLeverageVault', backend may reference 'LeverageVault'
    if (this.contracts['StARBLeverageVault'] && !this.contracts['LeverageVault']) {
      this.contracts['LeverageVault'] = this.contracts['StARBLeverageVault'];
    }
  }

  private loadAbis() {
    const networkType = this.configService.get('network.networkType');
    
    // Navigate to monorepo root (up two levels from packages/backend)
    const monorepoRoot = path.join(process.cwd(), '../..');
    
    // Determine artifact base path based on network
    let artifactBase: string;
    if (networkType === 'arbitrum') {
      artifactBase = path.join(monorepoRoot, 'packages/arbitrum-contracts/artifacts/contracts');
    } else {
      artifactBase = path.join(monorepoRoot, 'packages/contracts/artifacts/contracts');
    }

    // Base mapping for all networks
    const baseMapping = {
      AttestationRegistry: 'core/AttestationRegistry.sol/AttestationRegistry.json',
      IdentityRegistry: 'core/IdentityRegistry.sol/IdentityRegistry.json',
      TokenFactory: 'core/TokenFactory.sol/TokenFactory.json',
      YieldVault: 'core/YieldVault.sol/YieldVault.json',
      PrimaryMarketplace: 'marketplace/PrimaryMarket.sol/PrimaryMarket.json',
      PrimaryMarket: 'marketplace/PrimaryMarket.sol/PrimaryMarket.json', // Arbitrum uses this name
      RWAToken: 'core/RWAToken.sol/RWAToken.json',
      USDC: 'test/MockUSDC.sol/MockUSDC.json',
      SecondaryMarket: 'marketplace/SecondaryMarket.sol/SecondaryMarket.json',
      SeniorPool: 'core/SeniorPool.sol/SeniorPool.json',
      PrivateAssetToken: 'core/PrivateAssetToken.sol/PrivateAssetToken.json',
    };

    // Arbitrum-specific mappings
    const arbitrumMapping = {
      ...baseMapping,
      StARBLeverageVault: 'core/StARBLeverageVault.sol/StARBLeverageVault.json',
      LeverageVault: 'core/StARBLeverageVault.sol/StARBLeverageVault.json', // Alias for compatibility
      ArbitrumSwapIntegration: 'integrations/ArbitrumSwapIntegration.sol/ArbitrumSwapIntegration.json',
      MockArbitrumDEX: 'test/MockArbitrumDEX.sol/MockArbitrumDEX.json',
      MockStARB: 'test/MockStARB.sol/MockStARB.json',
    };

    // Mantle-specific mappings
    const mantleMapping = {
      ...baseMapping,
      Faucet: 'test/Faucet.sol/Faucet.json',
      MockMETH: 'test/MockMETH.sol/MockMETH.json',
      METHFaucet: 'test/METHFaucet.sol/METHFaucet.json',
      LeverageVault: 'core/LeverageVault.sol/LeverageVault.json',
      FluxionIntegration: 'integrations/FluxionIntegration.sol/FluxionIntegration.json',
      MockFluxionDEX: 'test/MockFluxionDEX.sol/MockFluxionDEX.json',
      SolvencyVault: 'core/SolvencyVault.sol/SolvencyVault.json',
      OAID: 'integrations/OAID.sol/OAID.json',
    };

    // Select mapping based on network
    const mapping = networkType === 'arbitrum' ? arbitrumMapping : mantleMapping;

    for (const [name, relPath] of Object.entries(mapping)) {
      try {
        const fullPath = path.join(artifactBase, relPath);
        if (fs.existsSync(fullPath)) {
          const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          this.abis[name] = artifact.abi;
          this.logger.log(`Loaded ABI for ${name}`);
        } else {
          this.logger.warn(`ABI not found for ${name} at ${fullPath}`);
        }
      } catch (e) {
        this.logger.error(`Failed to load ABI for ${name}`, e);
      }
    }
  }

  getContractAddress(name: string): string {
    // Try both the original key and camelCase version
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    const addr = this.contracts[name] || this.contracts[camelCaseName];
    
    if (!addr) {
      throw new Error(`Contract address for ${name} not configured`);
    }
    return addr;
  }

  getContractAbi(name: string): any {
    const abi = this.abis[name];
    if (!abi) {
      this.logger.warn(`ABI for ${name} not loaded. Contract interactions may fail.`);
      return []; // Return empty ABI array instead of throwing
    }
    return abi;
  }
  
  hasContract(name: string): boolean {
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    const addr = this.contracts[name] || this.contracts[camelCaseName];
    const hasAbi = !!this.abis[name];
    return !!addr && addr !== '' && hasAbi;
  }
}
