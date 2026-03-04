import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { UscEvent, UscEventSchema } from '@/src/database/schemas/usc-event.schema';
import { NotificationsModule } from '@/src/modules/notifications/notifications.module';
import { UscController } from './usc.controller';
import { UscProofService } from './usc-proof.service';
import { UscEventListenerService } from './usc-event-listener.service';
import { UscEventProcessor } from './usc-event.processor';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UscEvent.name, schema: UscEventSchema }]),
    BullModule.registerQueue({ name: 'usc-events' }),
    NotificationsModule,
  ],
  controllers: [UscController],
  providers: [UscProofService, UscEventListenerService, UscEventProcessor],
  exports: [UscProofService],
})
export class UscModule {}
