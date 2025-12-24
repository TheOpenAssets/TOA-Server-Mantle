import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetModule } from '../assets/assets.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { YieldModule } from '../yield/yield.module';
import { ComplianceController } from './controllers/compliance.controller';
import { AssetOpsController } from './controllers/asset-ops.controller';
import { YieldOpsController } from './controllers/yield-ops.controller';
import { AdminController } from './controllers/admin.controller';
import { AdminService } from './services/admin.service';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    AssetModule,
    BlockchainModule,
    YieldModule,
    AuthModule,
  ],
  controllers: [
    AdminController,
    ComplianceController,
    AssetOpsController,
    YieldOpsController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
