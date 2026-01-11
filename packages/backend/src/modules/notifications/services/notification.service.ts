import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from '../schemas/notification.schema';
import { UserNotification, UserNotificationDocument } from '../schemas/user-notification.schema';
import { SseEmitterService } from './sse-emitter.service';
import { CreateNotificationDto } from '../dto/create-notification.dto';
import { NotificationType, NotificationSeverity } from '../enums/notification-type.enum';
import { NotificationAction } from '../enums/notification-action.enum';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
    @InjectModel(UserNotification.name) private userNotificationModel: Model<UserNotificationDocument>,
    private sseService: SseEmitterService,
  ) {}

  async create(dto: CreateNotificationDto) {
    try {
      // Normalize wallet addresses to lowercase for case-insensitive matching
      const normalizedUserId = dto.userId.toLowerCase();
      const normalizedWallet = dto.walletAddress.toLowerCase();

      // 1. Create Base Notification
      const notification = await this.notificationModel.create({
        header: dto.header,
        detail: dto.detail,
        type: dto.type,
        severity: dto.severity || NotificationSeverity.INFO,
        action: dto.action || NotificationAction.NONE,
        actionMetadata: dto.actionMetadata,
        icon: this.getIconByType(dto.type),
      });

      // 2. Link to User
      await this.userNotificationModel.updateOne(
        { userId: normalizedUserId },
        {
          $setOnInsert: { walletAddress: normalizedWallet },
          $push: {
            notifications: {
              $each: [{ notificationId: notification._id, read: false, receivedAt: new Date() }],
              $position: 0, // Add to top
            },
          },
          $inc: { 'meta.unreadCount': 1, 'meta.totalCount': 1 },
        },
        { upsert: true }
      );

      // 3. Emit SSE (use normalized wallet address)
      this.logger.log(`[SSE] Emitting notification to wallet: ${normalizedWallet}`);
      this.logger.log(`[SSE] Original wallet: ${dto.walletAddress}`);
      this.logger.log(`[SSE] Notification type: ${dto.type}, header: ${dto.header}`);

      this.sseService.emitToUser(normalizedWallet, 'notification', {
        id: notification._id,
        walletAddress: dto.walletAddress, // User wallet address (to whom this event is meant for)
        summary: dto.header, // One-liner summary of the notification
        header: dto.header,
        detail: dto.detail,
        severity: dto.severity,
        type: dto.type,
        action: dto.action || NotificationAction.NONE,
        actionMetadata: dto.actionMetadata,
        timestamp: new Date(),
      });

      return notification;
    } catch (e: any) {
      this.logger.error(`Failed to create notification for ${dto.userId}: ${e.message}`, e.stack);
      // Don't re-throw - let caller handle gracefully
      return null;
    }
  }

  async getNotifications(userId: string, filter: 'all' | 'read' | 'unread' = 'all', limit = 20, offset = 0) {
    // Normalize wallet address to lowercase for case-insensitive matching
    const normalizedUserId = userId.toLowerCase();
    const userNotifs = await this.userNotificationModel.findOne({ userId: normalizedUserId });
    if (!userNotifs) return { notifications: [], meta: { unreadCount: 0, totalCount: 0 } };

    let items = userNotifs.notifications;

    if (filter === 'unread') items = items.filter(n => !n.read);
    else if (filter === 'read') items = items.filter(n => n.read);

    const slice = items.slice(offset, offset + limit);
    
    // Populate details manually or via populate if schema supports it directly
    // Manual approach gives more control
    const ids = slice.map(i => i.notificationId);
    const details = await this.notificationModel.find({ _id: { $in: ids } });

    const result = slice.map(item => {
      const detail = details.find(d => d._id.toString() === item.notificationId.toString());
      return {
        ...detail?.toObject(),
        read: item.read,
        readAt: item.readAt,
        receivedAt: item.receivedAt,
      };
    });

    return {
      notifications: result,
      meta: userNotifs.meta,
    };
  }

  async getNotificationById(userId: string, notificationId: string) {
    // Normalize wallet address to lowercase for case-insensitive matching
    const normalizedUserId = userId.toLowerCase();
    const userNotifs = await this.userNotificationModel.findOne({ userId: normalizedUserId });
    if (!userNotifs) {
      throw new Error('User notifications not found');
    }

    // Find the notification in user's list to verify ownership
    const userNotif = userNotifs.notifications.find(
      n => n.notificationId.toString() === notificationId
    );

    if (!userNotif) {
      throw new Error('Notification not found or access denied');
    }

    // Fetch the full notification details
    const notification = await this.notificationModel.findById(notificationId);
    if (!notification) {
      throw new Error('Notification details not found');
    }

    return {
      ...notification.toObject(),
      read: userNotif.read,
      readAt: userNotif.readAt,
      receivedAt: userNotif.receivedAt,
    };
  }

  async markAsRead(userId: string, notificationId: string) {
    // Normalize wallet address to lowercase for case-insensitive matching
    const normalizedUserId = userId.toLowerCase();
    const userNotifs = await this.userNotificationModel.findOne({ userId: normalizedUserId });
    if (!userNotifs) return;

    const item = userNotifs.notifications.find(n => n.notificationId.toString() === notificationId);
    if (item && !item.read) {
      item.read = true;
      item.readAt = new Date();
      userNotifs.meta.unreadCount = Math.max(0, userNotifs.meta.unreadCount - 1);
      await userNotifs.save();
    }
  }

  async markAllRead(userId: string) {
    // Normalize wallet address to lowercase for case-insensitive matching
    const normalizedUserId = userId.toLowerCase();
    await this.userNotificationModel.updateOne(
      { userId: normalizedUserId },
      {
        $set: {
            'notifications.$[elem].read': true,
            'notifications.$[elem].readAt': new Date(),
            'meta.unreadCount': 0
        },
      },
      { arrayFilters: [{ 'elem.read': false }] }
    );
  }

  private getIconByType(type: NotificationType): string {
    switch (type) {
        case NotificationType.ASSET_STATUS: return 'file-document-check';
        case NotificationType.YIELD_DISTRIBUTED: return 'cash-multiple';
        case NotificationType.KYC_STATUS: return 'account-check';
        case NotificationType.TOKEN_PURCHASED: return 'shopping';
        case NotificationType.BID_PLACED: return 'gavel';
        case NotificationType.AUCTION_WON: return 'trophy';
        case NotificationType.BID_REFUNDED: return 'cash-refund';
        case NotificationType.ORDER_CREATED: return 'plus-circle';
        case NotificationType.ORDER_FILLED: return 'check-circle';
        case NotificationType.ORDER_CANCELLED: return 'close-circle';
        default: return 'bell';
    }
  }
}
