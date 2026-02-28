import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { YieldClaimStatus, WalletAddress, NetworkType } from '@openassets/types';

export type UserYieldClaimDocument = UserYieldClaim & Document;

@Schema({ timestamps: true })
export class UserYieldClaim {
  @Prop({ required: true, index: true, type: String })
  userAddress!: WalletAddress; // Investor who claimed

  @Prop({ required: true, index: true })
  tokenAddress!: string; // RWA token address

  @Prop({ required: true, index: true })
  assetId!: string; // Asset ID for reference

  @Prop({ type: String, enum: NetworkType, default: NetworkType.MANTLE, index: true })
  network!: NetworkType;

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

  @Prop({ enum: YieldClaimStatus, default: YieldClaimStatus.PENDING, type: String })
  status!: YieldClaimStatus;

  @Prop()
  errorMessage?: string; // If claim failed, error message

  @Prop({ default: false })
  notificationSent!: boolean; // Whether user was notified

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserYieldClaimSchema = SchemaFactory.createForClass(UserYieldClaim);

// Indexes for efficient queries
UserYieldClaimSchema.index({ userAddress: 1, tokenAddress: 1 });
UserYieldClaimSchema.index({ assetId: 1 });
UserYieldClaimSchema.index({ transactionHash: 1 }, { unique: true });
UserYieldClaimSchema.index({ createdAt: -1 });
UserYieldClaimSchema.index({ userAddress: 1, network: 1 });
