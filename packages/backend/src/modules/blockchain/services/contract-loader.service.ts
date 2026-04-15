import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MantleContracts, MantleAbis, HashkeyContracts } from '@contracts/mantle';
import { BnbEvmContracts, BnbAbis, BnbContracts } from '@contracts/bnb';
import { StellarContracts } from '@contracts/stellar';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';
import { ContractName } from '@openassets/types';
import { NetworkContextService } from './network-context.service';

@Injectable()
export class ContractLoaderService implements OnModuleInit {
  private readonly logger = new Logger(ContractLoaderService.name);
  
  // Storage for all networks
  private networkContracts: Record<string, Partial<Record<ContractName | string, string>>> = {};
  private networkAbis: Record<string, Partial<Record<ContractName | string, any>>> = {};

  constructor(
    private configService: ConfigService,
    private networkContext: NetworkContextService
  ) {}

  onModuleInit() {
    this.initializeAllNetworks();
  }

  private initializeAllNetworks() {
    // 1. Initialize Hashkey
    this.networkContracts['hashkey'] = { ...HashkeyContracts };
    this.networkAbis['hashkey'] = { ...MantleAbis };
    this.addAlias('hashkey', 'PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('hashkey', 'USDC', 'MockUSDC');

    // 2. Initialize Arbitrum
    this.networkContracts['arbitrum'] = { ...BnbEvmContracts };
    this.networkAbis['arbitrum'] = { ...BnbAbis };
    this.addAlias('arbitrum', 'PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('arbitrum', 'USDC', 'MockUSDC');
    this.addAlias('arbitrum', 'LeverageVault', 'BNBLeverageVault');

    // 3. Initialize BNB
    this.networkContracts['bnb'] = { ...BnbContracts };
    this.networkAbis['bnb'] = { ...BnbAbis };
    this.addAlias('bnb', 'PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('bnb', 'USDC', 'MockUSDC');
    this.addAlias('bnb', 'LeverageVault', 'BNBLeverageVault');

    // 4. Initialize Stellar
    this.networkContracts['stellar'] = { ...StellarContracts };
    this.networkAbis['stellar'] = {};

    // 5. Initialize Creditcoin
    this.networkContracts['creditcoin'] = { ...CreditCoinContracts };
    this.networkAbis['creditcoin'] = { ...CreditCoinAbis };
    this.addAlias('creditcoin', 'PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('creditcoin', 'USDC', 'MockUSDC');

    // 6. Initialize Mantle (Default)
    this.networkContracts['mantle'] = { ...MantleContracts };
    this.networkAbis['mantle'] = { ...MantleAbis };
    this.addAlias('mantle', 'PrimaryMarketplace', 'PrimaryMarket');
    this.addAlias('mantle', 'USDC', 'MockUSDC');

    // Merge environment overrides if any
    const envContracts = this.configService.get('blockchain.contracts') || {};
    const currentNet = this.configService.get('network.networkType') || 'mantle';
    if (!this.networkContracts[currentNet]) {
      this.networkContracts[currentNet] = {};
    }
    this.networkContracts[currentNet] = { ...this.networkContracts[currentNet], ...envContracts };
  }

  private addAlias(network: string, alias: string, canonical: string) {
    const contracts = this.networkContracts[network];
    const abis = this.networkAbis[network];
    if (contracts && contracts[canonical as any] && !contracts[alias]) {
      contracts[alias] = contracts[canonical as any];
      if (abis) abis[alias] = abis[canonical as any];
    }
  }

  getContractAddress(name: ContractName | string): string {
    const network = this.networkContext.getNetwork();
    const contracts = this.networkContracts[network] || this.networkContracts['mantle'] || {};
    
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = contracts[name as any] || contracts[camelCaseName as any];
    
    if (!addr) {
      this.logger.error(`Contract address for ${name} not configured on network ${network}`);
      throw new Error(`Contract address for ${name} not configured on network ${network}`);
    }
    return addr;
  }

  getContractAbi(name: ContractName | string): any {
    const network = this.networkContext.getNetwork();
    const abis = this.networkAbis[network] || this.networkAbis['mantle'] || {};

    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const abi = abis[name as any] || abis[camelCaseName as any];
    if (!abi) {
      this.logger.warn(`ABI for ${name} not loaded on network ${network}. Contract interactions may fail.`);
      return [];
    }
    return abi;
  }
  
  hasContract(name: ContractName | string): boolean {
    const network = this.networkContext.getNetwork();
    const contracts = this.networkContracts[network] || this.networkContracts['mantle'] || {};
    
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = contracts[name as any] || contracts[camelCaseName as any];
    return !!addr;
  }
}
