import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { P2POrder, P2POrderSchema } from '../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeSchema } from '../../database/schemas/p2p-trade.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecondaryMarketService } from './services/secondary-market.service';
import { SecondaryMarketIndexer } from './services/secondary-market-indexer.service';
import { TokenBalanceService } from './services/token-balance.service';
import { SecondaryMarketController } from './controllers/secondary-market.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: P2POrder.name, schema: P2POrderSchema },
      { name: P2PTrade.name, schema: P2PTradeSchema },
      { name: Asset.name, schema: AssetSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: LeveragePosition.name, schema: LeveragePositionSchema },
    ]),
    BlockchainModule,
    NotificationsModule,
  ],
  controllers: [SecondaryMarketController],
  providers: [SecondaryMarketService, SecondaryMarketIndexer, TokenBalanceService],
  exports: [SecondaryMarketService, TokenBalanceService],
})
export class SecondaryMarketModule { }
