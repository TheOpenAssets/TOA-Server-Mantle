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

export interface YieldClaimVerificationResult {
  tokensBurned: PreciseNumeric; // Canonical 4-decimal
  usdcReceived: PreciseNumeric; // Canonical 4-decimal (USDC)
  blockNumber: number;
  timestamp: number;
}

export interface TokenBurnResult {
  txId: string; // Transaction hash/ID (network-specific format)
  blockNumber: number; // Block number (EVM) or ledger sequence (Stellar)
  tokensBurned: string; // Raw amount burned (string BigInt for precision)
  tokensBurnedFormatted: string; // Human-readable: "1000.00 tokens"
  oldTotalSupply: string; // Total supply before burn
  oldTotalSupplyFormatted: string; // Human-readable: "10000.00 tokens"
  newTotalSupply: string; // Total supply after burn
  newTotalSupplyFormatted: string; // Human-readable: "9000.00 tokens"
  timestamp: number; // Unix timestamp (seconds)
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
    minPrice?: string,
    issuerVaultAddress?: string,  // IssuerVault contract address; undefined = legacy path (address(0))
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
  
  /**
   * Burn unsold tokens from custody wallet after payout
   * 
   * @param tokenIdentifier - EVM: Contract address (0x...), Stellar: Asset code or contract ID
   * @param assetId - Asset UUID for logging/tracking
   * @returns Burn details including amounts and transaction ID, or null if no tokens to burn
   * @throws Error if burn transaction fails
   */
  burnUnsoldTokens(
    tokenIdentifier: string,
    assetId: string,
  ): Promise<TokenBurnResult | null>;
  
  /**
   * Deposit yield settlement to YieldVault
   * 
   * @param tokenIdentifier - EVM: Token contract address, Stellar: Asset code
   * @param usdcAmount - Amount of USDC to deposit (in smallest units)
   * @returns Transaction ID
   */
  depositYieldToVault(
    tokenIdentifier: string,
    usdcAmount: string,
  ): Promise<{ txId: string }>;
  
  /**
   * Transfer USDC to a recipient (for platform fee payment)
   * 
   * @param recipientAddress - Recipient wallet address
   * @param usdcAmount - Amount of USDC to transfer (in smallest units)
   * @returns Transaction ID
   */
  transferUSDC(
    recipientAddress: string,
    usdcAmount: string,
  ): Promise<{ txId: string }>;

  /**
   * Verify a yield claim transaction on-chain
   */
  verifyYieldClaimTransaction(
    txHash: string,
    tokenAddress: string,
    expectedInvestor: string,
  ): Promise<YieldClaimVerificationResult | null>;

  /**
   * Get the amount of USDC claimable by a user from YieldVault
   * 
   * @param userAddress - Investor wallet address
   * @param tokenAddress - Optional: scope to a specific token
   * @returns Canonical string amount (e.g. "12.5000")
   */
  getClaimableYield?(
    userAddress: string,
    tokenAddress?: string,
  ): Promise<string>;
  
  // Stellar specific (gracefully ignored on EVM)
  approveTrustline?(walletAddress: WalletAddress, assetIdentifier: string): Promise<{ txId: string; skipped?: boolean }>;
}
