import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ContractAdapter } from '../contract-adapter.interface';

@Injectable()
export class StellarContractAdapter implements ContractAdapter {
  private readonly logger = new Logger(StellarContractAdapter.name);
  private contracts: Record<string, string> = {};

  constructor() {
    this.loadContracts();
  }

  private loadContracts() {
    try {
      const monorepoRoot = path.join(process.cwd(), '../..');
      const deployPath = path.join(monorepoRoot, 'packages/stellar-contracts/deployed_contracts.json');

      if (!fs.existsSync(deployPath)) {
        this.logger.warn(`Stellar deployed_contracts.json not found at ${deployPath}`);
        return;
      }

      const data = JSON.parse(fs.readFileSync(deployPath, 'utf8'));
      const networkKey = 'stellar-testnet';

      if (data.networks?.[networkKey]?.contracts) {
        this.contracts = data.networks[networkKey].contracts;
        this.logger.log(`Loaded ${Object.keys(this.contracts).length} Stellar contract IDs from deployed_contracts.json`);
      } else {
        this.logger.warn(`No contracts found for network "${networkKey}" in Stellar deployed_contracts.json`);
      }
    } catch (e: any) {
      this.logger.error(`Failed to load Stellar deployed_contracts.json: ${e.message}`);
    }
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
