import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Settlement } from './settlement.schema';

export type SolvencyPositionDocument = SolvencyPosition & Document;

export enum TokenType {
  RWA = 'RWA',
  PRIVATE_ASSET = 'PRIVATE_ASSET',
}

export enum HealthStatus {
  HEALTHY = 'HEALTHY',           // Health factor > 125%
  WARNING = 'WARNING',           // Health factor 110% - 125%
  LIQUIDATABLE = 'LIQUIDATABLE', // Health factor < 110%
}

export enum PositionStatus {
  ACTIVE = 'ACTIVE',         // Position open with collateral
  LIQUIDATED = 'LIQUIDATED', // Liquidation executed
  REPAID = 'REPAID',         // Loan fully repaid
  CLOSED = 'CLOSED',         // Position closed, collateral withdrawn
  SETTLED = 'SETTLED',     // Liquidation settled and finalized
}

@Schema({ timestamps: true })
export class SolvencyPosition {
  @Prop({ required: true, unique: true, index: true })
  positionId!: number; // On-chain position ID

  @Prop({ required: true, index: true })
  userAddress!: string; // Wallet address

  @Prop({ required: true })
  collateralTokenAddress!: string; // RWA or PrivateAsset token address

  @Prop({ required: true, enum: TokenType })
  collateralTokenType!: TokenType;

  @Prop({ required: true })
  collateralAmount!: string; // Wei (18 decimals)

  @Prop({ required: true })
  tokenValueUSD!: string; // Wei (6 decimals) - valuation at deposit

  @Prop({ required: true, default: '0' })
  usdcBorrowed!: string; // Wei (6 decimals)

  @Prop({ required: true })
  initialLTV!: number; // Basis points (7000 = 70%)

  @Prop({ type: Number })
  currentHealthFactor?: number; // Basis points (15000 = 150%)

  @Prop({ required: true, enum: HealthStatus, default: HealthStatus.HEALTHY })
  healthStatus!: HealthStatus;

  @Prop({ required: true, enum: PositionStatus, default: PositionStatus.ACTIVE })
  status!: PositionStatus;

  // Repayment tracking
  @Prop({ default: '0' })
  totalRepaid!: string; // Total USDC repaid (principal + interest)

  @Prop({ type: Date })
  lastRepaymentTime?: Date;

  // Liquidation details
  @Prop({ type: Date })
  liquidationTimestamp?: Date;

  @Prop({ type: String })
  liquidationTxHash?: string;

  @Prop({ type: String })
  marketplaceListingId?: string; // bytes32 assetId of liquidation listing

  @Prop({ type: String })
  debtRecovered?: string; // USDC recovered from liquidation sale

  // OAID integration
  @Prop({ type: Number })
  oaidCreditLineId?: number;

  @Prop({ type: Boolean, default: false })
  oaidCreditIssued!: boolean;

  // Partner Integration
  @Prop({ type: [Object], default: [] })
  partnerLoans!: Array<{
    partnerId: string;
    partnerLoanId: string;              // Reference to PartnerLoan.internalLoanId
    borrowedAmount: string;             // USDC borrowed via this partner (6 decimals)
    active: boolean;
  }>;

  @Prop({ default: '0' })
  totalPartnerDebt!: string;            // Sum of all active partner loans (6 decimals)

  // Transaction details
  @Prop({ required: true })
  depositTxHash!: string;

  @Prop({ type: Number })
  depositBlockNumber?: number;

  // Timestamps added by Mongoose
  createdAt?: Date;
  updatedAt?: Date;
  settledAt?: Date;
}

export const SolvencyPositionSchema = SchemaFactory.createForClass(SolvencyPosition);

// Indexes for efficient queries
SolvencyPositionSchema.index({ userAddress: 1, status: 1 }); // User's positions
SolvencyPositionSchema.index({ healthStatus: 1, status: 1 }); // Liquidatable positions
SolvencyPositionSchema.index({ collateralTokenAddress: 1 }); // Positions by token
