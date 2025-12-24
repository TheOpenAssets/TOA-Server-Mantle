import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MarketplaceController } from './controllers/marketplace.controller';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
    ]),
  ],
  controllers: [MarketplaceController],
})
export class MarketplaceModule {}
