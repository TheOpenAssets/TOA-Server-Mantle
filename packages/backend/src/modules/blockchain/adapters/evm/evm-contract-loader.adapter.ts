import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { ContractAdapter } from '../contract-adapter.interface';

export class EvmContractAdapter implements ContractAdapter {
  private readonly logger = new Logger(EvmContractAdapter.name);
  private contracts: Record<string, string> = {};
  private abis: Record<string, any> = {};

  constructor(private configService: ConfigService) {
    this.loadContracts();
    this.loadAbis();
  }

  private loadContracts() {
    const envContracts = this.configService.get('blockchain.contracts');
    const networkType = this.configService.get('network.networkType');
    
    try {
      const monorepoRoot = path.join(process.cwd(), '../..');
      
      // Determine path based on network type
      let deployPath: string;
      if (networkType === 'arbitrum') {
        deployPath = path.join(monorepoRoot, 'packages/arbitrum-contracts/deployed_contracts_arbitrum.json');
      } else {
        deployPath = path.join(monorepoRoot, 'packages/contracts/deployed_contracts.json');
      }
      
      if (fs.existsSync(deployPath)) {
        const data = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
        this.contracts = { ...data.contracts, ...envContracts };
        this.logger.log(`Loaded contracts from ${deployPath}`);
      } else {
        this.logger.warn(`Contracts file not found at ${deployPath}`);
        this.contracts = envContracts || {};
      }
    } catch (e) {
      this.logger.error('Failed to load contracts', e);
      this.contracts = envContracts || {};
    }

    // Normalize naming aliases: Arbitrum manifest uses 'PrimaryMarket', code uses 'PrimaryMarketplace'
    if (this.contracts['PrimaryMarket'] && !this.contracts['PrimaryMarketplace']) {
      this.contracts['PrimaryMarketplace'] = this.contracts['PrimaryMarket'];
    }
    if (this.contracts['PrimaryMarketplace'] && !this.contracts['PrimaryMarket']) {
      this.contracts['PrimaryMarket'] = this.contracts['PrimaryMarketplace'];
    }
    // Arbitrum uses 'MockUSDC', code uses 'USDC'
    if (this.contracts['MockUSDC'] && !this.contracts['USDC']) {
      this.contracts['USDC'] = this.contracts['MockUSDC'];
    }
    // Arbitrum uses 'StARBLeverageVault', code may use 'LeverageVault'
    if (this.contracts['StARBLeverageVault'] && !this.contracts['LeverageVault']) {
      this.contracts['LeverageVault'] = this.contracts['StARBLeverageVault'];
    }
  }

  private loadAbis() {
    const networkType = this.configService.get('network.networkType');
    const monorepoRoot = path.join(process.cwd(), '../..');
    
    // Determine artifact base path based on network
    let artifactBase: string;
    if (networkType === 'arbitrum') {
      artifactBase = path.join(monorepoRoot, 'packages/arbitrum-contracts/artifacts/contracts');
    } else {
      artifactBase = path.join(monorepoRoot, 'packages/contracts/artifacts/contracts');
    }

    const mapping = {
      AttestationRegistry: 'core/AttestationRegistry.sol/AttestationRegistry.json',
      IdentityRegistry: 'core/IdentityRegistry.sol/IdentityRegistry.json',
      TokenFactory: 'core/TokenFactory.sol/TokenFactory.json',
      YieldVault: 'core/YieldVault.sol/YieldVault.json',
      PrimaryMarketplace: 'marketplace/PrimaryMarket.sol/PrimaryMarket.json',
      PrimaryMarket: 'marketplace/PrimaryMarket.sol/PrimaryMarket.json',
      RWAToken: 'core/RWAToken.sol/RWAToken.json',
      SecondaryMarket: 'marketplace/SecondaryMarket.sol/SecondaryMarket.json',
      USDC: 'test/MockUSDC.sol/MockUSDC.json',
      MockUSDC: 'test/MockUSDC.sol/MockUSDC.json',
    };

    for (const [name, relPath] of Object.entries(mapping)) {
      try {
        const fullPath = path.join(artifactBase, relPath);
        if (fs.existsSync(fullPath)) {
          const artifact = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          this.abis[name] = artifact.abi;
        }
      } catch (e) {
        this.logger.error(`Failed to load ABI for ${name}`, e);
      }
    }
  }

  hasContract(name: string): boolean {
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    return !!(this.contracts[name] || this.contracts[camelCaseName]);
  }

  getContractAddress(name: string): string {
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    const addr = this.contracts[name] || this.contracts[camelCaseName];
    if (!addr) throw new Error(`Contract address for ${name} not configured`);
    return addr;
  }

  getContractInterface(name: string): any {
    return this.abis[name] || [];
  }
}
