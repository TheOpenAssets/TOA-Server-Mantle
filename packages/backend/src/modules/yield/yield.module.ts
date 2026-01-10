import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { YieldDistributionService } from './services/yield-distribution.service';
import { TokenHolderTrackingService } from './services/token-holder-tracking.service';
import { TransferEventBackfillService } from './services/transfer-event-backfill.service';
import { UserYieldClaimService } from './services/user-yield-claim.service';
import { YieldController } from './controllers/yield.controller';
import { TokenHolder, TokenHolderSchema } from '../../database/schemas/token-holder.schema';
import { TokenTransferEvent, TokenTransferEventSchema } from '../../database/schemas/token-transfer-event.schema';
import { Settlement, SettlementSchema } from '../../database/schemas/settlement.schema';
import { DistributionHistory, DistributionHistorySchema } from '../../database/schemas/distribution-history.schema';
import { UserYieldClaim, UserYieldClaimSchema } from '../../database/schemas/user-yield-claim.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LeverageModule } from '../leverage/leverage.module';
import { SolvencyModule } from '../solvency/solvency.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TokenHolder.name, schema: TokenHolderSchema },
      { name: TokenTransferEvent.name, schema: TokenTransferEventSchema },
      { name: Settlement.name, schema: SettlementSchema },
      { name: DistributionHistory.name, schema: DistributionHistorySchema },
      { name: UserYieldClaim.name, schema: UserYieldClaimSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    forwardRef(() => BlockchainModule),
    forwardRef(() => LeverageModule),
    forwardRef(() => SolvencyModule),
    NotificationsModule,
  ],
  controllers: [YieldController],
  providers: [
    YieldDistributionService,
    TokenHolderTrackingService,
    TransferEventBackfillService,
    UserYieldClaimService,
  ],
  exports: [
    YieldDistributionService,
    TokenHolderTrackingService,
    TransferEventBackfillService,
    UserYieldClaimService,
  ],
})
export class YieldModule {}
