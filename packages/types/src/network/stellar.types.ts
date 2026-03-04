import { IAsset } from '../domain/asset.types';

export interface IAssetStellar extends IAsset {
  registry?: {
    transactionHash: string;
    registeredAt: Date;
    assetCode?: string;
  };
  token?: {
    address: string; // assetCode:issuerPubKey
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
  // Add other Stellar specific fields if needed
}
