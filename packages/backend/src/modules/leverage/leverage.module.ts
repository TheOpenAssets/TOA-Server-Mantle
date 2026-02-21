import { Module, forwardRef, DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { LeveragePosition, LeveragePositionSchema } from '../../database/schemas/leverage-position.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { LeveragePositionService } from './services/leverage-position.service';
import { FluxionDEXService } from './services/fluxion-dex.service';
import { ArbitrumDEXService } from './services/arbitrum-dex.service';
import { LeverageBlockchainService } from './services/leverage-blockchain.service';
import { HarvestKeeperService } from './services/harvest-keeper.service';
import { HealthMonitorService } from './services/health-monitor.service';
import { LeverageController } from './controllers/leverage.controller';
import { LeverageAdminController } from './controllers/leverage-admin.controller';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuthModule } from '../auth/auth.module';
import { UserPortfolioModule } from '../user-portfolio/user-portfolio.module';
import { DEX_SERVICE, PRICE_SERVICE } from './leverage.constants';
import { MethPriceService } from '../blockchain/services/meth-price.service';
import { StArbPriceService } from '../blockchain/services/starb-price.service';

@Module({})
export class LeverageModule {
  static forRoot(): DynamicModule {
    // Determine network type at module initialization
    const networkType = process.env.NETWORK_TYPE || 'mantle';
    
    // Select DEX service based on network
    const dexServiceProvider = networkType === 'arbitrum' 
      ? ArbitrumDEXService 
      : FluxionDEXService;

    // Select price service based on network
    const priceServiceProvider = networkType === 'arbitrum'
      ? StArbPriceService
      : MethPriceService;

    return {
      module: LeverageModule,
      global: true, // Exports available app-wide without re-importing
      imports: [
        MongooseModule.forFeature([
          { name: LeveragePosition.name, schema: LeveragePositionSchema },
          { name: Asset.name, schema: AssetSchema },
        ]),
        ScheduleModule.forRoot(), // Enable cron jobs
        forwardRef(() => BlockchainModule),
        NotificationsModule,
        AuthModule, // For JwtAuthGuard
        UserPortfolioModule,
      ],
      controllers: [LeverageController, LeverageAdminController],
      providers: [
        LeveragePositionService,
        {
          provide: DEX_SERVICE,
          useClass: dexServiceProvider,
        },
        {
          provide: PRICE_SERVICE,
          useExisting: priceServiceProvider,
        },
        LeverageBlockchainService,
        HarvestKeeperService,
        HealthMonitorService,
      ],
      exports: [
        LeveragePositionService,
        DEX_SERVICE,
        PRICE_SERVICE,
        LeverageBlockchainService,
        HarvestKeeperService,
        HealthMonitorService,
      ],
    };
  }
}
