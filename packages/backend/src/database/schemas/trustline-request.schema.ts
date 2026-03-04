import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TrustlineRequestDocument = TrustlineRequest & Document;

export enum TrustlineRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class TrustlineRequest {
  @Prop({ required: true, unique: true, index: true })
  requestId!: string; // UUID

  @Prop({ required: true, index: true })
  investorAddress!: string; // Stellar address

  @Prop({ required: true, index: true })
  assetId!: string; // Asset UUID

  @Prop({ required: true })
  assetCode!: string; // Stellar asset code

  @Prop({ required: true })
  issuerAddress!: string; // Stellar issuer address

  @Prop({ required: true })
  network!: string; // 'stellar'

  @Prop({ required: true })
  trustlineTransactionHash!: string; // Transaction hash from investor's changeTrust operation

  @Prop()
  blockNumber?: string; // Optional block/ledger number

  @Prop({ required: true, enum: TrustlineRequestStatus, default: TrustlineRequestStatus.PENDING, index: true })
  status!: TrustlineRequestStatus;

  @Prop()
  reviewedBy?: string; // Admin wallet address

  @Prop()
  reviewedAt?: Date;

  @Prop()
  approvalTransactionHash?: string; // Transaction hash from admin's approval operation

  @Prop()
  rejectionReason?: string;

  // Timestamps (automatically added by Mongoose)
  createdAt?: Date;
  updatedAt?: Date;
}

export const TrustlineRequestSchema = SchemaFactory.createForClass(TrustlineRequest);

// Indexes
TrustlineRequestSchema.index({ requestId: 1 }, { unique: true });
TrustlineRequestSchema.index({ investorAddress: 1 });
TrustlineRequestSchema.index({ assetId: 1 });
TrustlineRequestSchema.index({ status: 1 });
TrustlineRequestSchema.index({ createdAt: -1 });
TrustlineRequestSchema.index({ investorAddress: 1, assetId: 1 }); // Compound for duplicate detection
