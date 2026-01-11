import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SecondaryMarketService } from './services/secondary-market.service';
// import { SecondaryMarketIndexer } from './services/secondary-market-indexer.service';
import { TokenBalanceService } from './services/token-balance.service';
import { SecondaryMarketController } from './controllers/secondary-market.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeveragePosition.name, schema: LeveragePositionSchema },
    ]),
    forwardRef(() => BlockchainModule),
    NotificationsModule,
  ],
  controllers: [SecondaryMarketController],
  providers: [SecondaryMarketService, TokenBalanceService],
  exports: [SecondaryMarketService, TokenBalanceService],
})
export class SecondaryMarketModule { }
