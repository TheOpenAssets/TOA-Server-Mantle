import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractAdapter } from '../contract-adapter.interface';
import { MantleContracts, MantleAbis } from '@contracts/mantle';
import { ArbitrumContracts, ArbitrumAbis } from '@contracts/arbitrum';
import { ContractName } from '@openassets/types';

export class EvmContractAdapter implements ContractAdapter {
  private readonly logger = new Logger(EvmContractAdapter.name);
  private contracts: Partial<Record<ContractName | string, string>> = {};
  private abis: Partial<Record<ContractName | string, any>> = {};

  constructor(
    private configService: ConfigService,
    initialContracts?: Record<string, string>,
    initialAbis?: Record<string, any>,
  ) {
    if (initialContracts && initialAbis) {
      this.contracts = { ...initialContracts };
      this.abis = { ...initialAbis };
      this.addStandardAliases();
    } else {
      this.loadContracts();
    }
  }

  private loadContracts() {
    const networkType = this.configService.get('network.networkType');
    
    if (networkType === 'arbitrum') {
      this.contracts = { ...ArbitrumContracts };
      this.abis = { ...ArbitrumAbis };
      
      // Aliases for Arbitrum
      this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
      this.addAlias('USDC', 'MockUSDC');
      this.addAlias('LeverageVault', 'StARBLeverageVault');
    } else {
      this.contracts = { ...MantleContracts };
      this.abis = { ...MantleAbis };

      // Aliases for Mantle
      this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
      this.addAlias('USDC', 'MockUSDC');
    }

    const envContracts = this.configService.get('blockchain.contracts') || {};
    this.contracts = { ...this.contracts, ...envContracts };
  }

  private addStandardAliases() {
    this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('USDC', 'MockUSDC');
    // LeverageVault alias is added context-specifically if needed
  }

  private addAlias(alias: string, canonical: string) {
    if (this.contracts[canonical as any] && !this.contracts[alias]) {
      this.contracts[alias] = this.contracts[canonical as any];
      this.abis[alias] = this.abis[canonical as any];
    }
  }

  hasContract(name: ContractName | string): boolean {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    return !!(this.contracts[name as any] || this.contracts[camelCaseName as any]);
  }

  getContractAddress(name: ContractName | string): string {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = this.contracts[name as any] || this.contracts[camelCaseName as any];
    if (!addr) throw new Error(`Contract address for ${name} not configured`);
    return addr;
  }

  getContractInterface(name: ContractName | string): any {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    return this.abis[name as any] || this.abis[camelCaseName as any] || [];
  }
}
