import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AssetDocument = Asset & Document;

export enum AssetStatus {
  UPLOADED = 'UPLOADED',
  HASHED = 'HASHED',
  MERKLED = 'MERKLED',
  PROOF_GENERATED = 'PROOF_GENERATED',
  ATTESTED = 'ATTESTED',
  DA_ANCHORED = 'DA_ANCHORED',
  REGISTERED = 'REGISTERED',
  TOKENIZED = 'TOKENIZED',
  LISTED = 'LISTED',
  REVOKED = 'REVOKED',
  REJECTED = 'REJECTED',
}

@Schema({ timestamps: true })
export class Asset {
  @Prop({ required: true, unique: true })
  assetId!: string;

  @Prop({ required: true })
  originator!: string; // Wallet address

  @Prop({ required: true, enum: AssetStatus, default: AssetStatus.UPLOADED })
  status!: AssetStatus;

  @Prop({ required: true, enum: ['STATIC', 'AUCTION'] })
  assetType!: 'STATIC' | 'AUCTION';

  @Prop({ type: Object })
  metadata!: {
    invoiceNumber: string;
    faceValue: string;
    currency: string;
    issueDate: Date;
    dueDate: Date;
    buyerName: string;
    industry: string;
    riskTier: string;
  };

  @Prop({ type: Object })
  tokenParams!: {
    totalSupply: string;
    pricePerToken?: string; // Optional for auctions
    minInvestment: string;
    minRaise: string; // Minimum amount that must be raised
  };

  @Prop({ type: Object })
  files!: {
    invoice: {
      tempPath: string;
      permanentPath?: string;
      size: number;
      uploadedAt: Date;
    };
  };

  @Prop({ type: Object })
  cryptography!: {
    documentHash?: string;
    merkleRoot?: string;
    merkleLeaves?: string[];
    merkleProof?: string[];
  };

  @Prop({ type: Object })
  zkProof?: {
    proof: object;
    publicSignals: string[];
    verificationKey: object;
    verified: boolean;
    generatedAt: Date;
  };

  @Prop({ type: Object })
  attestation?: {
    payload: string;
    hash: string;
    signature: string;
    attestor: string;
    timestamp: Date;
  };

  @Prop({ type: Object })
  eigenDA?: {
    blobId: string;
    blobHash: string;
    dispersedAt: Date;
    requestId: string;
  };

  @Prop({ type: Object })
  registry?: {
    transactionHash: string;
    blockNumber: number;
    registeredAt: Date;
  };

  @Prop({ type: Object })
  token?: {
    address: string;
    compliance?: string;
    supply: string;
    deployedAt: Date;
    transactionHash: string;
  };

  @Prop({ type: Object })
  listing?: {
    type: 'STATIC' | 'AUCTION';
    price?: string; // For STATIC listings
    reservePrice?: string; // For AUCTION: minimum acceptable price
    priceRange?: { min: string; max: string }; // For AUCTION: bid price range
    duration?: number; // For AUCTION: duration in seconds
    sold: string;
    amountRaised?: string; // Total USDC raised from primary sales (for yield calculation)
    active: boolean;
    listedAt: Date;
    phase?: 'BIDDING' | 'ENDED' | 'SETTLED' | 'FAILED';
  };

  @Prop({ type: Object })
  yield?: {
    totalDeposited: string;
    totalDistributed: string;
    pendingDistribution: string;
    lastDistributionAt: Date;
  };

  @Prop({
    type: Object,
    default: {
      uploaded: true,
      hashed: false,
      merkled: false,
      attested: false,
      daAnchored: false,
      registered: false,
      tokenized: false,
    },
  })
  checkpoints!: {
    uploaded: boolean;
    hashed: boolean;
    merkled: boolean;
    attested: boolean;
    daAnchored: boolean;
    registered: boolean;
    tokenized: boolean;
  };
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
