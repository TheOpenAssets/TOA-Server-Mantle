import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { ListingType, WalletAddress } from '@openassets/types';
import { 
  BLOCKCHAIN_ADAPTER, 
  WALLET_ADAPTER, 
  CONTRACT_ADAPTER 
} from '../blockchain.constants';
import { BlockchainAdapter } from '../adapters/blockchain-adapter.interface';

@Injectable()
export class NetworkRegistryService implements OnModuleInit {
  private readonly logger = new Logger(NetworkRegistryService.name);
  private features: Record<string, boolean>;
  private networkType: string;
  private blockchainAdapter?: BlockchainAdapter;

  constructor(
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {
    this.features = this.configService.get<Record<string, boolean>>('network.features') || {};
    this.networkType = this.configService.get<string>('network.networkType') || 'mantle';
  }

  async onModuleInit() {
    try {
      this.blockchainAdapter = this.moduleRef.get<BlockchainAdapter>(BLOCKCHAIN_ADAPTER, { strict: false });
    } catch (e: any) {
      this.logger.warn(`Blockchain adapter not yet available during onModuleInit: ${e.message}`);
    }
  }

  private async getBlockchainAdapter(): Promise<BlockchainAdapter> {
    if (!this.blockchainAdapter) {
      this.blockchainAdapter = await this.moduleRef.resolve<BlockchainAdapter>(BLOCKCHAIN_ADAPTER);
    }
    return this.blockchainAdapter;
  }

  isAvailable(feature: string): boolean {
    return !!this.features[feature];
  }

  getNetworkType(): string {
    return this.networkType;
  }

  async registerIdentityOnChain(walletAddress: WalletAddress) {
    if (!this.isAvailable('kyc')) {
      return { completed: false, skipped: true, reason: 'KYC_FEATURE_DISABLED' };
    }
    const adapter = await this.getBlockchainAdapter();
    return await adapter.registerIdentity(walletAddress);
  }

  async deployAssetToken(
    assetId: string, 
    totalSupply: number, 
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
    const adapter = await this.getBlockchainAdapter();
    return await adapter.deployToken(assetId, totalSupply, params);
  }

  async registerAssetOnChain(dto: any) {
    if (!this.isAvailable('assets')) {
      return { completed: false, skipped: true, reason: 'ASSETS_FEATURE_DISABLED' };
    }
    const adapter = await this.getBlockchainAdapter();
    return await adapter.registerAsset(dto);
  }

  async revokeAssetOnChain(assetId: string) {
    if (!this.isAvailable('assets')) {
      return { completed: false, skipped: true, reason: 'ASSETS_FEATURE_DISABLED' };
    }
    const adapter = await this.getBlockchainAdapter();
    return await adapter.revokeAsset(assetId);
  }

  async listAssetOnMarketplace(
    tokenIdentifier: string,
    listingType: ListingType,
    price: number,
    minInvestment: number,
    duration: number,
    totalSupply: number,
    minPrice?: string
  ) {
    if (!this.isAvailable('marketplace')) {
      return { completed: false, skipped: true, reason: 'MARKETPLACE_FEATURE_DISABLED' };
    }
    const adapter = await this.getBlockchainAdapter();
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

  async deactivateListingOnMarketplace(tokenIdentifier: string) {
    if (!this.isAvailable('marketplace')) {
      return { completed: false, skipped: true, reason: 'MARKETPLACE_FEATURE_DISABLED' };
    }
    const adapter = await this.getBlockchainAdapter();
    if (adapter && 'deactivateListing' in adapter) {
      return await (adapter as any).deactivateListing(tokenIdentifier);
    }
    return { completed: false, skipped: true, reason: 'METHOD_NOT_SUPPORTED_BY_ADAPTER' };
  }

  async approveTrustlineForUser(userAddress: WalletAddress, assetIdentifier: string) {
    if (this.networkType !== 'stellar') {
      return { completed: false, skipped: true, reason: 'NOT_APPLICABLE_ON_NETWORK' };
    }
    const adapter = await this.getBlockchainAdapter();
    if (adapter && adapter.approveTrustline) {
      return await adapter.approveTrustline(userAddress, assetIdentifier);
    }
    return { completed: false, skipped: true, reason: 'METHOD_NOT_SUPPORTED_BY_ADAPTER' };
  }
}
