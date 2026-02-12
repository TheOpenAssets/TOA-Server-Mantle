import { WalletAddress } from '../blockchain/addresses';

export enum AssetStatus {
  UPLOADED = 'UPLOADED',
  HASHED = 'HASHED',
  MERKLED = 'MERKLED',
  PROOF_GENERATED = 'PROOF_GENERATED',
  ATTESTED = 'ATTESTED',
  DA_ANCHORED = 'DA_ANCHORED',
  REGISTERED = 'REGISTERED',
  TOKENIZED = 'TOKENIZED',
  SCHEDULED = 'SCHEDULED',
  LISTED = 'LISTED',
  PAYOUT_COMPLETE = 'PAYOUT_COMPLETE',
  YIELD_SETTLED = 'YIELD_SETTLED',
  ENDED = 'ENDED',
  REVOKED = 'REVOKED',
  REJECTED = 'REJECTED',
}

export enum AssetType {
  STATIC = 'STATIC',
  AUCTION = 'AUCTION',
}

export interface IAssetMetadata {
  invoiceNumber: string;
  faceValue: string;
  currency: string;
  issueDate: Date;
  dueDate: Date;
  buyerName: string;
  industry: string;
  riskTier: string;
}

export interface IAssetTokenParams {
  totalSupply: string;
  pricePerToken?: string;
  minInvestment: string;
  minRaise: string;
}

export interface IAssetFiles {
  invoice: {
    tempPath: string;
    permanentPath?: string;
    size: number;
    uploadedAt: Date;
  };
}

export interface IAssetCheckpoints {
  uploaded: boolean;
  hashed: boolean;
  merkled: boolean;
  attested: boolean;
  daAnchored: boolean;
  registered: boolean;
  tokenized: boolean;
}

export interface IAsset {
  assetId: string;
  originator: WalletAddress;
  status: AssetStatus;
  assetType: AssetType;
  metadata: IAssetMetadata;
  tokenParams: IAssetTokenParams;
  files: IAssetFiles;
  checkpoints: IAssetCheckpoints;
  createdAt?: Date;
  updatedAt?: Date;
}
