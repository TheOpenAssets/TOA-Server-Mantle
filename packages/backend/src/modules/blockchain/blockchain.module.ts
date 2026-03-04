import { Module, Global, DynamicModule, Provider, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { Model } from 'mongoose';
import blockchainConfig from '../../config/blockchain.config';
import { BlockchainService } from './services/blockchain.service';
import { WalletService } from './services/wallet.service';
import { ContractLoaderService } from './services/contract-loader.service';
import { EventListenerService } from './services/event-listener.service';
import { MethPriceService } from './services/meth-price.service';
import { StArbPriceService } from './services/starb-price.service';
import { CreditcoinSubstrateService } from './services/creditcoin-substrate.service';
import { NetworkRegistryService } from './services/network-registry.service';
import { ChainManagerRegistry } from './services/chain-manager-registry.service';
import { NetworkContextService } from './services/network-context.service';
import { NetworkContextMiddleware } from './middleware/network-context.middleware';
import { EventProcessor } from './processors/event.processor';
import { Asset, AssetSchema, AssetDocument } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { P2POrder, P2POrderSchema } from '../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeSchema } from '../../database/schemas/p2p-trade.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { YieldModule } from '../yield/yield.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecondaryMarketModule } from '../secondary-market/secondary-market.module';
import { SolvencyModule } from '../solvency/solvency.module';
import { UserPortfolioModule } from '../user-portfolio/user-portfolio.module';
import { forwardRef } from '@nestjs/common';
import { 
  BLOCKCHAIN_ADAPTER, 
  WALLET_ADAPTER, 
  EVENT_ADAPTER, 
  CONTRACT_ADAPTER, 
  AUTH_VERIFICATION_ADAPTER,
  PAYMENT_ADAPTER,
} from './blockchain.constants';
import { EvmBlockchainAdapter } from './adapters/evm/evm-blockchain.adapter';
import { EvmWalletAdapter } from './adapters/evm/evm-wallet.adapter';
import { EvmEventAdapter } from './adapters/evm/evm-event.adapter';
import { EvmContractAdapter } from './adapters/evm/evm-contract-loader.adapter';
import { EvmAuthVerificationAdapter } from './adapters/evm/evm-auth-verification.adapter';
import { EvmPaymentAdapter } from './adapters/evm/evm-payment.adapter';
import { StellarBlockchainAdapter } from './adapters/stellar/stellar-blockchain.adapter';
import { StellarWalletAdapter } from './adapters/stellar/stellar-wallet.adapter';
import { StellarContractAdapter } from './adapters/stellar/stellar-contract-loader.adapter';
import { StellarAuthVerificationAdapter } from './adapters/stellar/stellar-auth-verification.adapter';
import { StellarPaymentAdapter } from './adapters/stellar/stellar-payment.adapter';
import { Queue } from 'bullmq';
import { getModelToken } from '@nestjs/mongoose';

@Global()
@Module({})
export class BlockchainModule implements NestModule {
  static forRoot(): DynamicModule {
    return {
      module: BlockchainModule,
      imports: [
        ConfigModule.forFeature(blockchainConfig),
        MongooseModule.forFeature([
          { name: Asset.name, schema: AssetSchema },
          { name: Bid.name, schema: BidSchema },
          { name: User.name, schema: UserSchema },
          { name: P2POrder.name, schema: P2POrderSchema },
          { name: P2PTrade.name, schema: P2PTradeSchema },
          { name: Purchase.name, schema: PurchaseSchema },
        ]),
        BullModule.registerQueue({
          name: 'event-processing',
        }),
        forwardRef(() => YieldModule),
        forwardRef(() => NotificationsModule),
        forwardRef(() => SecondaryMarketModule),
        forwardRef(() => SolvencyModule),
        UserPortfolioModule,
      ],
      providers: [
        // Registry
        NetworkRegistryService,
        ChainManagerRegistry,
        NetworkContextService,
        
        // Legacy Services (Wrappers)
        BlockchainService,
        WalletService,
        ContractLoaderService,
        EventListenerService,
        MethPriceService,
        StArbPriceService,
        EventProcessor,
        CreditcoinSubstrateService,
      ],
      exports: [
        NetworkRegistryService,
        ChainManagerRegistry,
        NetworkContextService,
        BlockchainService,
        WalletService,
        ContractLoaderService,
        EventListenerService,
        MethPriceService,
        StArbPriceService,
        MongooseModule,
        CreditcoinSubstrateService,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(NetworkContextMiddleware)
      .forRoutes('*');
  }
}
