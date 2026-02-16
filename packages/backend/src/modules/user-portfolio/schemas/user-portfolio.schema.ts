import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export enum HoldingType {
  STATIC = 'STATIC',
  LEVERAGE = 'LEVERAGE',
  SOLVENCY = 'SOLVENCY',
}

export enum HoldingStatus {
  ACTIVE = 'ACTIVE',
  YIELD_CLAIMABLE = 'YIELD_CLAIMABLE',
  CLAIMED = 'CLAIMED',
  SETTLED = 'SETTLED',
  LIQUIDATED = 'LIQUIDATED',
}

@Schema({ _id: false })
export class RecentActivityStub {
  @Prop({ required: true })
  txHash!: string;

  @Prop({ required: true })
  source!: string; // e.g., 'PRIMARY_MARKET', 'LEVERAGE_HARVEST'

  @Prop({ required: true })
  assetId!: string;

  @Prop({ required: true })
  amount!: string;

  @Prop({ required: true })
  timestamp!: Date;
}

@Schema()
export class PortfolioHolding {
  @Prop({ required: true, index: true })
  assetId!: string;

  @Prop({ required: true })
  tokenIdentifier!: string; // Address or Stellar asset string

  @Prop({ required: true })
  network!: string;

  @Prop({ required: true, enum: HoldingType })
  holdingType!: HoldingType;

  @Prop({ required: true, enum: HoldingStatus, default: HoldingStatus.ACTIVE })
  status!: HoldingStatus;

  @Prop({ required: true, default: '0' })
  tokenBalance!: string; // 18 decimals

  @Prop({ required: true, default: '0' })
  totalInvested!: string; // 6 decimals (USDC)

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Purchase' }] })
  purchaseIds?: MongooseSchema.Types.ObjectId[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'LeveragePosition' })
  leveragePositionId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'SolvencyPosition' })
  solvencyPositionId?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'UserYieldClaim' })
  latestYieldClaimId?: MongooseSchema.Types.ObjectId;

  @Prop({ required: true, default: Date.now })
  firstEntryAt!: Date;

  @Prop({ required: true, default: Date.now })
  lastActivityAt!: Date;
}

export const PortfolioHoldingSchema = SchemaFactory.createForClass(PortfolioHolding);

@Schema({ _id: false })
export class PortfolioTotals {
  @Prop({ required: true, default: '0' })
  totalUSDCInvested!: string;

  @Prop({ required: true, default: '0' })
  totalYieldReceived!: string;

  @Prop({ required: true, default: 0 })
  totalActivePositions!: number;

  @Prop({ required: true, default: 0 })
  totalCompletedPositions!: number;

  @Prop({ required: true, default: 0 })
  totalActiveLeveragePositions!: number;

  @Prop({ required: true, default: 0 })
  totalActiveSolvencyPositions!: number;

  @Prop({ type: [String], default: [] })
  networks!: string[];
}

export type UserPortfolioDocument = UserPortfolio & Document;

@Schema({ timestamps: true })
export class UserPortfolio {
  @Prop({ required: true, index: true })
  walletAddress!: string;

  @Prop({ required: true, enum: ['mantle', 'stellar'] })
  network!: string;

  @Prop({ type: [PortfolioHoldingSchema], default: [] })
  holdings!: PortfolioHolding[];

  @Prop({ type: PortfolioTotals, default: () => ({}) })
  totals!: PortfolioTotals;

  @Prop({ type: [RecentActivityStub], default: [] })
  recentActivity!: RecentActivityStub[];

  @Prop({ default: Date.now })
  lastUpdated!: Date;

  @Prop({ default: 1 })
  version!: number;
}

export const UserPortfolioSchema = SchemaFactory.createForClass(UserPortfolio);

// Indexes
UserPortfolioSchema.index({ walletAddress: 1, network: 1 }, { unique: true });
UserPortfolioSchema.index({ 'holdings.assetId': 1 });
