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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, blockchainConfig],
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('database.uri'),
      }),
      inject: [ConfigService],
    }),
    BullModule.forRootAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
            connection: {
                host: configService.get('redis.host'),
                port: configService.get('redis.port'),
            }
        }),
        inject: [ConfigService],
    }),
    RedisModule,
    AuthModule,
    KycModule,
    BlockchainModule,
    AssetModule,
    YieldModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}