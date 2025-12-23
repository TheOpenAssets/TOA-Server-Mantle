import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DistributionHistoryDocument = DistributionHistory & Document;

@Schema({ timestamps: true })
export class DistributionHistory {
  @Prop({ required: true, index: true })
  settlementId: string;

  @Prop({ required: true })
  tokenAddress: string;

  @Prop({ required: true })
  recipient: string;

  @Prop({ required: true })
  amount: string;

  @Prop()
  txHash: string;

  @Prop()
  distributedAt: Date;

  @Prop({ default: 'SUCCESS' })
  status: 'SUCCESS' | 'FAILED';
}

export const DistributionHistorySchema = SchemaFactory.createForClass(DistributionHistory);
