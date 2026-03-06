import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NetworkType } from '@openassets/types';
import { ChainManager } from '../interfaces/chain-manager.interface';
import { ContractAdapter } from '../adapters/contract-adapter.interface';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';
import { PaymentAdapter } from '../adapters/payment-adapter.interface';
import { EvmContractAdapter } from '../adapters/evm/evm-contract-loader.adapter';
import { EvmWalletAdapter } from '../adapters/evm/evm-wallet.adapter';
import { EvmBlockchainAdapter } from '../adapters/evm/evm-blockchain.adapter';
import { EvmPaymentAdapter } from '../adapters/evm/evm-payment.adapter';
import { CreditCoinContracts, CreditCoinAbis } from '@contracts/creditcoin';
import { Model } from 'mongoose';
import { AssetDocument } from '../../../database/schemas/asset.schema';

export class CreditCoinChainManager implements ChainManager {
  private readonly logger = new Logger(CreditCoinChainManager.name);
  private readonly contractAdapter: EvmContractAdapter;
  private readonly walletAdapter: EvmWalletAdapter;
  private readonly blockchainAdapter: EvmBlockchainAdapter;
  private readonly paymentAdapter: EvmPaymentAdapter;

  constructor(
    private configService: ConfigService,
    private assetModel: Model<AssetDocument>
  ) {
    const rpcUrl = this.configService.get<string>('CREDITCOIN_RPC_URL');
    const chainId = Number(this.configService.get<string>('CREDITCOIN_CHAIN_ID'));
    const adminPk = this.configService.get<string>('CREDITCOIN_ADMIN_PRIVATE_KEY');
    const platformPk = this.configService.get<string>('CREDITCOIN_PLATFORM_PRIVATE_KEY');
    const custodyAddress = this.configService.get<string>('CREDITCOIN_CUSTODY_WALLET_ADDRESS');

    if (!custodyAddress) {
      this.logger.warn('CREDITCOIN_CUSTODY_WALLET_ADDRESS not configured. Burn operations might fail.');
    }

    this.contractAdapter = new EvmContractAdapter(
      this.configService,
      CreditCoinContracts as Record<string, string>,
      CreditCoinAbis as Record<string, any>,
    );

    this.walletAdapter = new EvmWalletAdapter(this.configService, {
      rpcUrl,
      chainId,
      adminPk,
      platformPk,
      networkName: 'Credit Coin CC3',
      nativeSymbol: 'CTC',
    });

    this.blockchainAdapter = new EvmBlockchainAdapter(
      this.configService,
      this.walletAdapter,
      this.contractAdapter,
      this.assetModel,
      {
        rpcUrl,
        chainId,
        networkName: 'Credit Coin CC3',
        nativeSymbol: 'CTC',
        custodyAddress,
      }
    );

    this.paymentAdapter = new EvmPaymentAdapter(this.configService);
  }

  getType(): NetworkType {
    return NetworkType.CREDITCOIN;
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
    this.logger.log('Starting Credit Coin background operations...');
  }

  async stopBackgroundOperations(): Promise<void> {
    this.logger.log('Stopping Credit Coin background operations...');
  }
}
