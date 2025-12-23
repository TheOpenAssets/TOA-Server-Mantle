import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import blockchainConfig from '../../config/blockchain.config';
import { BlockchainService } from './services/blockchain.service';
import { WalletService } from './services/wallet.service';
import { ContractLoaderService } from './services/contract-loader.service';
import { EventListenerService } from './services/event-listener.service';
import { EventProcessor } from './processors/event.processor';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { YieldModule } from '../yield/yield.module';

@Global()
@Module({
  imports: [
    ConfigModule.forFeature(blockchainConfig),
    MongooseModule.forFeature([
      { name: Asset.name, schema: AssetSchema },
      { name: User.name, schema: UserSchema },
    ]),
    BullModule.registerQueue({
      name: 'event-processing',
    }),
    YieldModule,
  ],
  providers: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
    EventProcessor,
  ],
  exports: [
    BlockchainService,
    WalletService,
    ContractLoaderService,
    EventListenerService,
  ],
})
export class BlockchainModule {}
