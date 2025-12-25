import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceController } from './controllers/marketplace.controller';
import { PurchaseTrackerService } from './services/purchase-tracker.service';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { AuctionService } from './services/auction.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Bid.name, schema: BidSchema },
    ]),
    BlockchainModule,
  ],
  controllers: [MarketplaceController],
  providers: [PurchaseTrackerService, AuctionService],
  exports: [AuctionService],
})
export class MarketplaceModule {}
