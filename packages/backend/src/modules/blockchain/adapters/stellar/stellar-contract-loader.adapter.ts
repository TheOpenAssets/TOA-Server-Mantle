import { Injectable, Logger } from '@nestjs/common';
import { ContractAdapter } from '../contract-adapter.interface';
import { StellarContracts } from '@contracts/stellar';
import { ContractName } from '@openassets/types';

@Injectable()
export class StellarContractAdapter implements ContractAdapter {
  private readonly logger = new Logger(StellarContractAdapter.name);
  private contracts: Partial<Record<ContractName | string, string>> = {};

  constructor() {
    this.loadContracts();
  }

  private loadContracts() {
    this.contracts = { ...StellarContracts };
    this.logger.log(`Loaded ${Object.keys(this.contracts).length} Stellar contract IDs from package`);
  }

  hasContract(name: ContractName | string): boolean {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    return !!(this.contracts[name as any] || this.contracts[camelCaseName as any]);
  }

  getContractAddress(name: ContractName | string): string {
    const camelCaseName = typeof name === 'string' ? name.charAt(0).toLowerCase() + name.slice(1) : name;
    const addr = this.contracts[name as any] || this.contracts[camelCaseName as any];
    if (!addr) throw new Error(`Stellar contract ID for ${name} not configured`);
    return addr;
  }

  getContractInterface(name: ContractName | string): any {
    // For Stellar, this would return the XDR Spec if we had generated JSONs
    // In this phase, we'll use the SDK's Contract class which handles XDR
    return null;
  }
}
