import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PurchaseDocument = Purchase & Document;

@Schema({ timestamps: true })
export class Purchase {
  @Prop({ required: true, unique: true })
  txHash!: string;

  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true, index: true })
  investorWallet!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ required: true })
  amount!: string; // Token amount in wei

  @Prop({ required: true })
  price!: string; // Price per token at time of purchase

  @Prop({ required: true })
  totalPayment!: string; // Total USDC paid

  @Prop()
  blockNumber?: number;

  @Prop()
  blockTimestamp?: Date;

  @Prop({ default: 'CONFIRMED' })
  status!: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CLAIMED';

  @Prop({ type: Object })
  metadata?: {
    assetName?: string;
    industry?: string;
    riskTier?: string;
    type?: 'PURCHASE' | 'DEPOSIT'; // Track if this is a purchase or deposit
  };

  // Timestamps (automatically added by Mongoose with timestamps: true)
  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);

// Indexes
PurchaseSchema.index({ investorWallet: 1, assetId: 1 });
PurchaseSchema.index({ createdAt: -1 });
