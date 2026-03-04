import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { Settlement } from './settlement.schema';
import { TokenType, SolvencyHealthStatus, SolvencyPositionStatus, WalletAddress, NetworkType } from '@openassets/types';

export type SolvencyPositionDocument = SolvencyPosition & Document;

@Schema({ timestamps: true })
export class SolvencyPosition {
  @Prop({ required: true, unique: true, index: true })
  positionId!: number; // On-chain position ID

  @Prop({ required: true, index: true, type: String })
  userAddress!: WalletAddress; // Wallet address

  @Prop({ type: String, enum: NetworkType, default: NetworkType.MANTLE, index: true })
  network!: NetworkType;

  @Prop({ required: true })
  collateralTokenAddress!: string; // RWA or PrivateAsset token address

  @Prop({ required: true, enum: TokenType, type: String })
  collateralTokenType!: TokenType;

  @Prop({ required: true })
  collateralAmount!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseCollateralAmount?: boolean;

  @Prop()
  rawCollateralAmount?: string;

  @Prop({ required: true })
  tokenValueUSD!: string; // Canonical 4-decimal format - valuation at deposit

  @Prop()
  rawPreciseTokenValueUSD?: boolean;

  @Prop()
  rawTokenValueUSD?: string;

  @Prop({ required: true, default: '0.0000' })
  usdcBorrowed!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseUsdcBorrowed?: boolean;

  @Prop()
  rawUsdcBorrowed?: string;

  @Prop({ required: true })
  initialLTV!: number; // Basis points (7000 = 70%)

  @Prop({ type: Number })
  currentHealthFactor?: number; // Basis points (15000 = 150%)

  @Prop({ required: true, enum: SolvencyHealthStatus, default: SolvencyHealthStatus.HEALTHY, type: String })
  healthStatus!: SolvencyHealthStatus;

  @Prop({ required: true, enum: SolvencyPositionStatus, default: SolvencyPositionStatus.ACTIVE, type: String })
  status!: SolvencyPositionStatus;

  // Repayment tracking
  @Prop({ default: '0.0000' })
  totalRepaid!: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseTotalRepaid?: boolean;

  @Prop()
  rawTotalRepaid?: string;

  @Prop({ type: Date })
  lastRepaymentTime?: Date;

  @Prop({ type: Number, default: 0 })
  loanDuration?: number; // Seconds

  @Prop({ type: Number, default: 0 })
  numberOfInstallments?: number;

  @Prop({ type: Number, default: 0 })
  installmentInterval?: number; // Seconds

  @Prop({ type: Number, default: 0 })
  installmentsPaid?: number; // Counter tracked by backend

  @Prop({ type: Number, default: 0 })
  missedPayments?: number; // Counter tracked by backend

  @Prop({ type: Date })
  nextPaymentDueDate?: Date; // Calculated next due date

  @Prop({ type: [Object], default: [] })
  repaymentSchedule?: Array<{
    installmentNumber: number;
    dueDate: Date;
    amount: string; // Canonical 4-decimal format
    rawPreciseAmount?: boolean;
    rawAmount?: string;
    status: 'PENDING' | 'PAID' | 'MISSED';
    paidAt?: Date;
    txHash?: string;
  }>;

  @Prop({ type: Boolean, default: false })
  isDefaulted?: boolean; // Flag for default status

  // Liquidation details
  @Prop({ type: Date })
  liquidationTimestamp?: Date;

  @Prop({ type: String })
  liquidationTxHash?: string;

  @Prop({ type: String })
  marketplaceListingId?: string; // bytes32 assetId of liquidation listing

  @Prop({ type: String })
  debtRecovered?: string; // Canonical 4-decimal format

  @Prop()
  rawPreciseDebtRecovered?: boolean;

  @Prop()
  rawDebtRecovered?: string;

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
    borrowedAmount: string;             // Canonical 4-decimal format
    rawPreciseBorrowedAmount?: boolean;
    rawBorrowedAmount?: string;
    active: boolean;
  }>;

  @Prop({ default: '0.0000' })
  totalPartnerDebt!: string;            // Canonical 4-decimal format

  @Prop()
  rawPreciseTotalPartnerDebt?: boolean;

  @Prop()
  rawTotalPartnerDebt?: string;

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
SolvencyPositionSchema.index({ userAddress: 1, network: 1 });
