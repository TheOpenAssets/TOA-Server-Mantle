import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AssetsController } from './controllers/assets.controller';
import { AssetLifecycleService } from './services/asset-lifecycle.service';
import { EigenDAService } from './services/eigenda.service';
import { AssetProcessor } from './processors/asset.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { AuthModule } from '../auth/auth.module'; // For JwtAuthGuard

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Asset.name, schema: AssetSchema }]),
    BullModule.registerQueue({
      name: 'asset-processing',
    }),
    AuthModule,
  ],
  controllers: [AssetsController],
  providers: [AssetLifecycleService, AssetProcessor, EigenDAService],
  exports: [AssetLifecycleService, EigenDAService],
})
export class AssetModule {}
