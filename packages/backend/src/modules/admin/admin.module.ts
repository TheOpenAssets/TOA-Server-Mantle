import { Module } from '@nestjs/common';
import { AssetModule } from '../assets/assets.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { YieldModule } from '../yield/yield.module';
import { ComplianceController } from './controllers/compliance.controller';
import { AssetOpsController } from './controllers/asset-ops.controller';
import { YieldOpsController } from './controllers/yield-ops.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    AssetModule,
    BlockchainModule,
    YieldModule,
    AuthModule,
  ],
  controllers: [
    ComplianceController,
    AssetOpsController,
    YieldOpsController,
  ],
})
export class AdminModule {}
