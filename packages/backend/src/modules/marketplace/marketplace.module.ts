import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceController } from './controllers/marketplace.controller';
import { PurchaseTrackerService } from './services/purchase-tracker.service';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Purchase.name, schema: PurchaseSchema },
    ]),
    BlockchainModule,
  ],
  controllers: [MarketplaceController],
  providers: [PurchaseTrackerService],
  exports: [PurchaseTrackerService],
})
export class MarketplaceModule {}
