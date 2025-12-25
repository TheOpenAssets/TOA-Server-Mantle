import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ComplianceRequestDocument = ComplianceRequest & Document;

export enum ComplianceRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class ComplianceRequest {
  @Prop({ required: true, index: true })
  assetId!: string; // Which asset they want to buy

  @Prop({ required: true, index: true })
  tokenAddress!: string; // Token contract address

  @Prop({ required: true, index: true })
  investorAddress!: string; // Wallet requesting access

  @Prop({ required: true })
  requestedAmount!: string; // How many tokens they want to buy (for context)

  @Prop({ required: true, enum: ComplianceRequestStatus, default: ComplianceRequestStatus.PENDING })
  status!: ComplianceRequestStatus;

  @Prop()
  investorEmail?: string; // Optional email for notifications

  @Prop()
  investorName?: string; // Optional name

  @Prop({ type: Object })
  investorDetails?: {
    country?: string;
    kycDocuments?: string[]; // URLs or references to KYC docs
    reason?: string; // Why they want to buy
  };

  @Prop()
  reviewedBy?: string; // Admin wallet who reviewed

  @Prop()
  reviewedAt?: Date;

  @Prop()
  rejectionReason?: string;

  @Prop()
  approvalTxHash?: string; // Transaction hash of IdentityRegistry registration

  @Prop()
  expiresAt?: Date; // Optional expiry for the request
}

export const ComplianceRequestSchema = SchemaFactory.createForClass(ComplianceRequest);

// Indexes for efficient querying
ComplianceRequestSchema.index({ status: 1, createdAt: -1 });
ComplianceRequestSchema.index({ investorAddress: 1, tokenAddress: 1 });
ComplianceRequestSchema.index({ assetId: 1, status: 1 });
