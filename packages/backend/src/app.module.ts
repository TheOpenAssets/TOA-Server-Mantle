import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, blockchainConfig],
    }),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
      }),
    }),

    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const redis = configService.get<any>('redis');

        // Redis Cloud / Railway (TLS)
        if (redis?.url) {
          return {
            connection: {
              url: redis.url,
              tls: redis.tls,
            },
          };
        }

        // Local development (no TLS)
        return {
          connection: {
            host: redis.host,
            port: redis.port,
            password: redis.password,
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
