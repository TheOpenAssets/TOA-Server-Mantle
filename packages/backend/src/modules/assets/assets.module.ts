import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AssetsController } from './controllers/assets.controller';
import { AssetLifecycleService } from './services/asset-lifecycle.service';
import { EigenDAService } from './services/eigenda.service';
import { AssetProcessor } from './processors/asset.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { Payout, PayoutSchema } from '../../database/schemas/payout.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { AuthModule } from '../auth/auth.module'; // For JwtAuthGuard
import { ComplianceEngineModule } from '../compliance-engine/compliance-engine.module';
import { AnnouncementsModule } from '../announcements/announcements.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MantleAssetOriginationService } from './implementations/mantle/mantle-asset-origination.service';
import { StellarAssetOriginationService } from './implementations/stellar/stellar-asset-origination.service';
import { MANTLE_ASSET_ORIGINATION_TOKEN, STELLAR_ASSET_ORIGINATION_TOKEN } from '../registry/registry.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Bid.name, schema: BidSchema },
      { name: Purchase.name, schema: PurchaseSchema },
      { name: Payout.name, schema: PayoutSchema },
      { name: User.name, schema: UserSchema },
      { name: LeveragePosition.name, schema: LeveragePositionSchema },
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
  providers: [
    AssetLifecycleService,
    AssetProcessor,
    EigenDAService,
    {
      provide: MANTLE_ASSET_ORIGINATION_TOKEN,
      useClass: MantleAssetOriginationService,
    },
    {
      provide: STELLAR_ASSET_ORIGINATION_TOKEN,
      useClass: StellarAssetOriginationService,
    },
  ],
  exports: [
    AssetLifecycleService,
    EigenDAService,
    MANTLE_ASSET_ORIGINATION_TOKEN,
    STELLAR_ASSET_ORIGINATION_TOKEN,
  ],
})
export class AssetModule {}
