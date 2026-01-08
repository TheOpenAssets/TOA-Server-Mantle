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

  @Prop({ default: 'PRIMARY_MARKET' })
  source!: 'PRIMARY_MARKET' | 'AUCTION' | 'SECONDARY_MARKET' | 'P2P_SELL_ORDER' | 'SECONDARY_MARKET_PURCHASE' | 'P2P_ORDER_CANCELLED';

  @Prop()
  p2pTradeId?: string; // Reference to P2PTrade if source is SECONDARY_MARKET

  @Prop({ default: false })
  soldOnSecondaryMarket?: boolean; // True if user sold these tokens on P2P market

  @Prop()
  soldP2PTradeId?: string; // Reference to P2PTrade when sold

  @Prop({ type: Object })
  metadata?: {
    assetName?: string;
    industry?: string;
    riskTier?: string;
  };

  // Timestamps (automatically added by Mongoose with timestamps: true)
  createdAt?: Date;
  updatedAt?: Date;
}

export const PurchaseSchema = SchemaFactory.createForClass(Purchase);

// Indexes
PurchaseSchema.index({ investorWallet: 1, assetId: 1 });
PurchaseSchema.index({ createdAt: -1 });
