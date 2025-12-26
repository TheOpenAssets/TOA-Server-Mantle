import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AnnouncementDocument = Announcement & Document;

export enum AnnouncementType {
  AUCTION_SCHEDULED = 'AUCTION_SCHEDULED',
  AUCTION_LIVE = 'AUCTION_LIVE',
  AUCTION_FAILED = 'AUCTION_FAILED',
  AUCTION_ENDED = 'AUCTION_ENDED',
  ASSET_LISTED = 'ASSET_LISTED',
}

export enum AnnouncementStatus {
  ACTIVE = 'ACTIVE',
  ARCHIVED = 'ARCHIVED',
}

@Schema({ timestamps: true })
export class Announcement {
  @Prop({ required: true, unique: true })
  announcementId!: string;

  @Prop({ required: true })
  assetId!: string; // Reference to Asset

  @Prop({ required: true, enum: AnnouncementType })
  type!: AnnouncementType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ required: true, enum: AnnouncementStatus, default: AnnouncementStatus.ACTIVE })
  status!: AnnouncementStatus;

  @Prop({ type: Object })
  metadata!: {
    invoiceNumber?: string;
    faceValue?: string;
    totalSupply?: string;
    priceRange?: {
      min: string;
      max: string;
    };
    auctionStartTime?: Date;
    auctionEndTime?: Date;
    duration?: number; // in seconds
    industry?: string;
    riskTier?: string;
    failureReason?: string;
  };

  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const AnnouncementSchema = SchemaFactory.createForClass(Announcement);
