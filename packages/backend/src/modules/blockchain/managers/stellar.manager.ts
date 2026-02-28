import { Logger } from '@nestjs/common';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { StellarContractAdapter } from '../adapters/stellar/stellar-contract-loader.adapter';

export class StellarChainManager implements ChainManager {
  private readonly logger = new Logger(StellarChainManager.name);
  private readonly contractAdapter: ContractAdapter;

  constructor() {
    this.contractAdapter = new StellarContractAdapter();
  }

  getType(): NetworkType {
    return NetworkType.STELLAR;
  }

  getContractAdapter(): ContractAdapter {
    return this.contractAdapter;
  }

  async startBackgroundOperations(): Promise<void> {
    this.logger.log('Starting Stellar background operations...');
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Stellar background operations...');
  }
}
