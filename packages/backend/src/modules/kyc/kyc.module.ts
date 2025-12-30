import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { KycController } from './controllers/kyc.controller';
import { KycService } from './services/kyc.service';
import { DocumentStorageService } from './services/document-storage.service';
import { VerificationProcessor } from './processors/verification.processor';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    BullModule.registerQueue({
      name: 'kyc-verification',
    }),
    forwardRef(() => BlockchainModule),
    NotificationsModule,
  ],
  controllers: [KycController],
  providers: [
      KycService,
      DocumentStorageService,
      VerificationProcessor
  ],
})
export class KycModule {}
