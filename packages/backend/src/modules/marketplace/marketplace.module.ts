import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceController } from './controllers/marketplace.controller';
import { PurchaseTrackerService } from './services/purchase-tracker.service';
import { BidTrackerService } from './services/bid-tracker.service';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Bid, BidSchema } from '../../database/schemas/bid.schema';
import { Purchase, PurchaseSchema } from '../../database/schemas/purchase.schema';
import { AuctionService } from './services/auction.service';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: Bid.name, schema: BidSchema },
      { name: Purchase.name, schema: PurchaseSchema },
    ]),
    BlockchainModule,
  ],
  controllers: [MarketplaceController],
  providers: [PurchaseTrackerService, BidTrackerService, AuctionService],
  exports: [AuctionService],
})
export class MarketplaceModule {}
