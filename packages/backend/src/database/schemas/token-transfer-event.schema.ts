import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TokenTransferEventDocument = TokenTransferEvent & Document;

@Schema({ timestamps: true })
export class TokenTransferEvent {
  @Prop({ required: true, index: true })
  tokenAddress!: string;

  @Prop({ required: true, index: true })
  from!: string;

  @Prop({ required: true, index: true })
  to!: string;

  @Prop({ required: true })
  amount!: string; // BigInt as string

  @Prop({ required: true })
  blockNumber!: number;

  @Prop({ required: true })
  transactionHash!: string;

  @Prop({ required: true, index: true })
  timestamp!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const TokenTransferEventSchema = SchemaFactory.createForClass(TokenTransferEvent);

// Compound indexes for efficient queries
TokenTransferEventSchema.index({ tokenAddress: 1, timestamp: 1 });
TokenTransferEventSchema.index({ tokenAddress: 1, to: 1, timestamp: 1 });
TokenTransferEventSchema.index({ tokenAddress: 1, from: 1, timestamp: 1 });
