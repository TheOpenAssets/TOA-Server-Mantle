import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  createPublicClient, 
  http, 
  Address, 
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

  constructor(
    private readonly configService: ConfigService,
    private readonly walletAdapter: EvmWalletAdapter,
    private readonly contractAdapter: EvmContractAdapter,
    private readonly assetModel: Model<AssetDocument>,
  ) {
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') || 'http://localhost:8545';
    const chainId = this.configService.get<number>('blockchain.chainId') || 5003;
    const networkName = this.configService.get<string>('network.networkName') || 'Mantle Sepolia';

    const chain = defineChain({
      id: chainId,
      name: networkName,
      nativeCurrency: {
        decimals: 18,
        name: 'MNT',
        symbol: 'MNT',
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
    const dummyAssetId = '0x' + '0'.repeat(64); 

    const txId = await this.executeWithRetry(() => (wallet as any).writeContract({
      address: address as Address,
      abi,
      functionName: 'createListing',
      args: [
        dummyAssetId,
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
}
