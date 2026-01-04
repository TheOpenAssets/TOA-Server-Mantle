import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum PositionStatus {
  ACTIVE = 'ACTIVE',
  LIQUIDATED = 'LIQUIDATED',
  SETTLED = 'SETTLED',
  CLOSED = 'CLOSED',
}

export enum PositionHealth {
  HEALTHY = 'HEALTHY', // > 140%
  WARNING = 'WARNING', // 125-140%
  CRITICAL = 'CRITICAL', // 110-125%
  LIQUIDATABLE = 'LIQUIDATABLE', // < 110%
}

@Schema({ timestamps: true })
export class HarvestRecord {
  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ required: true })
  mETHSwapped!: string; // Wei format (18 decimals)

  @Prop({ required: true })
  usdcReceived!: string; // Wei format (6 decimals)

  @Prop({ required: true })
  interestPaid!: string; // Wei format (6 decimals)

  @Prop({ required: true })
  interestAccrued!: string; // Wei format (6 decimals) - Outstanding interest at time of harvest

  @Prop({ required: true })
  mETHPrice!: string; // Wei format (6 decimals) - Price at time of harvest

  @Prop({ required: true })
  transactionHash!: string;

  @Prop({ required: true })
  healthFactorBefore!: number; // Basis points

  @Prop({ required: true })
  healthFactorAfter!: number; // Basis points
}

const HarvestRecordSchema = SchemaFactory.createForClass(HarvestRecord);

@Schema({ timestamps: true })
export class LeveragePosition extends Document {
  @Prop({ required: true, unique: true })
  positionId!: number; // On-chain position ID

  @Prop({ required: true, index: true })
  userAddress!: string; // Investor wallet address

  @Prop({ required: true, index: true })
  assetId!: string; // Asset ID reference

  @Prop({ required: true })
  rwaTokenAddress!: string; // RWA token contract address

  @Prop({ required: true })
  rwaTokenAmount!: string; // RWA tokens held (wei format, 18 decimals)

  @Prop({ required: true })
  mETHCollateral!: string; // mETH deposited (wei format, 18 decimals)

  @Prop({ required: true })
  usdcBorrowed!: string; // USDC borrowed from SeniorPool (wei format, 6 decimals)

  @Prop({ required: true })
  initialLTV!: number; // Initial LTV in basis points (e.g., 15000 = 150%)

  @Prop({ required: true })
  currentHealthFactor!: number; // Current health factor in basis points

  @Prop({ enum: PositionHealth, default: PositionHealth.HEALTHY })
  healthStatus!: PositionHealth;

  @Prop({ enum: PositionStatus, default: PositionStatus.ACTIVE })
  status!: PositionStatus;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true })
  lastHarvestTime!: Date;

  @Prop({ default: 0 })
  totalInterestPaid!: string; // Cumulative interest paid (wei format, 6 decimals)

  @Prop({ default: 0 })
  totalMETHHarvested!: string; // Cumulative mETH harvested (wei format, 18 decimals)

  @Prop({ type: [HarvestRecordSchema], default: [] })
  harvestHistory!: HarvestRecord[];

  // Liquidation details (if liquidated)
  @Prop()
  liquidationTimestamp?: Date;

  @Prop()
  liquidationTxHash?: string;

  @Prop()
  mETHSoldInLiquidation?: string; // Wei format

  @Prop()
  usdcRecoveredInLiquidation?: string; // Wei format

  @Prop()
  liquidationShortfall?: string; // Wei format (if any)

  // Settlement details (if settled)
  @Prop()
  settlementTimestamp?: Date;

  @Prop()
  settlementTxHash?: string;

  @Prop()
  settlementUSDCReceived?: string; // Total USDC from RWA settlement (wei format)

  @Prop()
  seniorRepayment?: string; // Principal repaid to SeniorPool (wei format)

  @Prop()
  interestRepayment?: string; // Interest repaid to SeniorPool (wei format)

  @Prop()
  userYieldDistributed?: string; // USDC distributed to user (wei format)

  @Prop()
  mETHReturnedToUser?: string; // Remaining mETH returned (wei format)

  // Notifications
  @Prop({ default: false })
  warningNotificationSent!: boolean;

  @Prop({ default: false })
  criticalNotificationSent!: boolean;

  @Prop()
  lastNotificationTime?: Date;
}

export const LeveragePositionSchema = SchemaFactory.createForClass(LeveragePosition);

// Indexes for efficient queries
LeveragePositionSchema.index({ userAddress: 1, status: 1 });
LeveragePositionSchema.index({ assetId: 1, status: 1 });
LeveragePositionSchema.index({ healthStatus: 1, status: 1 });
LeveragePositionSchema.index({ positionId: 1 }, { unique: true });
LeveragePositionSchema.index({ createdAt: -1 });
