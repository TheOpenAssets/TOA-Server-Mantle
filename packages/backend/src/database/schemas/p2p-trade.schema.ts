import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type P2PTradeDocument = P2PTrade & Document;

@Schema({ timestamps: true })
export class P2PTrade {
  @Prop({ required: true, unique: true })
  tradeId!: string; // txHash + logIndex

  @Prop({ required: true, index: true })
  orderId!: string;

  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ required: true })
  buyer!: string;

  @Prop({ required: true })
  seller!: string;

  @Prop({ required: true })
  amount!: string; // Tokens traded (wei)

  @Prop({ required: true })
  pricePerToken!: string; // USDC per token

  @Prop({ required: true })
  totalValue!: string; // Total USDC value

  @Prop({ required: true })
  txHash!: string;

  @Prop({ required: true })
  blockNumber!: number;

  @Prop({ required: true, index: true })
  blockTimestamp!: Date;
}

export const P2PTradeSchema = SchemaFactory.createForClass(P2PTrade);
P2PTradeSchema.index({ assetId: 1, blockTimestamp: -1 }); // For trade history & charts
