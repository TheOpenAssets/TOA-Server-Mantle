import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PayoutDocument = Payout & Document;

@Schema({ timestamps: true })
export class Payout {
  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true, index: true })
  originator!: string; // Wallet address

  @Prop({ required: true })
  amount!: string; // USDC amount in wei (BigInt as string)

  @Prop({ required: true })
  amountFormatted!: string; // Human-readable amount (e.g., "87000 USDC")

  @Prop({ type: [String], required: true })
  settledBidIds!: string[]; // Array of bid document IDs that contributed to this payout

  @Prop({ required: true })
  settledBidsCount!: number; // Number of settled bids

  @Prop({ required: true })
  transactionHash!: string; // On-chain transaction hash

  @Prop({ type: Number })
  blockNumber?: number; // Block number where tx was confirmed

  @Prop({ type: Date, default: Date.now })
  paidAt!: Date; // When the payout was executed

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);
PayoutSchema.index({ assetId: 1, paidAt: -1 });
PayoutSchema.index({ originator: 1, paidAt: -1 });
