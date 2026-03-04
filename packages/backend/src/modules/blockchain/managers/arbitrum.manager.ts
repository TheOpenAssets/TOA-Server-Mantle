import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';
import { EvmContractAdapter } from '../adapters/evm/evm-contract-loader.adapter';
import { EvmWalletAdapter } from '../adapters/evm/evm-wallet.adapter';
import { EvmBlockchainAdapter } from '../adapters/evm/evm-blockchain.adapter';
import { Model } from 'mongoose';
import { AssetDocument } from '../../../database/schemas/asset.schema';

export class ArbitrumChainManager implements ChainManager {
  private readonly logger = new Logger(ArbitrumChainManager.name);
  private readonly contractAdapter: EvmContractAdapter;
  private readonly walletAdapter: EvmWalletAdapter;
  private readonly blockchainAdapter: EvmBlockchainAdapter;

  constructor(
    private configService: ConfigService,
    private assetModel: Model<AssetDocument>
  ) {
    // Arbitrum currently uses Mantle config as default if not specified, 
    // but EvmContractAdapter handles the network-specific contract loading.
    this.contractAdapter = new EvmContractAdapter(this.configService);
    this.walletAdapter = new EvmWalletAdapter(this.configService);
    this.blockchainAdapter = new EvmBlockchainAdapter(
      this.configService,
      this.walletAdapter,
      this.contractAdapter,
      this.assetModel
    );
  }

  getType(): NetworkType {
    return NetworkType.ARBITRUM;
  }

  getContractAdapter(): ContractAdapter {
    return this.contractAdapter;
  }

  getBlockchainAdapter(): BlockchainAdapter {
    return this.blockchainAdapter;
  }

  async startBackgroundOperations(): Promise<void> {
    this.logger.log('Starting Arbitrum background operations...');
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Arbitrum background operations...');
  }
}
