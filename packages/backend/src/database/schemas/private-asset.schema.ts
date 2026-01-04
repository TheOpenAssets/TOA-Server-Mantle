import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PrivateAssetDocument = PrivateAsset & Document;

export enum PrivateAssetType {
  DEED = 'DEED',
  BOND = 'BOND',
  INVOICE = 'INVOICE',
  EQUIPMENT = 'EQUIPMENT',
  OTHER = 'OTHER',
}

@Schema({ timestamps: true })
export class PrivateAsset {
  @Prop({ required: true, unique: true, index: true })
  assetId!: string; // bytes32 on-chain identifier

  @Prop({ required: true, unique: true, index: true })
  tokenAddress!: string; // PrivateAssetToken contract address

  @Prop({ required: true, enum: PrivateAssetType })
  assetType!: PrivateAssetType;

  @Prop({ required: true })
  name!: string; // Token name (e.g., "Property Deed #123")

  @Prop({ required: true })
  symbol!: string; // Token symbol (e.g., "DEED123")

  @Prop({ required: true })
  totalSupply!: string; // Wei (18 decimals), usually 1e18 for whole asset

  @Prop({ required: true })
  valuation!: string; // USD value (6 decimals)

  @Prop({ required: true })
  valuationDate!: Date; // When valuation was set/updated

  @Prop({ type: String })
  location?: string; // Physical location/jurisdiction

  @Prop({ type: String })
  documentHash?: string; // IPFS hash for legal documents

  @Prop({ required: true, index: true })
  issuer!: string; // Issuer wallet address

  @Prop({ required: true, default: true })
  isActive!: boolean;

  // Deployment details
  @Prop({ required: true })
  deploymentTxHash!: string;

  @Prop({ type: Number })
  deploymentBlockNumber?: number;

  @Prop({ required: true })
  complianceModuleAddress!: string;

  // Valuation history
  @Prop({
    type: [
      {
        valuation: String,
        valuationDate: Date,
        updatedBy: String,
        updateTxHash: String,
      },
    ],
    default: [],
  })
  valuationHistory?: Array<{
    valuation: string;
    valuationDate: Date;
    updatedBy: string;
    updateTxHash?: string;
  }>;

  // Usage tracking
  @Prop({ type: Number, default: 0 })
  activeSolvencyPositions!: number; // Count of positions using this asset

  @Prop({ type: String, default: '0' })
  totalCollateralLocked!: string; // Total tokens locked in SolvencyVault

  @Prop({ type: String, default: '0' })
  totalUsdcBorrowed!: string; // Total USDC borrowed against this asset

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

export const PrivateAssetSchema = SchemaFactory.createForClass(PrivateAsset);

// Indexes for efficient queries
PrivateAssetSchema.index({ issuer: 1, isActive: 1 }); // Issuer's active assets
PrivateAssetSchema.index({ assetType: 1, isActive: 1 }); // Assets by type
PrivateAssetSchema.index({ createdAt: -1 }); // Recent assets
