import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContractAdapter } from '../contract-adapter.interface';

@Injectable()
export class StellarContractAdapter implements ContractAdapter {
  private readonly logger = new Logger(StellarContractAdapter.name);
  private contracts: Record<string, string> = {};

  constructor(private readonly configService: ConfigService) {
    this.contracts = this.configService.get<Record<string, string>>('network.stellar.contracts') || {};
  }

  hasContract(name: string): boolean {
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    return !!(this.contracts[name] || this.contracts[camelCaseName]);
  }

  getContractAddress(name: string): string {
    const camelCaseName = name.charAt(0).toLowerCase() + name.slice(1);
    const addr = this.contracts[name] || this.contracts[camelCaseName];
    if (!addr) throw new Error(`Stellar contract ID for ${name} not configured`);
    return addr;
  }

  getContractInterface(name: string): any {
    // For Stellar, this would return the XDR Spec if we had generated JSONs
    // In this phase, we'll use the SDK's Contract class which handles XDR
    return null;
  }
}
