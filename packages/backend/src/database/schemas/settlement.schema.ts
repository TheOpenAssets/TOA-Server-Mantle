import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SettlementDocument = Settlement & Document;

export enum SettlementStatus {
  PENDING_CONVERSION = 'PENDING_CONVERSION',
  READY_FOR_DISTRIBUTION = 'READY_FOR_DISTRIBUTION',
  DISTRIBUTING = 'DISTRIBUTING',
  DISTRIBUTED = 'DISTRIBUTED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true })
export class Settlement {
  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ required: true })
  settlementAmount!: number; // Full settlement received from debtor (₹50L)

  @Prop({ required: true })
  amountRaised!: number; // What investors paid during primary sale (₹46.73L)

  @Prop({ required: true })
  platformFeeRate!: number; // Platform fee percentage (0.015 = 1.5%)

  @Prop({ required: true })
  platformFee!: number; // Calculated platform fee in fiat

  @Prop({ required: true })
  netDistribution!: number; // Amount distributed to investors (settlement - platform fee)

  @Prop()
  usdcAmount?: string; // USDC equivalent after fiat conversion

  @Prop({ required: true, enum: SettlementStatus, default: SettlementStatus.PENDING_CONVERSION })
  status!: SettlementStatus;

  @Prop()
  settlementDate!: Date;

  @Prop()
  conversionTimestamp?: Date;

  @Prop()
  distributedAt?: Date;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);
