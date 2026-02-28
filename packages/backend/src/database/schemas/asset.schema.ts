import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  AssetStatus,
  AssetType,
  IAssetEVM,
  IAssetStellar,
  IAssetMetadata,
  IAssetTokenParams,
  IAssetFiles,
  IAssetCheckpoints,
  WalletAddress,
  NetworkType,
} from '@openassets/types';

export type AssetDocument = Asset & Document;

@Schema({ timestamps: true })
export class Asset implements IAssetEVM, IAssetStellar {
  @Prop({ required: true, unique: true })
  assetId!: string;

  @Prop({ required: true, type: String })
  originator!: WalletAddress;

  @Prop({ required: true, enum: AssetStatus, default: AssetStatus.UPLOADED, type: String })
  status!: AssetStatus;

  @Prop({ required: true, enum: AssetType, type: String })
  assetType!: AssetType;

  @Prop({ type: String, enum: NetworkType, default: NetworkType.MANTLE })
  network!: NetworkType;

  @Prop({ type: Object })
  metadata!: IAssetMetadata;

  @Prop({ type: Object })
  tokenParams!: IAssetTokenParams;

  @Prop({ type: Object })
  files!: IAssetFiles;

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
    blockNumber?: number;
    registeredAt: Date;
    assetCode?: string;
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
    price?: string;
    reservePrice?: string;
    priceRange?: { min: string; max: string };
    duration?: number;
    sold: string;
    amountRaised?: string;
    active: boolean;
    listedAt: Date;
    scheduledStartTime?: Date;
    scheduledEndTime?: Date;
    endedAt?: Date;
    phase?: 'BIDDING' | 'ENDED' | 'SETTLED' | 'FAILED';
    clearingPrice?: string;
    transactionHash?: string;
    endTransactionHash?: string;
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
      registered: false,
      tokenized: false,
    },
  })
  checkpoints!: IAssetCheckpoints;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AssetSchema = SchemaFactory.createForClass(Asset);
