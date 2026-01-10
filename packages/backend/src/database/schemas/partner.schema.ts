import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerDocument = Partner & Document;

export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export enum PartnerTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
}

@Schema({ timestamps: true })
export class Partner {
  // Identifiers
  @Prop({ required: true, unique: true, index: true })
  partnerId!: string;                 // UUID, unique partner identifier

  @Prop({ required: true })
  partnerName!: string;               // "XYZ Lending", "ABC Finance"

  // Authentication
  @Prop({ required: true, unique: true, index: true })
  apiKey!: string;                    // SHA-256 hashed API key (never store plaintext!)

  @Prop({ required: true })
  apiKeyPrefix!: string;              // First 8 chars for identification (e.g., "pk_live_")

  @Prop()
  publicKey?: string;                 // Optional: Partner's Ethereum address

  // Configuration
  @Prop({ required: true, enum: PartnerStatus, default: PartnerStatus.ACTIVE })
  status!: PartnerStatus;

  @Prop({ required: true, enum: PartnerTier, default: PartnerTier.BASIC })
  tier!: PartnerTier;

  // Limits & Quotas (all in 6 decimals - USDC format)
  @Prop({ required: true })
  dailyBorrowLimit!: string;          // Max USDC per day

  @Prop({ required: true })
  totalBorrowLimit!: string;          // Max outstanding USDC

  @Prop({ required: true, default: '0' })
  currentOutstanding!: string;        // Current borrowed amount

  // Financial Terms
  @Prop({ required: true, default: 50 })
  platformFeePercentage!: number;     // Basis points (e.g., 50 = 0.5%)

  @Prop({ required: true })
  settlementAddress!: string;         // Where to send/receive USDC

  // Webhook Integration (Optional)
  @Prop()
  webhookUrl?: string;                // For notifications

  @Prop()
  webhookSecret?: string;             // HMAC secret for webhook verification

  // Metadata
  @Prop({ required: true })
  contactEmail!: string;

  @Prop()
  contactWallet?: string;

  @Prop({ default: false })
  kycVerified!: boolean;

  @Prop({ default: false })
  contractSigned!: boolean;

  // Audit
  @Prop({ required: true })
  createdBy!: string;                 // Admin wallet who created this partner

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: '0' })
  totalBorrowed!: string;             // Lifetime borrowed amount

  @Prop({ default: '0' })
  totalRepaid!: string;               // Lifetime repaid amount

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export const PartnerSchema = SchemaFactory.createForClass(Partner);

// Additional indexes
PartnerSchema.index({ partnerId: 1 }, { unique: true });
PartnerSchema.index({ apiKey: 1 }, { unique: true });
PartnerSchema.index({ status: 1 });
