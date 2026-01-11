import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { SolvencyController } from './controllers/solvency.controller';
import { SolvencyAdminController } from './controllers/solvency-admin.controller';
import { SolvencyBlockchainService } from './services/solvency-blockchain.service';
import { SolvencyPositionService } from './services/solvency-position.service';
import { PrivateAssetService } from './services/private-asset.service';
import { RepaymentMonitorService } from './services/repayment-monitor.service';
import { SolvencyPosition, SolvencyPositionSchema } from '../../database/schemas/solvency-position.schema';
import { PrivateAsset, PrivateAssetSchema } from '../../database/schemas/private-asset.schema';
import { PrivateAssetRequest, PrivateAssetRequestSchema } from '../../database/schemas/private-asset-request.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { LeverageModule } from '../leverage/leverage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PartnersModule } from '../partners/partners.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SolvencyPosition.name, schema: SolvencyPositionSchema },
      { name: PrivateAsset.name, schema: PrivateAssetSchema },
      { name: PrivateAssetRequest.name, schema: PrivateAssetRequestSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    ScheduleModule.forRoot(),
    forwardRef(() => BlockchainModule),
    LeverageModule, // For liquidating leverage positions via admin controller
    NotificationsModule,
    forwardRef(() => PartnersModule), // For accessing PartnerLoanService (circular dependency)
  ],
  controllers: [SolvencyController, SolvencyAdminController],
  providers: [
    SolvencyBlockchainService,
    SolvencyPositionService,
    PrivateAssetService,
    RepaymentMonitorService,
  ],
  exports: [SolvencyPositionService, SolvencyBlockchainService, PrivateAssetService],
})
export class SolvencyModule {}
