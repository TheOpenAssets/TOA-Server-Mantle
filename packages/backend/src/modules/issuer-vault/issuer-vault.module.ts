import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import {
  IssuerVaultPosition,
  IssuerVaultPositionSchema,
} from '../../database/schemas/issuer-vault-position.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';
import { Settlement, SettlementSchema } from '../../database/schemas/settlement.schema';
import { IssuerVaultService } from './services/issuer-vault.service';
import { IssuerVaultEventProcessor } from './services/issuer-vault-event.processor';
import { IssuerVaultAdminController } from './controllers/issuer-vault-admin.controller';
import { IssuerVaultController } from './controllers/issuer-vault.controller';
import { OriginatorAssetGuard } from './guards/originator-asset.guard';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: IssuerVaultPosition.name, schema: IssuerVaultPositionSchema },
      { name: Asset.name, schema: AssetSchema },
      { name: Settlement.name, schema: SettlementSchema },
    ]),
    BullModule.registerQueue({ name: 'event-processing' }),
    BlockchainModule,
    AuthModule,
  ],
  controllers: [IssuerVaultAdminController, IssuerVaultController],
  providers: [IssuerVaultService, IssuerVaultEventProcessor, OriginatorAssetGuard],
  exports: [IssuerVaultService],
})
export class IssuerVaultModule {}
