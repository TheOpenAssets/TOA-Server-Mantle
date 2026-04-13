import { Injectable, Logger } from '@nestjs/common';
import { Hash } from 'viem';
import { ListingType } from '@openassets/types';
import { NetworkRegistryService } from './network-registry.service';
import { RegisterAssetDto } from '../dto/register-asset.dto';
import { DeployTokenDto } from '../dto/deploy-token.dto';

@Injectable()
export class BlockchainService {
  private readonly logger = new Logger(BlockchainService.name);

  constructor(
    private networkRegistry: NetworkRegistryService,
  ) { }

  async registerAsset(dto: RegisterAssetDto): Promise<Hash> {
    const result = await this.networkRegistry.registerAssetOnChain(dto);
    if ('txId' in result) return result.txId as Hash;
    throw new Error(`registerAsset skipped: ${(result as any).reason}`);
  }

  async registerIdentity(walletAddress: string): Promise<Hash> {
    const result = await this.networkRegistry.registerIdentityOnChain(walletAddress);
    if ('txId' in result) return result.txId as Hash;
    throw new Error(`registerIdentity skipped: ${(result as any).reason}`);
  }

  async deployToken(dto: DeployTokenDto): Promise<{ hash: string; tokenAddress?: string; complianceAddress?: string }> {
    const result = await this.networkRegistry.deployAssetToken(dto.assetId, dto.totalSupply || 0, {
      name: dto.name,
      symbol: dto.symbol,
    });
    if ('txId' in result) {
      return {
        hash: result.txId,
        tokenAddress: result.primaryIdentifier,
        complianceAddress: result.auxiliaryIdentifier,
      };
    }
    throw new Error(`deployToken skipped: ${(result as any).reason}`);
  }

  async depositYield(tokenAddress: string, amount: string): Promise<Hash> {
    const result = await this.networkRegistry.depositYieldToVault(tokenAddress, amount);
    return result.txId as Hash;
  }

  async distributeYield(tokenAddress: string, holders: string[], amounts: string[]): Promise<Hash> {
    // This method is not in NetworkRegistryService yet, adding it would be better
    // For now, route directly to adapter
    const adapter = (this.networkRegistry as any).getBlockchainAdapter();
    if (adapter.distributeYield) {
      return await adapter.distributeYield(tokenAddress, holders, amounts);
    }
    throw new Error('distributeYield not supported on this network');
  }

  async listOnMarketplace(
    tokenAddress: string,
    type: 'STATIC' | 'AUCTION',
    price: string,
    minInvestment: string,
    duration?: string,
    minPrice?: string,
    issuerVaultAddress?: string,
  ): Promise<Hash> {
    const listingType = type === 'STATIC' ? ListingType.STATIC : ListingType.AUCTION;

    const result = await this.networkRegistry.listAssetOnMarketplace(
      tokenAddress,
      listingType as any,
      price,
      minInvestment,
      Number(duration || 0),
      '0', // placeholder, adapter will look up if needed
      minPrice,
      issuerVaultAddress,
    );
    if ('txId' in result) return result.txId as Hash;
    throw new Error(`listOnMarketplace skipped: ${(result as any).reason}`);
  }

  async approveMarketplace(tokenAddress: string): Promise<Hash> {
    const adapter = (this.networkRegistry as any).getBlockchainAdapter();
    if (adapter.approveMarketplace) {
      const result = await adapter.approveMarketplace(tokenAddress);
      return result.txId as Hash;
    }
    // Stellar handles this differently (no-op or trustline)
    return '0x0' as Hash;
  }

  async endAuction(assetId: string, clearingPrice: string): Promise<Hash> {
    // Find token address first since networkRegistry uses tokenIdentifier
    const adapter = (this.networkRegistry as any).getBlockchainAdapter();
    const asset = await (adapter as any).assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new Error(`Asset or token not found for ${assetId}`);
    }

    const result = await this.networkRegistry.endAuctionOnMarketplace(asset.token.address, clearingPrice);
    if ('txId' in result) return result.txId as Hash;
    throw new Error(`endAuction skipped: ${(result as any).reason}`);
  }

  async revokeAsset(assetId: string, reason: string): Promise<Hash> {
    const result = await this.networkRegistry.revokeAssetOnChain(assetId);
    if ('txId' in result) return result.txId as Hash;
    throw new Error(`revokeAsset skipped: ${(result as any).reason}`);
  }

  async isVerified(walletAddress: string): Promise<boolean> {
    const adapter = (this.networkRegistry as any).getBlockchainAdapter();
    return await adapter.isVerified(walletAddress);
  }
}

