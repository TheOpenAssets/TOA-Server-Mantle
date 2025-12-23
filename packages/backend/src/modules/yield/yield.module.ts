import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { YieldDistributionService } from './services/yield-distribution.service';
import { TokenHolderTrackingService } from './services/token-holder-tracking.service';
import { TokenHolder, TokenHolderSchema } from '../../database/schemas/token-holder.schema';
import { Settlement, SettlementSchema } from '../../database/schemas/settlement.schema';
import { DistributionHistory, DistributionHistorySchema } from '../../database/schemas/distribution-history.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TokenHolder.name, schema: TokenHolderSchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: DistributionHistory.name, schema: DistributionHistorySchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    forwardRef(() => BlockchainModule),
  ],
  providers: [YieldDistributionService, TokenHolderTrackingService],
  exports: [YieldDistributionService, TokenHolderTrackingService],
})
export class YieldModule {}
