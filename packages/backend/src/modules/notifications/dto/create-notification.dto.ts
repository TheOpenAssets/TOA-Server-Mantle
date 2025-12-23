import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject } from 'class-validator';
import { NotificationType, NotificationSeverity } from '../enums/notification-type.enum';
import { NotificationAction } from '../enums/notification-action.enum';

export class CreateNotificationDto {
  @IsString()
  @IsNotEmpty()
  userId: string; // Internal User ID

  @IsString()
  @IsNotEmpty()
  walletAddress: string;

  @IsString()
  @IsNotEmpty()
  header: string;

  @IsString()
  @IsNotEmpty()
  detail: string;

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsEnum(NotificationSeverity)
  @IsOptional()
  severity?: NotificationSeverity;

  @IsEnum(NotificationAction)
  @IsOptional()
  action?: NotificationAction;

  @IsObject()
  @IsOptional()
  actionMetadata?: Record<string, any>;
}
