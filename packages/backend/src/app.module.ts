import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import blockchainConfig from './config/blockchain.config';

import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './modules/redis/redis.module';
import { KycModule } from './modules/kyc/kyc.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { AssetModule } from './modules/assets/assets.module';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, blockchainConfig],
    }),

    ScheduleModule.forRoot(),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
        // Automatically try to create indexes defined in schemas
        autoIndex: true,
      }),
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<any>('redis');

        // Centralized connection options to avoid NOAUTH and connection issues
        const commonOptions = {
          // Ensure password is null/undefined if not explicitly set to avoid NOAUTH on open connections
          password: redis.password || undefined,
          // Prevent the app from hanging/crashing if Redis is down at boot
          maxRetriesPerRequest: null,
          enableReadyCheck: false,
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 100, 3000);
            return delay;
          },
          // Limit connections to avoid "max number of clients reached" error
          // This is crucial for Redis Cloud free tier (30 connection limit)
          enableOfflineQueue: false,
          connectTimeout: 10000,
        };

        // Redis Cloud / Railway / Production (URL based)
        if (redis?.url) {
          return {
            connection: {
              ...commonOptions,
              url: redis.url,
              tls: redis.tls,
            },
          };
        }

        // Local development / Docker (Host/Port based)
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
    BlockchainModule,
    AssetModule,
    YieldModule,
    AdminModule,
    NotificationsModule,
    ComplianceEngineModule,
    TypeformModule,
    MarketplaceModule,
    AnnouncementsModule,
    FaucetModule,
    LeverageModule,
    SolvencyModule,
    ChangelogModule,
    SecondaryMarketModule,
    PartnersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }