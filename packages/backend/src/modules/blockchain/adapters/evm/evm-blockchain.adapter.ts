import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  createPublicClient, 
  http, 
  Address, 
  Hash,
  decodeEventLog, 
  defineChain,
  PublicClient 
} from 'viem';
import { ListingType, WalletAddress } from '@openassets/types';
import { 
  BlockchainAdapter, 
  DeployedTokenResult,
  PurchaseVerificationResult,
  BidVerificationResult,
  BidSettlementResult
} from '../blockchain-adapter.interface';
import { EvmWalletAdapter } from './evm-wallet.adapter';
import { EvmContractAdapter } from './evm-contract-loader.adapter';
import { Model } from 'mongoose';
import { AssetDocument } from '../../../../database/schemas/asset.schema';
import { toCanonical, fromCanonical } from '../../utils/numeric-conversion';

export class EvmBlockchainAdapter implements BlockchainAdapter {
  private readonly logger = new Logger(EvmBlockchainAdapter.name);
  private publicClient: PublicClient;
  private custodyAddress?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly walletAdapter: EvmWalletAdapter,
    private readonly contractAdapter: EvmContractAdapter,
    private readonly assetModel: Model<AssetDocument>,
    configOverride?: {
      rpcUrl?: string;
      chainId?: number;
      networkName?: string;
      nativeSymbol?: string;
      custodyAddress?: string;
    }
  ) {
    const rpcUrl = configOverride?.rpcUrl || this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = configOverride?.chainId || this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = configOverride?.networkName || this.configService.get<string>('network.networkName') || 'Mantle Sepolia';
    const nativeSymbol = configOverride?.nativeSymbol || this.configService.get<string>('blockchain.evmNativeSymbol') || 'MNT';
    this.custodyAddress = configOverride?.custodyAddress;

    const chain = defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: {
        decimals: 18,
        name: nativeSymbol,
        symbol: nativeSymbol,
      },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] },
      },
    });

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    }) as PublicClient;
  }

  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    description: string,
    maxRetries: number = 5,
    initialDelay: number = 2000,
  ): Promise<T> {
    let retries = 0;
    let delay = initialDelay;

    while (true) {
      try {
        return await operation();
      } catch (error: any) {
        retries++;
        if (retries > maxRetries) {
          this.logger.error(`Failed ${description} after ${maxRetries} retries: ${error.message}`);
          throw error;
        }
        this.logger.warn(
          `Error in ${description} (attempt ${retries}/${maxRetries}): ${error.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }

  async registerAsset(dto: any): Promise<{ txId: string }> {
    const { assetId, attestationHash, blobId, payload, signature } = dto;
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('AttestationRegistry');
    const abi = this.contractAdapter.getContractInterface('AttestationRegistry');

    this.logger.log(`Registering asset ${assetId} on EVM chain...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'registerAsset',
      args: [assetId, attestationHash, blobId, payload, signature],
    }), 'registerAsset write') as `0x${string}`;

    this.logger.log(`Asset registered on EVM: ${txId}`);
    return { txId };
  }

  async revokeAsset(assetId: string): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('AttestationRegistry');
    const abi = this.contractAdapter.getContractInterface('AttestationRegistry');

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'revokeAsset',
      args: [assetId, 'REASON_NOT_SPECIFIED'],
    }), 'revokeAsset write') as `0x${string}`;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({ hash: txId }), 'revokeAsset receipt');
    return { txId };
  }

  async deployToken(
    assetId: string,
    totalSupply: string | number,
    params: {
      name?: string;
      symbol?: string;
    }
  ): Promise<DeployedTokenResult> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('TokenFactory');
    const abi = this.contractAdapter.getContractInterface('TokenFactory');

    // Convert UUID to bytes32
    const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');
    const totalSupplyBigInt = BigInt(totalSupply);
    const issuer = wallet.account?.address;
    const { name, symbol } = params;

    this.logger.log(`Deploying EVM token for asset ${assetId}...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'deployTokenSuite',
      args: [assetIdBytes32, totalSupplyBigInt, name || 'RWA Token', symbol || 'RWA', issuer],
    }), 'deployTokenSuite write') as `0x${string}`;

    const receipt = await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: txId,
      timeout: 180000,
    }), 'deployTokenSuite receipt');

    let tokenAddress: string | undefined;
    let complianceAddress: string | undefined;

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi,
          data: log.data,
          topics: log.topics,
        }) as { eventName: string; args: any };

        if (decoded.eventName === 'TokenSuiteDeployed') {
          tokenAddress = decoded.args.token;
          complianceAddress = decoded.args.compliance;
          break;
        }
      } catch { continue; }
    }

    if (!tokenAddress) throw new Error('TokenSuiteDeployed event not found');

    return {
      primaryIdentifier: tokenAddress,
      auxiliaryIdentifier: complianceAddress,
      txId,
    };
  }

  async listOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: string | number,
    minInvestment: string | number,
    duration: number,
    totalSupply: string | number,
    minPrice?: string
  ): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('PrimaryMarketplace');
    const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

    const listingTypeEnum = listingType === ListingType.STATIC ? 0 : 1;

    // Look up the real assetId from the DB using the token address
    const asset = await this.assetModel.findOne({ 'token.address': new RegExp(`^${tokenIdentifier}$`, 'i') });
    if (!asset) {
      throw new Error(`Asset not found for token ${tokenIdentifier}`);
    }
    const assetIdBytes32 = ('0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0')) as `0x${string}`;

    this.logger.log(`Creating listing for asset ${asset.assetId} (token ${tokenIdentifier})...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'createListing',
      args: [
        assetIdBytes32,
        tokenIdentifier as Address,
        listingTypeEnum,
        fromCanonical(price.toString(), 6), // USDC Price (6 decimals)
        fromCanonical(minPrice || '0', 6), // Min Price (6 decimals)
        BigInt(duration),
        fromCanonical(totalSupply.toString(), 18), // Token Amount (18 decimals)
        fromCanonical(minInvestment.toString(), 6), // Min Investment (6 decimals)
      ],
    }), 'createListing write') as `0x${string}`;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: txId,
      timeout: 180000,
    }), 'createListing receipt');

    return { txId };
  }

  async endAuction(
    tokenIdentifier: string,
    clearingPrice: string
  ): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('PrimaryMarketplace');
    const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

    // Look up assetId from token address
    const asset = await this.assetModel.findOne({ 'token.address': new RegExp(`^${tokenIdentifier}$`, 'i') });
    if (!asset) {
      throw new Error(`Asset not found for token ${tokenIdentifier}`);
    }

    const assetIdBytes32 = ('0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0')) as `0x${string}`;

    this.logger.log(`Ending EVM auction for asset ${asset.assetId} with clearing price ${clearingPrice}...`);

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'endAuction',
      args: [assetIdBytes32, fromCanonical(clearingPrice, 6)],
    }), 'endAuction write') as `0x${string}`;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: txId,
      timeout: 180000,
    }), 'endAuction receipt');

    this.logger.log(`EVM Auction ended in tx: ${txId}`);
    return { txId };
  }

  async verifyPurchaseTransaction(
    txHash: string,
    assetId: string,
    expectedBuyer: string,
  ): Promise<PurchaseVerificationResult | null> {
    try {
      // Get transaction receipt
      const receipt = await this.executeWithRetry(() => this.publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }), 'getTransactionReceipt');

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Get block to extract timestamp
      const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });

      // Decode TokensPurchased event from logs
      const marketplaceAddress = this.contractAdapter.getContractAddress('PrimaryMarketplace');
      const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as unknown as { eventName: string; args: any };

          if (decoded.eventName === 'TokensPurchased') {
            const { assetId: eventAssetId, buyer, amount, price, totalPayment } = decoded.args;

            // Validate this is the correct purchase
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              buyer.toLowerCase() === expectedBuyer.toLowerCase()
            ) {
              return {
                amount: toCanonical(amount, 18),
                price: toCanonical(price, 6),
                totalPayment: toCanonical(totalPayment, 6),
                blockNumber: Number(receipt.blockNumber),
                timestamp: Number(block.timestamp),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`TokensPurchased event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating transaction ${txHash}:`, error.message);
      return null;
    }
  }

  async verifyBidTransaction(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidVerificationResult | null> {
    try {
      // Get transaction receipt
      const receipt = await this.executeWithRetry(() => this.publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }), 'getTransactionReceipt');

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Decode BidSubmitted event from logs
      const marketplaceAddress = this.contractAdapter.getContractAddress('PrimaryMarketplace');
      const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as unknown as { eventName: string; args: any };

          if (decoded.eventName === 'BidSubmitted') {
            const { assetId: eventAssetId, bidder, tokenAmount, price, bidIndex } = decoded.args;

            // Validate this is the correct bid
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              bidder.toLowerCase() === expectedBidder.toLowerCase()
            ) {
              return {
                tokenAmount: toCanonical(tokenAmount, 18),
                price: toCanonical(price, 6),
                bidIndex: Number(bidIndex),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`BidSubmitted event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating transaction ${txHash}:`, error.message);
      return null;
    }
  }

  async verifyBidSettlement(
    txHash: string,
    assetId: string,
    expectedBidder: string,
  ): Promise<BidSettlementResult | null> {
    try {
      // Get transaction receipt
      const receipt = await this.executeWithRetry(() => this.publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` }), 'getTransactionReceipt');

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Decode BidSettled event from logs
      const marketplaceAddress = this.contractAdapter.getContractAddress('PrimaryMarketplace');
      const abi = this.contractAdapter.getContractInterface('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as unknown as { eventName: string; args: any };
          if (decoded.eventName === 'BidSettled') {
            const {
              assetId: eventAssetId,
              bidder,
              tokensReceived,
              cost,
              refund,
            } = decoded.args;
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              bidder.toLowerCase() === expectedBidder.toLowerCase()
            ) {
              return {
                tokensReceived: toCanonical(tokensReceived, 18),
                refundAmount: toCanonical(refund, 6),
                cost: toCanonical(cost, 6),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`BidSettled event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating settlement transaction ${txHash}:`, error.message);
      return null;
    }
  }

  async registerIdentity(walletAddress: WalletAddress): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getAdminWallet();
    const address = this.contractAdapter.getContractAddress('IdentityRegistry');
    const abi = this.contractAdapter.getContractInterface('IdentityRegistry');

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'registerIdentity',
      args: [walletAddress],
    }), 'registerIdentity write') as `0x${string}`;

    await this.executeWithReceipt(txId, 'registerIdentity');

    return { txId };
  }

  private async executeWithReceipt(hash: string, description: string) {
    return await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: hash as `0x${string}`,
      timeout: 300000,
    }), `${description} receipt`);
  }

  async isVerified(walletAddress: WalletAddress): Promise<boolean> {
    const address = this.contractAdapter.getContractAddress('IdentityRegistry');
    const abi = this.contractAdapter.getContractInterface('IdentityRegistry');

    return await this.executeWithRetry(() => this.publicClient.readContract({
      address: address as Address,
      abi,
      functionName: 'isVerified',
      args: [walletAddress],
    }), 'isVerified check') as boolean;
  }

  async burnUnsoldTokens(
    tokenIdentifier: string,
    assetId: string,
  ): Promise<import('../blockchain-adapter.interface').TokenBurnResult | null> {
    this.logger.log(`🔥 ========== BURNING UNSOLD TOKENS (EVM) ==========`);
    this.logger.log(`   Token Address: ${tokenIdentifier}`);
    this.logger.log(`   Asset ID: ${assetId}`);

    const tokenAbi = this.contractAdapter.getContractInterface('RWAToken');

    // Get custody wallet address (where unsold tokens are held)
    const custodyWalletAddress = this.custodyAddress || this.configService.get<string>('blockchain.custodyAddress');

    if (!custodyWalletAddress) {
      throw new Error('Custody wallet address not configured');
    }

    this.logger.log(`   Checking custody wallet: ${custodyWalletAddress}`);

    // Get old total supply before burn
    const oldTotalSupply = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenIdentifier as Address,
      abi: tokenAbi,
      functionName: 'totalSupply',
      args: [],
    }), 'get totalSupply before burn') as bigint;

    this.logger.log(`   Old Total Supply: ${oldTotalSupply.toString()} wei (${Number(oldTotalSupply) / 1e18} tokens)`);

    // Check unsold balance in custody wallet
    const unsoldBalance = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenIdentifier as Address,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [custodyWalletAddress as Address],
    }), 'check unsold balance') as bigint;

    this.logger.log(`   Custody Balance: ${unsoldBalance.toString()} wei (${Number(unsoldBalance) / 1e18} tokens)`);

    if (unsoldBalance === 0n) {
      this.logger.log(`   ✅ No unsold tokens to burn - all tokens were sold`);
      return null;
    }

    // Burn unsold tokens from custody wallet
    this.logger.log(`   🔥 Burning ${Number(unsoldBalance) / 1e18} unsold tokens...`);

    let hash: Hash;
    const platformWalletAddress = this.walletAdapter.getAdminAddress();

    if (platformWalletAddress.toLowerCase() === custodyWalletAddress.toLowerCase()) {
      // If platform wallet IS custody wallet, use burn() directly
      this.logger.log(`   Using burn() (platform wallet is custody wallet)`);
      hash = await this.executeWithRetry(() => (this.walletAdapter.getAdminWallet() as any).writeContract({
        address: tokenIdentifier as Address,
        abi: tokenAbi,
        functionName: 'burn',
        args: [unsoldBalance],
      }), 'burn write');
    } else {
      // If different, use burnFrom (requires allowance)
      this.logger.log(`   Using burnFrom() (separate custody wallet)`);
      hash = await this.executeWithRetry(() => (this.walletAdapter.getAdminWallet() as any).writeContract({
        address: tokenIdentifier as Address,
        abi: tokenAbi,
        functionName: 'burnFrom',
        args: [custodyWalletAddress as Address, unsoldBalance],
      }), 'burnFrom write');
    }

    this.logger.log(`   Transaction submitted: ${hash}`);

    // Wait for confirmation
    const receipt = await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180000,
      pollingInterval: 2000,
    }), 'burn receipt');

    this.logger.log(`   ✅ Burn transaction confirmed in block ${receipt.blockNumber}`);

    // Get new total supply after burn
    const newTotalSupply = await this.executeWithRetry(() => this.publicClient.readContract({
      address: tokenIdentifier as Address,
      abi: tokenAbi,
      functionName: 'totalSupply',
      args: [],
    }), 'get totalSupply after burn') as bigint;

    this.logger.log(`   New Total Supply: ${newTotalSupply.toString()} wei (${Number(newTotalSupply) / 1e18} tokens)`);

    const tokensBurnedFormatted = `${(Number(unsoldBalance) / 1e18).toFixed(2)} tokens`;
    const oldTotalSupplyFormatted = `${(Number(oldTotalSupply) / 1e18).toFixed(2)} tokens`;
    const newTotalSupplyFormatted = `${(Number(newTotalSupply) / 1e18).toFixed(2)} tokens`;

    this.logger.log(`   Summary:`);
    this.logger.log(`     Burned: ${tokensBurnedFormatted}`);
    this.logger.log(`     Old Supply: ${oldTotalSupplyFormatted}`);
    this.logger.log(`     New Supply: ${newTotalSupplyFormatted}`);
    this.logger.log(`========================================\n`);

    return {
      txId: hash,
      blockNumber: Number(receipt.blockNumber),
      tokensBurned: unsoldBalance.toString(),
      tokensBurnedFormatted,
      oldTotalSupply: oldTotalSupply.toString(),
      oldTotalSupplyFormatted,
      newTotalSupply: newTotalSupply.toString(),
      newTotalSupplyFormatted,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  async depositYieldToVault(tokenIdentifier: string, usdcAmount: string): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getPlatformWallet();
    const yieldVaultAddress = this.contractAdapter.getContractAddress('YieldVault');
    const yieldVaultAbi = this.contractAdapter.getContractInterface('YieldVault');

    // Step 1: Approve USDC for YieldVault to spend
    const usdcAddress = this.contractAdapter.getContractAddress('USDC');
    const usdcAbi = this.contractAdapter.getContractInterface('USDC');

    this.logger.log(`[EVM] Approving YieldVault to spend ${usdcAmount} USDC...`);

    const approvalHash = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'approve',
      args: [yieldVaultAddress, BigInt(usdcAmount)],
    }), 'approve USDC write') as Hash;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: approvalHash,
      timeout: 180000,
      pollingInterval: 2000,
    }), 'approve USDC receipt');
    
    this.logger.log(`[EVM] USDC approved in tx: ${approvalHash}`);

    // Step 2: Deposit yield to vault
    this.logger.log(`[EVM] Depositing ${usdcAmount} USDC to YieldVault for token ${tokenIdentifier}...`);

    const depositHash = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: yieldVaultAddress as Address,
      abi: yieldVaultAbi,
      functionName: 'depositYield',
      args: [tokenIdentifier, BigInt(usdcAmount)],
    }), 'depositYield write') as Hash;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash: depositHash,
      timeout: 180000,
      pollingInterval: 2000,
    }), 'depositYield receipt');
    
    this.logger.log(`[EVM] Yield deposited in tx: ${depositHash}`);
    
    return { txId: depositHash };
  }

  async transferUSDC(recipientAddress: string, usdcAmount: string): Promise<{ txId: string }> {
    const wallet = this.walletAdapter.getPlatformWallet();
    const usdcAddress = this.contractAdapter.getContractAddress('USDC');
    const usdcAbi = this.contractAdapter.getContractInterface('USDC');

    this.logger.log(`[EVM] Transferring ${usdcAmount} USDC to ${recipientAddress}...`);

    const hash = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: usdcAddress as Address,
      abi: usdcAbi,
      functionName: 'transfer',
      args: [recipientAddress as Address, BigInt(usdcAmount)],
    }), 'USDC transfer write') as Hash;

    await this.executeWithRetry(() => this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 180000,
      pollingInterval: 2000,
    }), 'USDC transfer receipt');
    
    this.logger.log(`[EVM] USDC transferred in tx: ${hash}`);
    
    return { txId: hash };
  }
}

