import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeformController } from './controllers/typeform.controller';
import { TypeformWebhookService } from './services/typeform-webhook.service';
import { TypeformSignatureService } from './services/typeform-signature.service';
import { User, UserSchema } from '../../database/schemas/user.schema';
import { AssetModule } from '../assets/assets.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    AssetModule,
  ],
  controllers: [TypeformController],
  providers: [TypeformWebhookService, TypeformSignatureService],
})
export class TypeformModule {}
