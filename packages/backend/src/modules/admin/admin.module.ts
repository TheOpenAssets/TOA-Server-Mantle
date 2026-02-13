import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AssetModule } from '../assets/assets.module';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { YieldModule } from '../yield/yield.module';
import { LeverageModule } from '../leverage/leverage.module';
import { ComplianceController } from './controllers/compliance.controller';
import { AssetOpsController } from './controllers/asset-ops.controller';
import { YieldOpsController } from './controllers/yield-ops.controller';
import { AdminController } from './controllers/admin.controller';
import { SyncController } from './controllers/sync.controller';
import { AdminService } from './services/admin.service';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RegistryModule } from '../registry/registry.module';
import { MantleAdminStrategy } from './implementations/mantle/mantle-admin-strategy.service';
import { StellarAdminStrategy } from './implementations/stellar/stellar-admin-strategy.service';
import { MANTLE_ADMIN_STRATEGY_TOKEN, STELLAR_ADMIN_STRATEGY_TOKEN } from '../registry/registry.constants';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    AssetModule,
    BlockchainModule,
    YieldModule,
    LeverageModule,
    AuthModule,
    MarketplaceModule,
    NotificationsModule,
    RegistryModule,
  ],
  controllers: [
    AdminController,
    ComplianceController,
    AssetOpsController,
    YieldOpsController,
    SyncController,
  ],
  providers: [
    AdminService,
    {
      provide: MANTLE_ADMIN_STRATEGY_TOKEN,
      useClass: MantleAdminStrategy,
    },
    {
      provide: STELLAR_ADMIN_STRATEGY_TOKEN,
      useClass: StellarAdminStrategy,
    },
  ],
  exports: [
    MANTLE_ADMIN_STRATEGY_TOKEN,
    STELLAR_ADMIN_STRATEGY_TOKEN,
  ],
})
export class AdminModule {}
