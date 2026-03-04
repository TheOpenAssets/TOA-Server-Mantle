import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MantleContracts, MantleAbis } from '@contracts/mantle';
import { ArbitrumContracts, ArbitrumAbis } from '@contracts/arbitrum';
import { StellarContracts } from '@contracts/stellar';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';
import { ContractName } from '@openassets/types';

@Injectable()
export class ContractLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ContractLoaderService.name);
  private contracts: Partial<Record<ContractName | string, string>> = {};
  private abis: Partial<Record<ContractName | string, any>> = {};

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.loadContracts();
  }

  private loadContracts() {
    const networkType = this.configService.get('network.networkType');
    
    if (networkType === 'arbitrum') {
      this.contracts = { ...ArbitrumContracts };
      this.abis = { ...ArbitrumAbis };
      this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
      this.addAlias('USDC', 'MockUSDC');
      this.addAlias('LeverageVault', 'StARBLeverageVault');
    } else if (networkType === 'stellar') {
      this.contracts = { ...StellarContracts };
      this.abis = {};
    } else if (networkType === 'creditcoin') {
      this.contracts = { ...CreditCoinContracts };
      this.abis = { ...CreditCoinAbis };
      this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
      this.addAlias('USDC', 'MockUSDC');
    } else {
      this.contracts = { ...MantleContracts };
      this.abis = { ...MantleAbis };
      this.addAlias('PrimaryMarketplace', 'PrimaryMarket');
      this.addAlias('USDC', 'MockUSDC');
    }

    const envContracts = this.configService.get('blockchain.contracts') || {};
    this.contracts = { ...this.contracts, ...envContracts };
  }

  private addAlias(alias: string, canonical: string) {
    if (this.contracts[canonical as any] && !this.contracts[alias]) {
      this.contracts[alias] = this.contracts[canonical as any];
      this.abis[alias] = this.abis[canonical as any];
    }
  }

  getContractAddress(name: ContractName | string): string {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = this.contracts[name as any] || this.contracts[camelCaseName as any];
    
    if (!addr) {
      throw new Error(`Contract address for ${name} not configured`);
    }
    return addr;
  }

  getContractAbi(name: ContractName | string): any {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const abi = this.abis[name as any] || this.abis[camelCaseName as any];
    if (!abi) {
      this.logger.warn(`ABI for ${name} not loaded. Contract interactions may fail.`);
      return [];
    }
    return abi;
  }
  
  hasContract(name: ContractName | string): boolean {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = this.contracts[name as any] || this.contracts[camelCaseName as any];
    return !!addr;
  }
}
