import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type P2POrderDocument = P2POrder & Document;

export enum OrderStatus {
  OPEN = 'OPEN',
  FILLED = 'FILLED',
  CANCELLED = 'CANCELLED',
}

@Schema({ timestamps: true })
export class P2POrder {
  @Prop({ required: true, unique: true })
  orderId!: string; // On-chain ID

  @Prop({ required: true, index: true })
  maker!: string; // Wallet address

  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ required: true })
  isBuy!: boolean; // true = BID, false = ASK

  @Prop({ required: true })
  initialAmount!: string; // Wei

  @Prop({ required: true })
  remainingAmount!: string; // Wei (decreases on fill)

  @Prop({ required: true })
  pricePerToken!: string; // USDC per 1 whole token

  @Prop({ required: true, enum: OrderStatus, default: OrderStatus.OPEN, index: true })
  status!: OrderStatus;

  @Prop({ required: true })
  txHash!: string;

  @Prop({ required: true })
  blockNumber!: number;

  @Prop({ required: true })
  blockTimestamp!: Date;
}

export const P2POrderSchema = SchemaFactory.createForClass(P2POrder);
P2POrderSchema.index({ assetId: 1, status: 1, pricePerToken: 1 }); // For orderbook sorting
