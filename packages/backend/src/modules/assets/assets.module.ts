import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AssetsController } from './controllers/assets.controller';
import { AssetLifecycleService } from './services/asset-lifecycle.service';
import { EigenDAService } from './services/eigenda.service';
import { AssetProcessor } from './processors/asset.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { Payout, PayoutSchema } from '../../database/schemas/payout.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { AuthModule } from '../auth/auth.module'; // For JwtAuthGuard
import { ComplianceEngineModule } from '../compliance-engine/compliance-engine.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Bid.name, schema: BidSchema },
      { name: Payout.name, schema: PayoutSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BullModule.registerQueue({
      name: 'asset-processing',
    }),
    BullModule.registerQueue({
      name: 'auction-status-check',
    }),
    AuthModule,
    ComplianceEngineModule,
    forwardRef(() => AnnouncementsModule),
    NotificationsModule,
  ],
  controllers: [AssetsController],
  providers: [AssetLifecycleService, AssetProcessor, EigenDAService],
  exports: [AssetLifecycleService, EigenDAService],
})
export class AssetModule {}
