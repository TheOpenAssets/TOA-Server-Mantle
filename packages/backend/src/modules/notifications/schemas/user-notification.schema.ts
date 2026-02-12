import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { WalletAddress } from '@mantle/types';

export type UserNotificationDocument = UserNotification & Document;

@Schema()
class NotificationItem {
  @Prop({ type: Types.ObjectId, ref: 'Notification', required: true })
  notificationId!: Types.ObjectId; // Stores reference, usually populated

  @Prop({ default: false })
  read!: boolean;

  @Prop()
  readAt?: Date;

  @Prop({ default: Date.now })
  receivedAt!: Date;
}

const NotificationItemSchema = SchemaFactory.createForClass(NotificationItem);

@Schema({ timestamps: true })
export class UserNotification {
  @Prop({ required: true, index: true, unique: true })
  userId!: string; // Reference to User ID string from auth

  @Prop({ required: true, index: true })
  walletAddress!: WalletAddress;

  @Prop({ type: [NotificationItemSchema], default: [] })
  notifications!: NotificationItem[];

  @Prop({
    type: Object,
    default: {
      unreadCount: 0,
      totalCount: 0,
    },
  })
  meta!: {
    unreadCount: number;
    totalCount: number;
  };
}

export const UserNotificationSchema = SchemaFactory.createForClass(UserNotification);