import { ListingType, WalletAddress } from '@openassets/types';

export interface DeployedTokenResult {
  primaryIdentifier: string; // EVM: address, Stellar: assetCode:issuerPubKey
  auxiliaryIdentifier?: string; // EVM: complianceAddress
  txId: string;
}

export interface BlockchainAdapter {
  // Asset Management
  registerAsset(dto: any): Promise<{ txId: string }>;
  revokeAsset(assetId: string): Promise<{ txId: string }>;
  
  // Token Management
  deployToken(
    assetId: string,
    totalSupply: string | number,
    params: {
      name?: string;
      symbol?: string;
      attestationHash?: string;
      blobId?: string;
      [key: string]: any;
    }
  ): Promise<DeployedTokenResult>;
  
  // Marketplace
  listOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: string | number,
    minInvestment: string | number,
    duration: number,
    totalSupply: string | number,
    minPrice?: string
  ): Promise<{ txId: string }>;
  
  // Identity
  registerIdentity(walletAddress: WalletAddress): Promise<{ txId: string }>;
  isVerified(walletAddress: WalletAddress): Promise<boolean>;
  
  // Stellar specific (gracefully ignored on EVM)
  approveTrustline?(walletAddress: WalletAddress, assetIdentifier: string): Promise<{ txId: string; skipped?: boolean }>;
}
