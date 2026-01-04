import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SolvencyController } from './controllers/solvency.controller';
import { SolvencyAdminController } from './controllers/solvency-admin.controller';
import { SolvencyBlockchainService } from './services/solvency-blockchain.service';
import { SolvencyPositionService } from './services/solvency-position.service';
import { PrivateAssetService } from './services/private-asset.service';
import { SolvencyPosition, SolvencyPositionSchema } from '../../database/schemas/solvency-position.schema';
import { PrivateAsset, PrivateAssetSchema } from '../../database/schemas/private-asset.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SolvencyPosition.name, schema: SolvencyPositionSchema },
      { name: PrivateAsset.name, schema: PrivateAssetSchema },
    ]),
    forwardRef(() => BlockchainModule),
  ],
  controllers: [SolvencyController, SolvencyAdminController],
  providers: [
    SolvencyBlockchainService,
    SolvencyPositionService,
    PrivateAssetService,
  ],
  exports: [
    SolvencyBlockchainService,
    SolvencyPositionService,
    PrivateAssetService,
  ],
})
export class SolvencyModule {}
