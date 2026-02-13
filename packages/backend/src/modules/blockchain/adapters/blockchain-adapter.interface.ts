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
    totalSupply: number,
    attestationHash: string,
    blobId: string
  ): Promise<DeployedTokenResult>;
  
  // Marketplace
  listOnMarketplace(
    tokenIdentifier: string,
    listingType: string,
    price: number,
    minInvestment: number,
    duration: number,
    totalSupply: number
  ): Promise<{ txId: string }>;
  
  // Identity
  registerIdentity(walletAddress: string): Promise<{ txId: string }>;
  isVerified(walletAddress: string): Promise<boolean>;
  
  // Stellar specific (gracefully ignored on EVM)
  approveTrustline?(walletAddress: string, assetIdentifier: string): Promise<{ txId: string; skipped?: boolean }>;
}
