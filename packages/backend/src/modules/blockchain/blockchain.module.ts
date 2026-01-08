import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import blockchainConfig from '../../config/blockchain.config';
import { BlockchainService } from './services/blockchain.service';
import { WalletService } from './services/wallet.service';
import { ContractLoaderService } from './services/contract-loader.service';
import { EventListenerService } from './services/event-listener.service';
import { MethPriceService } from './services/meth-price.service';
import { EventProcessor } from './processors/event.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { P2POrder, P2POrderSchema } from '../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeSchema } from '../../database/schemas/p2p-trade.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { YieldModule } from '../yield/yield.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { forwardRef } from '@nestjs/common';

@Global()
@Module({
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
  ],
  providers: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
    MethPriceService,
    EventProcessor,
  ],
  exports: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
    MethPriceService,
  ],
})
export class BlockchainModule { }
