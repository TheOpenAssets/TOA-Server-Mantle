import { ListingType, WalletAddress, PreciseNumeric } from '@openassets/types';

export interface DeployedTokenResult {
  primaryIdentifier: string; // EVM: address, Stellar: assetCode:issuerPubKey
  auxiliaryIdentifier?: string; // EVM: complianceAddress
  txId: string;
}

export interface PurchaseVerificationResult {
  amount: PreciseNumeric; // Canonical 4-decimal
  price: PreciseNumeric; // Canonical 4-decimal (USDC)
  totalPayment: PreciseNumeric; // Canonical 4-decimal (USDC)
  blockNumber: number;
  timestamp: number; // Unix timestamp
}

export interface BidVerificationResult {
  tokenAmount: PreciseNumeric; // Canonical 4-decimal
  price: PreciseNumeric; // Canonical 4-decimal (USDC)
  bidIndex: number;
}

export interface BidSettlementResult {
  tokensReceived: PreciseNumeric; // Canonical 4-decimal
  refundAmount: PreciseNumeric; // Canonical 4-decimal (USDC)
  cost: PreciseNumeric; // Canonical 4-decimal (USDC)
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

  endAuction(
    tokenIdentifier: string,
    clearingPrice: string
  ): Promise<{ txId: string }>;
  
  // Marketplace Verification
  verifyPurchaseTransaction(
    txHash: string,
    assetId: string,
    expectedBuyer: string,
  ): Promise<PurchaseVerificationResult | null>;

  verifyBidTransaction(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidVerificationResult | null>;

  verifyBidSettlement(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidSettlementResult | null>;
  
  // Identity
  registerIdentity(walletAddress: WalletAddress): Promise<{ txId: string }>;
  isVerified(walletAddress: WalletAddress): Promise<boolean>;
  
  // Stellar specific (gracefully ignored on EVM)
  approveTrustline?(walletAddress: WalletAddress, assetIdentifier: string): Promise<{ txId: string; skipped?: boolean }>;
}
