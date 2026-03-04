import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListingType, WalletAddress, NetworkType } from '@openassets/types';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';
import { ChainManagerRegistry } from './chain-manager-registry.service';
import { NetworkContextService } from './network-context.service';

@Injectable()
export class NetworkRegistryService {
  private readonly logger = new Logger(NetworkRegistryService.name);
  private features: Record<string, boolean>;

  constructor(
    private readonly configService: ConfigService,
    private readonly chainManagerRegistry: ChainManagerRegistry,
    private readonly networkContextService: NetworkContextService,
  ) {
    this.features = this.configService.get<Record<string, boolean>>('network.features') || {};
  }

  private getBlockchainAdapter(): BlockchainAdapter {
    const network = this.networkContextService.getNetwork();
    const manager = this.chainManagerRegistry.getManager(network);
    return manager.getBlockchainAdapter();
  }

  isAvailable(feature: string): boolean {
    // In multi-network mode, features could also be per-network
    // For now, keep the global check or expand it
    return !!this.features[feature];
  }

  getNetworkType(): NetworkType {
    return this.networkContextService.getNetwork();
  }

  async registerIdentityOnChain(walletAddress: WalletAddress) {
    if (!this.isAvailable('kyc')) {
      return { completed: false, skipped: true, reason: 'KYC_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.registerIdentity(walletAddress);
  }

  async deployAssetToken(
    assetId: string, 
    totalSupply: string | number, 
    params: {
      name?: string;
      symbol?: string;
      attestationHash?: string;
      blobId?: string;
    }
  ) {
    if (!this.isAvailable('assets')) {
      return { completed: false, skipped: true, reason: 'ASSETS_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.deployToken(assetId, totalSupply, params);
  }

  async registerAssetOnChain(dto: any) {
    if (!this.isAvailable('assets')) {
      return { completed: false, skipped: true, reason: 'ASSETS_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.registerAsset(dto);
  }

  async revokeAssetOnChain(assetId: string) {
    if (!this.isAvailable('assets')) {
      return { completed: false, skipped: true, reason: 'ASSETS_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.revokeAsset(assetId);
  }

  async listAssetOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: string | number,
    minInvestment: string | number,
    duration: number,
    totalSupply: string | number,
    minPrice?: string
  ) {
    if (!this.isAvailable('marketplace')) {
      return { completed: false, skipped: true, reason: 'MARKETPLACE_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.listOnMarketplace(
      tokenIdentifier,
      listingType,
      price,
      minInvestment,
      duration,
      totalSupply,
      minPrice
    );
  }

  async endAuctionOnMarketplace(tokenIdentifier: string, clearingPrice: string) {
    if (!this.isAvailable('marketplace')) {
      return { completed: false, skipped: true, reason: 'MARKETPLACE_FEATURE_DISABLED' };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.endAuction(tokenIdentifier, clearingPrice);
  }

  async approveTrustlineForUser(userAddress: WalletAddress, assetIdentifier: string) {
    const network = this.getNetworkType();
    if (network !== NetworkType.STELLAR) {
      return { completed: false, skipped: true, reason: 'NOT_APPLICABLE_ON_NETWORK' };
    }
    const adapter = this.getBlockchainAdapter();
    if (adapter && adapter.approveTrustline) {
      return await adapter.approveTrustline(userAddress, assetIdentifier);
    }
    return { completed: false, skipped: true, reason: 'METHOD_NOT_SUPPORTED_BY_ADAPTER' };
  }

  async depositYieldToVault(
    tokenIdentifier: string,
    usdcAmount: string,
  ): Promise<{ txId: string; skipped?: boolean }> {
    if (!this.isAvailable('yield')) {
      this.logger.warn(`Yield feature disabled on ${this.getNetworkType()}, skipping vault deposit`);
      return { txId: '', skipped: true };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.depositYieldToVault(tokenIdentifier, usdcAmount);
  }

  async transferUSDCForFee(
    recipientAddress: string,
    usdcAmount: string,
  ): Promise<{ txId: string; skipped?: boolean }> {
    if (!this.isAvailable('yield')) {
      this.logger.warn(`Yield feature disabled on ${this.getNetworkType()}, skipping fee transfer`);
      return { txId: '', skipped: true };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.transferUSDC(recipientAddress, usdcAmount);
  }

  async burnUnsoldTokens(tokenIdentifier: string, assetId: string) {
    if (!this.isAvailable('assets')) {
      return null;
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.burnUnsoldTokens(tokenIdentifier, assetId);
  }

  async payoutToRecipient(recipientAddress: string, usdcAmount: string) {
    if (!this.isAvailable('assets')) {
      return { txId: '', skipped: true };
    }
    const adapter = this.getBlockchainAdapter();
    return await adapter.transferUSDC(recipientAddress, usdcAmount);
  }

  async getInvestorClaimableYield(userAddress: string, tokenAddress?: string): Promise<string> {
    if (!this.isAvailable('yield')) {
      return '0.0000';
    }
    const adapter = this.getBlockchainAdapter();
    if (adapter.getClaimableYield) {
      return await adapter.getClaimableYield(userAddress, tokenAddress);
    }
    return '0.0000';
  }
}
