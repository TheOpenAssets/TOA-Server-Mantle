import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';
import { PaymentAdapter } from '../adapters/payment-adapter.interface';
import { StellarContractAdapter } from '../adapters/stellar/stellar-contract-loader.adapter';
import { StellarWalletAdapter } from '../adapters/stellar/stellar-wallet.adapter';
import { StellarBlockchainAdapter } from '../adapters/stellar/stellar-blockchain.adapter';
import { StellarPaymentAdapter } from '../adapters/stellar/stellar-payment.adapter';
import { Model } from 'mongoose';
import { AssetDocument } from '../../../database/schemas/asset.schema';

export class StellarChainManager implements ChainManager {
  private readonly logger = new Logger(StellarChainManager.name);
  private readonly contractAdapter: StellarContractAdapter;
  private readonly walletAdapter: StellarWalletAdapter;
  private readonly blockchainAdapter: StellarBlockchainAdapter;
  private readonly paymentAdapter: StellarPaymentAdapter;

  constructor(
    private configService: ConfigService,
    private assetModel: Model<AssetDocument>
  ) {
    this.contractAdapter = new StellarContractAdapter();
    this.walletAdapter = new StellarWalletAdapter(this.configService);
    this.blockchainAdapter = new StellarBlockchainAdapter(
      this.configService,
      this.walletAdapter,
      this.contractAdapter,
      this.assetModel
    );
    this.paymentAdapter = new StellarPaymentAdapter(this.configService);
  }

  getType(): NetworkType {
    return NetworkType.STELLAR;
  }

  getContractAdapter(): ContractAdapter {
    return this.contractAdapter;
  }

  getBlockchainAdapter(): BlockchainAdapter {
    return this.blockchainAdapter;
  }

  getPaymentAdapter(): PaymentAdapter {
    return this.paymentAdapter;
  }

  async startBackgroundOperations(): Promise<void> {
    this.logger.log('Starting Stellar background operations...');
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Stellar background operations...');
  }
}
