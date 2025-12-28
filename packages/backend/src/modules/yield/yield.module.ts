import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { YieldDistributionService } from './services/yield-distribution.service';
import { TokenHolderTrackingService } from './services/token-holder-tracking.service';
import { TransferEventBackfillService } from './services/transfer-event-backfill.service';
import { TokenHolder, TokenHolderSchema } from '../../database/schemas/token-holder.schema';
import { TokenTransferEvent, TokenTransferEventSchema } from '../../database/schemas/token-transfer-event.schema';
import { Settlement, SettlementSchema } from '../../database/schemas/settlement.schema';
import { DistributionHistory, DistributionHistorySchema } from '../../database/schemas/distribution-history.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { forwardRef } from '@nestjs/common';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TokenHolder.name, schema: TokenHolderSchema },
      { name: TokenTransferEvent.name, schema: TokenTransferEventSchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: DistributionHistory.name, schema: DistributionHistorySchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    forwardRef(() => BlockchainModule),
    NotificationsModule,
  ],
  providers: [YieldDistributionService, TokenHolderTrackingService, TransferEventBackfillService],
  exports: [YieldDistributionService, TokenHolderTrackingService, TransferEventBackfillService],
})
export class YieldModule {}
