import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationService } from './services/notification.service';
import { SseEmitterService } from './services/sse-emitter.service';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { UserNotification, UserNotificationSchema } from './schemas/user-notification.schema';
import { AuthModule } from '../auth/auth.module';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: UserNotification.name, schema: UserNotificationSchema },
    ]),
    AuthModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationService, SseEmitterService],
  exports: [NotificationService, SseEmitterService],
})
export class NotificationsModule {}
