import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PlatformConfigDocument = PlatformConfig & Document;

@Schema({ timestamps: true })
export class PlatformConfig {
  @Prop({ required: true, unique: true, default: 'default' })
  configKey!: string; // 'default' for main config, can have multiple configs

  // Raise Thresholds
  @Prop({ required: true, default: 0.30 })
  minRaiseThresholdPercent!: number; // Minimum % of netDistribution that must be raised (e.g., 0.30 = 30%)

  @Prop({ required: true, default: 0.985 })
  maxRaiseThresholdPercent!: number; // Maximum % of invoice value (0.985 = 98.5% to leave 1.5% for platform)

  // Platform Fees
  @Prop({ required: true, default: 0.015 })
  platformFeeRate!: number; // 1.5% platform fee on settlement

  // Marketplace Settings
  @Prop({ required: true, default: 7 })
  defaultListingDurationDays!: number; // How long listings stay active

  @Prop({ required: true, default: 1000 })
  minInvestmentTokens!: number; // Minimum tokens per purchase

  // Risk Management
  @Prop({ required: true, default: true })
  enforceMinRaiseThreshold!: boolean; // If true, refund investors if min not met

  @Prop({ required: true, default: true })
  enforceMaxRaiseThreshold!: boolean; // If true, block purchases exceeding max

  // Yield Distribution
  @Prop({ required: true, default: true })
  distributeFullSettlement!: boolean; // If true, distribute settlement-fee (not just yield)

  @Prop({ type: Object })
  updatedBy?: {
    admin: string;
    timestamp: Date;
    reason?: string;
  };
}

export const PlatformConfigSchema = SchemaFactory.createForClass(PlatformConfig);
