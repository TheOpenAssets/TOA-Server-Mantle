import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { EvmContractAdapter } from '../adapters/evm/evm-contract-loader.adapter';

export class ArbitrumChainManager implements ChainManager {
  private readonly logger = new Logger(ArbitrumChainManager.name);
  private readonly contractAdapter: ContractAdapter;

  constructor(private configService: ConfigService) {
    this.contractAdapter = new EvmContractAdapter(this.configService);
  }

  getType(): NetworkType {
    return NetworkType.ARBITRUM;
  }

  getContractAdapter(): ContractAdapter {
    return this.contractAdapter;
  }

  async startBackgroundOperations(): Promise<void> {
    this.logger.log('Starting Arbitrum background operations...');
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Arbitrum background operations...');
  }
}
