import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type BidDocument = Bid & Document;

export enum BidStatus {
  PENDING = 'PENDING',
  WON = 'WON',
  LOST = 'LOST',
  SETTLED = 'SETTLED', // Won and received tokens
  REFUNDED = 'REFUNDED', // Lost and received full refund
}

@Schema({ timestamps: true })
export class Bid {
  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true, index: true })
  bidder!: string; // Wallet address

  @Prop({ required: true })
  tokenAmount!: string; // BigInt as string

  @Prop({ required: true })
  price!: string; // BigInt as string

  @Prop({ required: true })
  usdcDeposited!: string; // BigInt as string

  @Prop({ required: true })
  bidIndex!: number; // Index in smart contract array

  @Prop({ required: true, enum: BidStatus, default: BidStatus.PENDING })
  status!: BidStatus;

  @Prop({ type: String })
  transactionHash!: string;

  @Prop({ type: Number })
  blockNumber!: number;

  @Prop({ type: String })
  settlementTxHash?: string; // Transaction hash for settlement

  @Prop({ type: Date })
  settledAt?: Date; // When the bid was settled

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

export const BidSchema = SchemaFactory.createForClass(Bid);
BidSchema.index({ assetId: 1, price: -1 }); // Index for sorting bids by price
