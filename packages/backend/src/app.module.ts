import { Module, DynamicModule, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import blockchainConfig from './config/blockchain.config';
import networkConfig from './config/network.config';

import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './modules/redis/redis.module';
import { KycModule } from './modules/kyc/kyc.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { AssetModule } from './modules/assets/assets.module';
import { RegistryModule } from './modules/registry/registry.module';
import { YieldModule } from './modules/yield/yield.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ComplianceEngineModule } from './modules/compliance-engine/compliance-engine.module';
import { TypeformModule } from './modules/typeform/typeform.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { FaucetModule } from './modules/faucet/faucet.module';
import { LeverageModule } from './modules/leverage/leverage.module';
import { SolvencyModule } from './modules/solvency/solvency.module';
import { PartnersModule } from './modules/partners/partners.module';
import { ChangelogModule } from './modules/changelog/changelog.module';
import { SecondaryMarketModule } from './modules/secondary-market/secondary-market.module';
import { UserPortfolioModule } from './modules/user-portfolio/user-portfolio.module';
import { CreditScoreModule } from '@/src/modules/credit-score/credit-score.module';
import { UscModule } from '@/src/modules/usc/usc.module';

@Module({})
export class AppModule {
  static forRoot(): DynamicModule {
    // We need to read NETWORK_TYPE early to decide which modules to load.
    // However, ConfigService is only available after ConfigModule is loaded.
    // So we read from process.env directly here as a bootstrap step.
    const networkType = process.env.NETWORK_TYPE || 'mantle';
    const isMantle = networkType === 'mantle';
    const isArbitrum = networkType === 'arbitrum';

    const imports: any[] = [
      ConfigModule.forRoot({
        isGlobal: true,
        load: [databaseConfig, redisConfig, blockchainConfig, networkConfig],
      }),

      ScheduleModule.forRoot(),

      MongooseModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => ({
          uri: configService.get<string>('database.uri'),
          autoIndex: true,
        }),
      }),

      BullModule.forRootAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: (configService: ConfigService) => {
          const redis = configService.get<any>('redis');
          const commonOptions = {
            password: redis.password || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            retryStrategy: (times: number) => Math.min(times * 100, 3000),
            enableOfflineQueue: false,
            connectTimeout: 10000,
          };

          if (redis?.url) {
            return {
              connection: {
                ...commonOptions,
                url: redis.url,
                tls: redis.tls,
              },
            };
          }

          return {
            connection: {
              ...commonOptions,
              host: redis.host,
              port: redis.port,
            },
          };
        },
      }),

      RedisModule,
      AuthModule,
      KycModule,
      BlockchainModule.forRoot(),
      RegistryModule,
      AssetModule,
      AdminModule,
      NotificationsModule,
      ComplianceEngineModule,
      TypeformModule,
      ChangelogModule,
      AnnouncementsModule,
      YieldModule, // Enabled on both initially
      MarketplaceModule, // Enabled on both initially
      UserPortfolioModule,
      CreditScoreModule,
      UscModule,
    ];

    // Conditional Modules
    // Leverage and SecondaryMarket are available on both Mantle and Arbitrum
    if (isMantle || isArbitrum) {
      imports.push(
        LeverageModule.forRoot(),
        SecondaryMarketModule,
      );
    }

    // Mantle-only modules
    if (isMantle) {
      imports.push(
        FaucetModule,
        SolvencyModule,
        PartnersModule,
      );
    }

    return {
      module: AppModule,
      imports,
      controllers: [AppController],
      providers: [AppService],
    };
  }
}