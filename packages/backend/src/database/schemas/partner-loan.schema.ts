import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerLoanDocument = PartnerLoan & Document;

export enum PartnerLoanStatus {
  ACTIVE = 'ACTIVE',
  REPAID = 'REPAID',
  DEFAULTED = 'DEFAULTED',
  LIQUIDATED = 'LIQUIDATED',
}

export enum RepaymentSource {
  USER = 'USER',
  PARTNER = 'PARTNER',
  LIQUIDATION = 'LIQUIDATION',
}

@Schema({ timestamps: true })
export class PartnerLoan {
  // Identifiers
  @Prop({ required: true, unique: true, index: true })
  partnerLoanId!: string;             // Partner's internal loan ID

  @Prop({ required: true, unique: true, index: true })
  internalLoanId!: string;            // Your UUID for this loan

  @Prop({ required: true, index: true })
  partnerId!: string;                 // Reference to Partner

  @Prop({ required: true })
  partnerName!: string;               // Cached for queries

  // User & Position
  @Prop({ required: true, index: true })
  userWallet!: string;                // Borrower's wallet

  @Prop({ required: true, index: true })
  oaidTokenId!: number;               // OAID used for credit line

  @Prop({ required: true, index: true })
  solvencyPositionId!: number;        // Position backing this loan

  // Loan Details (all amounts in 6 decimals - USDC format)
  @Prop({ required: true })
  principalAmount!: string;           // Original borrowed amount

  @Prop({ required: true })
  remainingDebt!: string;             // Current outstanding

  @Prop({ default: 0 })
  interestRate!: number;              // Annual rate in basis points

  @Prop({ required: true })
  borrowedAt!: Date;

  // Repayment Tracking
  @Prop({ default: '0' })
  totalRepaid!: string;               // Total repaid so far

  @Prop()
  lastRepaymentAt?: Date;

  @Prop({ type: [Object], default: [] })
  repaymentHistory!: Array<{
    amount: string;                   // USDC amount (6 decimals)
    timestamp: Date;
    txHash?: string;                  // If on-chain proof provided
    repaidBy: RepaymentSource;
  }>;

  // Status
  @Prop({ required: true, enum: PartnerLoanStatus, default: PartnerLoanStatus.ACTIVE })
  status!: PartnerLoanStatus;

  // On-chain References
  @Prop()
  borrowTxHash?: string;              // Your platform's borrow transaction

  @Prop()
  repayTxHash?: string;               // Final repayment transaction

  // Platform Fees
  @Prop({ default: '0' })
  platformFeeCharged!: string;        // Fee charged to partner (6 decimals)

  @Prop({ default: false })
  platformFeePaid!: boolean;

  // Metadata
  @Prop({ type: Object })
  metadata?: {
    partnerUserId?: string;           // Partner's internal user ID
    loanPurpose?: string;
    customFields?: any;
  };

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
}

export const PartnerLoanSchema = SchemaFactory.createForClass(PartnerLoan);

// Additional indexes
PartnerLoanSchema.index({ partnerId: 1, status: 1 });
PartnerLoanSchema.index({ userWallet: 1, status: 1 });
PartnerLoanSchema.index({ oaidTokenId: 1 });
