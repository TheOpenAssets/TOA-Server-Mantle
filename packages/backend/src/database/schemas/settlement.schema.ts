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
  assetId: string;

  @Prop({ required: true })
  tokenAddress: string;

  @Prop({ required: true })
  settlementAmount: number; // Fiat amount

  @Prop({ required: true })
  grossYield: number;

  @Prop({ required: true })
  platformFee: number;

  @Prop({ required: true })
  netYield: number;

  @Prop()
  usdcAmount?: string; // Actual USDC received after conversion

  @Prop({ required: true, enum: SettlementStatus, default: SettlementStatus.PENDING_CONVERSION })
  status: SettlementStatus;

  @Prop()
  settlementDate: Date;

  @Prop()
  conversionTimestamp?: Date;

  @Prop()
  distributedAt?: Date;
}

export const SettlementSchema = SchemaFactory.createForClass(Settlement);
