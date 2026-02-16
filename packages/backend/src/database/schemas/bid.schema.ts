import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { BidStatus, WalletAddress } from '@openassets/types';

export type BidDocument = Bid & Document;

@Schema({ timestamps: true })
export class Bid {
  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true, index: true, type: String })
  bidder!: WalletAddress; // Wallet address

  @Prop({ required: true })
  tokenAmount!: string; // BigInt as string

  @Prop({ required: true })
  price!: string; // BigInt as string

  @Prop({ required: true })
  usdcDeposited!: string; // BigInt as string

  @Prop({ required: true })
  bidIndex!: number; // Index in smart contract array

  @Prop({ required: true, enum: BidStatus, default: BidStatus.PENDING, type: String })
  status!: BidStatus;

  @Prop({ type: String })
  transactionHash!: string;

  @Prop({ type: Number })
  blockNumber!: number;

  @Prop({ type: String })
  settlementTxHash?: string; // Transaction hash for settlement

  @Prop({ type: String, enum: ['mantle', 'stellar'], default: 'mantle', index: true })
  network!: string;

  @Prop({ type: Date })
  settledAt?: Date; // When the bid was settled

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

export const BidSchema = SchemaFactory.createForClass(Bid);
BidSchema.index({ assetId: 1, price: -1 }); // Index for sorting bids by price
