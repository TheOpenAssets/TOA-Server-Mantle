import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NetworkType } from '@openassets/types';

export type YieldClaimDocument = YieldClaim & Document;

@Schema({ timestamps: true })
export class YieldClaim {
  @Prop({ required: true, unique: true })
  txHash!: string;

  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true, index: true })
  investorWallet!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ type: String, enum: NetworkType, default: NetworkType.MANTLE, index: true })
  network!: NetworkType;

  @Prop({ required: true })
  tokensBurned!: string; // Amount of tokens burned (wei format, 18 decimals)

  @Prop({ required: true })
  usdcReceived!: string; // Amount of USDC received (wei format, 6 decimals)

  @Prop()
  blockNumber?: number;

  @Prop()
  blockTimestamp?: Date;

  @Prop({ default: 'CONFIRMED' })
  status!: 'PENDING' | 'CONFIRMED' | 'FAILED';

  @Prop({ type: Boolean })
  rawPrecise?: boolean;

  @Prop({ type: String })
  rawTokensBurned?: string;

  @Prop({ type: String })
  rawUsdcReceived?: string;

  @Prop({ type: Object })
  metadata?: {
    assetName?: string;
    industry?: string;
    settlementId?: string;
  };

  // Timestamps (automatically added by Mongoose with timestamps: true)
  createdAt?: Date;
  updatedAt?: Date;
}

export const YieldClaimSchema = SchemaFactory.createForClass(YieldClaim);

// Indexes
YieldClaimSchema.index({ investorWallet: 1, assetId: 1 });
YieldClaimSchema.index({ createdAt: -1 });
YieldClaimSchema.index({ tokenAddress: 1 });
YieldClaimSchema.index({ investorWallet: 1, network: 1 });
