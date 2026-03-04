import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { AnnouncementType, AnnouncementStatus } from '@openassets/types';

export type AnnouncementDocument = Announcement & Document;

@Schema({ timestamps: true })
export class Announcement {
  @Prop({ required: true, unique: true })
  announcementId!: string;

  @Prop({ required: true })
  assetId!: string; // Reference to Asset

  @Prop({ required: true, enum: AnnouncementType, type: String })
  type!: AnnouncementType;

  @Prop({ required: true })
  title!: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ required: true, enum: AnnouncementStatus, default: AnnouncementStatus.ACTIVE, type: String })
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
