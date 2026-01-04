import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PrivateAssetRequestDocument = PrivateAssetRequest & Document;

export enum PrivateAssetRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export enum PrivateAssetType {
  DEED = 'DEED',
  BOND = 'BOND',
  INVOICE = 'INVOICE',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

@Schema({ timestamps: true })
export class PrivateAssetRequest {
  @Prop({ required: true })
  requestId!: string; // UUID

  @Prop({ required: true })
  requesterAddress!: string; // User wallet address (INVESTOR or ORIGINATOR)

  @Prop({ required: true })
  requesterRole!: string; // INVESTOR or ORIGINATOR

  // Asset details provided by user
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  assetType!: PrivateAssetType;

  @Prop()
  location?: string;

  @Prop({ required: true })
  claimedValuation!: string; // User's claimed valuation in USD (6 decimals)

  @Prop({ required: true })
  documentHash!: string; // IPFS hash of deed/bond/invoice documents

  @Prop()
  documentUrl?: string; // Optional direct URL to documents

  @Prop()
  description?: string; // User's description of the asset

  // Admin review
  @Prop({ required: true, enum: PrivateAssetRequestStatus, default: PrivateAssetRequestStatus.PENDING })
  status!: PrivateAssetRequestStatus;

  @Prop()
  finalValuation?: string; // Admin's final approved valuation (6 decimals)

  @Prop()
  reviewedBy?: string; // Admin wallet address

  @Prop()
  reviewedAt?: Date;

  @Prop()
  rejectionReason?: string;

  // After approval - minted token details
  @Prop()
  tokenAddress?: string; // PrivateAssetToken contract address

  @Prop()
  tokenSymbol?: string; // Generated symbol (e.g., DEED-001)

  @Prop()
  assetId?: string; // bytes32 assetId after minting

  @Prop()
  mintTransactionHash?: string;

  @Prop()
  solvencyPositionId?: number; // Position ID after deposit to vault

  @Prop()
  depositTransactionHash?: string;

  // Metadata
  @Prop({ type: Object })
  metadata?: {
    fileSize?: number;
    fileType?: string;
    additionalNotes?: string;
  };

  // Timestamps (automatically added by Mongoose)
  createdAt?: Date;
  updatedAt?: Date;
}

export const PrivateAssetRequestSchema = SchemaFactory.createForClass(PrivateAssetRequest);

// Indexes for efficient queries
PrivateAssetRequestSchema.index({ requestId: 1 }, { unique: true });
PrivateAssetRequestSchema.index({ requesterAddress: 1 });
PrivateAssetRequestSchema.index({ status: 1 });
PrivateAssetRequestSchema.index({ assetType: 1 });
PrivateAssetRequestSchema.index({ createdAt: -1 });
