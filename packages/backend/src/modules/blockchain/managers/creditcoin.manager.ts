import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { EvmContractAdapter } from '../adapters/evm/evm-contract-loader.adapter';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';

export class CreditCoinChainManager implements ChainManager {
  private readonly logger = new Logger(CreditCoinChainManager.name);
  private readonly contractAdapter: ContractAdapter;

  constructor(private configService: ConfigService) {
    this.contractAdapter = new EvmContractAdapter(
      this.configService,
      CreditCoinContracts as Record<string, string>,
      CreditCoinAbis as Record<string, any>,
    );
  }

  getType(): NetworkType {
    return NetworkType.CREDITCOIN;
  }

  getContractAdapter(): ContractAdapter {
    return this.contractAdapter;
  }

  async startBackgroundOperations(): Promise<void> {
    this.logger.log('Starting Credit Coin background operations...');
    // Block polling and event processing to be added here
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Credit Coin background operations...');
  }
}
