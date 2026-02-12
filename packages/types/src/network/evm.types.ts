import { IAsset } from '../domain/asset.types';

export interface IAssetEVM extends IAsset {
  cryptography: {
    documentHash?: string;
    merkleRoot?: string;
    merkleLeaves?: string[];
    merkleProof?: string[];
  };
  zkProof?: {
    proof: object;
    publicSignals: string[];
    verificationKey: object;
    verified: boolean;
    generatedAt: Date;
  };
  attestation?: {
    payload: string;
    hash: string;
    signature: string;
    attestor: string;
    timestamp: Date;
  };
  eigenDA?: {
    blobId: string;
    blobHash: string;
    dispersedAt: Date;
    requestId: string;
  };
  registry?: {
    transactionHash: string;
    blockNumber: number;
    registeredAt: Date;
  };
  token?: {
    address: string;
    compliance?: string;
    supply: string;
    deployedAt: Date;
    transactionHash: string;
  };
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
  yield?: {
    totalDeposited: string;
    totalDistributed: string;
    pendingDistribution: string;
    lastDistributionAt: Date;
  };
}
