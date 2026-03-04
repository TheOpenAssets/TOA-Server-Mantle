import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { LeveragePositionStatus, LeveragePositionHealth, WalletAddress, NetworkType } from '@openassets/types';

export type LeveragePositionDocument = LeveragePosition & Document;

@Schema({ timestamps: true })
export class HarvestRecord {
  @Prop({ required: true })
  timestamp!: Date;

  @Prop({ required: true })
  mETHSwapped!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseMETHSwapped?: boolean; // True if precision lost in canonical conversion

  @Prop()
  rawMETHSwapped?: string; // Full-precision value if rawPreciseMETHSwapped is true

  @Prop({ required: true })
  usdcReceived!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseUsdcReceived?: boolean;

  @Prop()
  rawUsdcReceived?: string;

  @Prop({ required: true })
  interestPaid!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseInterestPaid?: boolean;

  @Prop()
  rawInterestPaid?: string;

  @Prop({ required: true })
  interestAccrued!: string; // Canonical 4-decimal format - Outstanding interest at time of harvest

  @Prop()
  rawPreciseInterestAccrued?: boolean;

  @Prop()
  rawInterestAccrued?: string;

  @Prop({ required: true })
  mETHPrice!: string; // Canonical 4-decimal format - Price at time of harvest

  @Prop()
  rawPreciseMETHPrice?: boolean;

  @Prop()
  rawMETHPrice?: string;

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

  @Prop({ required: true, index: true, type: String })
  userAddress!: WalletAddress; // Investor wallet address

  @Prop({ required: true, index: true })
  assetId!: string; // Asset ID reference

  @Prop({ type: String, enum: NetworkType, default: NetworkType.MANTLE, index: true })
  network!: NetworkType;

  @Prop({ required: true })
  rwaTokenAddress!: string; // RWA token contract address

  @Prop({ required: true })
  rwaTokenAmount!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseRwaTokenAmount?: boolean;

  @Prop()
  rawRwaTokenAmount?: string;

  @Prop({ required: true })
  mETHCollateral!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseMETHCollateral?: boolean;

  @Prop()
  rawMETHCollateral?: string;

  @Prop({ required: true })
  usdcBorrowed!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseUsdcBorrowed?: boolean;

  @Prop()
  rawUsdcBorrowed?: string;

  @Prop({ required: true })
  initialLTV!: number; // Initial LTV in basis points (e.g., 15000 = 150%)

  @Prop({ required: true })
  currentHealthFactor!: number; // Current health factor in basis points

  @Prop({ enum: LeveragePositionHealth, default: LeveragePositionHealth.HEALTHY, type: String })
  healthStatus!: LeveragePositionHealth;

  @Prop({ enum: LeveragePositionStatus, default: LeveragePositionStatus.ACTIVE, type: String })
  status!: LeveragePositionStatus;

  @Prop({ required: true })
  createdAt!: Date;

  @Prop({ required: true })
  lastHarvestTime!: Date;

  @Prop({ default: '0.0000' })
  totalInterestPaid!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseTotalInterestPaid?: boolean;

  @Prop()
  rawTotalInterestPaid?: string;

  @Prop({ default: '0.0000' })
  totalMETHHarvested!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseTotalMETHHarvested?: boolean;

  @Prop()
  rawTotalMETHHarvested?: string;

  @Prop({ type: [HarvestRecordSchema], default: [] })
  harvestHistory!: HarvestRecord[];

  // Liquidation details (if liquidated)
  @Prop()
  liquidationTimestamp?: Date;

  @Prop()
  liquidationTxHash?: string;

  @Prop()
  mETHSoldInLiquidation?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseMETHSoldInLiquidation?: boolean;

  @Prop()
  rawMETHSoldInLiquidation?: string;

  @Prop()
  usdcRecoveredInLiquidation?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseUsdcRecoveredInLiquidation?: boolean;

  @Prop()
  rawUsdcRecoveredInLiquidation?: string;

  @Prop()
  liquidationShortfall?: string; // Canonical 4-decimal format (if any)

  @Prop()
  rawPreciseLiquidationShortfall?: boolean;

  @Prop()
  rawLiquidationShortfall?: string;

  // Settlement details (if settled)
  @Prop()
  settlementTimestamp?: Date;

  @Prop()
  settlementTxHash?: string;

  @Prop()
  settlementUSDCReceived?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseSettlementUSDCReceived?: boolean;

  @Prop()
  rawSettlementUSDCReceived?: string;

  @Prop()
  seniorRepayment?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseSeniorRepayment?: boolean;

  @Prop()
  rawSeniorRepayment?: string;

  @Prop()
  interestRepayment?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseInterestRepayment?: boolean;

  @Prop()
  rawInterestRepayment?: string;

  @Prop()
  userYieldDistributed?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseUserYieldDistributed?: boolean;

  @Prop()
  rawUserYieldDistributed?: string;

  @Prop()
  mETHReturnedToUser?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseMETHReturnedToUser?: boolean;

  @Prop()
  rawMETHReturnedToUser?: string;

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
LeveragePositionSchema.index({ userAddress: 1, network: 1 });
