import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NotificationType, NotificationSeverity } from '../enums/notification-type.enum';
import { NotificationAction } from '../enums/notification-action.enum';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  header: string;

  @Prop({ required: true })
  detail: string;

  @Prop({ required: true, enum: NotificationType })
  type: NotificationType;

  @Prop({ required: true, enum: NotificationSeverity, default: NotificationSeverity.INFO })
  severity: NotificationSeverity;

  @Prop({ required: true, enum: NotificationAction, default: NotificationAction.NONE })
  action: NotificationAction;

  @Prop({ type: Object })
  actionMetadata?: Record<string, any>;

  @Prop()
  icon?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
