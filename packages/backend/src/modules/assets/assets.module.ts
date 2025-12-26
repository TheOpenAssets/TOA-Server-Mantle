import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AssetsController } from './controllers/assets.controller';
import { AssetLifecycleService } from './services/asset-lifecycle.service';
import { EigenDAService } from './services/eigenda.service';
import { AssetProcessor } from './processors/asset.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { AuthModule } from '../auth/auth.module'; // For JwtAuthGuard
import { ComplianceEngineModule } from '../compliance-engine/compliance-engine.module';
import { AnnouncementsModule } from '../announcements/announcements.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Bid.name, schema: BidSchema },
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
  ],
  controllers: [AssetsController],
  providers: [AssetLifecycleService, AssetProcessor, EigenDAService],
  exports: [AssetLifecycleService, EigenDAService],
})
export class AssetModule {}
