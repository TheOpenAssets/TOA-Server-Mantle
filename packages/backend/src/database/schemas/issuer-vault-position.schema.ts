import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { NetworkType } from '@openassets/types';

export type IssuerVaultPositionDocument = IssuerVaultPosition & Document;

export enum IssuerVaultStatus {
  PENDING_LISTING  = 'PENDING_LISTING',   // Vault registered, listing not live yet
  SALE_ACTIVE      = 'SALE_ACTIVE',       // Listing live, USDC accumulating
  SALE_COMPLETE    = 'SALE_COMPLETE',     // Listing closed, issuer can withdraw
  DEBT_ACTIVE      = 'DEBT_ACTIVE',       // Issuer has withdrawn, debt outstanding
  REPAYING         = 'REPAYING',          // Partial repayment(s) made
  REPAID           = 'REPAID',            // Fully repaid, yield distributed to investors
}

@Schema({ timestamps: true })
export class IssuerVaultPosition {
  /** Off-chain asset identifier (UUID) */
  @Prop({ required: true, unique: true, index: true })
  assetId!: string;

  /** On-chain bytes32 assetId (hex) */
  @Prop({ required: true })
  assetIdBytes32!: string;

  /** Deployed RWA token address */
  @Prop({ required: true })
  tokenAddress!: string;

  /** Issuer wallet address authorised on-chain */
  @Prop({ required: true, index: true })
  issuerAddress!: string;

  /** Agreed annual simple interest rate in basis points (e.g. 1000 = 10%) */
  @Prop({ required: true })
  agreedRateBps!: number;

  /** Net USDC deposited so far (canonical 6-decimal string) */
  @Prop({ default: '0' })
  principalHeld!: string;

  /** USDC the issuer has withdrawn (canonical 6-decimal string) */
  @Prop({ default: '0' })
  amountWithdrawn!: string;

  /** Remaining principal debt (canonical 6-decimal string) */
  @Prop({ default: '0' })
  outstandingDebt!: string;

  /** Total interest paid to date (canonical 6-decimal string) */
  @Prop({ default: '0' })
  totalInterestPaid!: string;

  /** Unix timestamp when issuer first withdrew (0 = not withdrawn yet) */
  @Prop({ default: 0 })
  withdrawalTimestamp!: number;

  @Prop({ type: String, enum: IssuerVaultStatus, default: IssuerVaultStatus.PENDING_LISTING, index: true })
  status!: IssuerVaultStatus;

  @Prop({ type: String, enum: NetworkType, default: NetworkType.HASHKEY, index: true })
  network!: NetworkType;

  /** Tx hash of the yield distribution (set when REPAID) */
  @Prop()
  yieldDistributionTxHash?: string;

  /** IssuerVault contract address on-chain */
  @Prop({ required: true })
  contractAddress!: string;
}

export const IssuerVaultPositionSchema = SchemaFactory.createForClass(IssuerVaultPosition);
