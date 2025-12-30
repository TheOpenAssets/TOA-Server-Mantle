import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { LeveragePositionService } from './services/leverage-position.service';
import { FluxionDEXService } from './services/fluxion-dex.service';
import { LeverageBlockchainService } from './services/leverage-blockchain.service';
import { HarvestKeeperService } from './services/harvest-keeper.service';
import { HealthMonitorService } from './services/health-monitor.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LeveragePosition.name, schema: LeveragePositionSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    ScheduleModule.forRoot(), // Enable cron jobs
    forwardRef(() => BlockchainModule),
    NotificationsModule,
  ],
  providers: [
    LeveragePositionService,
    FluxionDEXService,
    LeverageBlockchainService,
    HarvestKeeperService,
    HealthMonitorService,
  ],
  exports: [
    LeveragePositionService,
    FluxionDEXService,
    LeverageBlockchainService,
    HarvestKeeperService,
    HealthMonitorService,
  ],
})
export class LeverageModule {}
