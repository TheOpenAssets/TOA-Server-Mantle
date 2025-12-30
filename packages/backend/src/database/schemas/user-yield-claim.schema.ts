import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum YieldClaimStatus {
  PENDING = 'PENDING',       // Event detected but not processed
  CONFIRMED = 'CONFIRMED',   // Claim confirmed on-chain
  FAILED = 'FAILED',         // Claim failed
}

@Schema({ timestamps: true })
export class UserYieldClaim extends Document {
  @Prop({ required: true, index: true })
  userAddress!: string; // Investor who claimed

  @Prop({ required: true, index: true })
  tokenAddress!: string; // RWA token address

  @Prop({ required: true, index: true })
  assetId!: string; // Asset ID for reference

  @Prop({ required: true })
  tokensBurned!: string; // Amount of RWA tokens burned (in wei)

  @Prop({ required: true })
  usdcReceived!: string; // Amount of USDC received (in wei, 6 decimals)

  @Prop({ required: true })
  transactionHash!: string; // Transaction hash of the claim

  @Prop({ required: true })
  blockNumber!: number; // Block number where claim occurred

  @Prop({ required: true })
  claimTimestamp!: Date; // Blockchain timestamp of claim

  @Prop({ enum: YieldClaimStatus, default: YieldClaimStatus.PENDING })
  status!: YieldClaimStatus;

  @Prop()
  errorMessage?: string; // If claim failed, error message

  @Prop({ default: false })
  notificationSent!: boolean; // Whether user was notified
}

export const UserYieldClaimSchema = SchemaFactory.createForClass(UserYieldClaim);

// Indexes for efficient queries
UserYieldClaimSchema.index({ userAddress: 1, tokenAddress: 1 });
UserYieldClaimSchema.index({ assetId: 1 });
UserYieldClaimSchema.index({ transactionHash: 1 }, { unique: true });
UserYieldClaimSchema.index({ createdAt: -1 });
