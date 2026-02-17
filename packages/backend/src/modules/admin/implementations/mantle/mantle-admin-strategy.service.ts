import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../../database/schemas/asset.schema';
import { BlockchainService } from '../../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../../assets/services/asset-lifecycle.service';
import { NotificationService } from '../../../notifications/services/notification.service';
import { IAdminDomainStrategy } from '../../../registry/interfaces/admin-domain.interface';
import { DeployTokenDto } from '../../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../../blockchain/dto/list-on-marketplace.dto';
import { NetworkRegistryService } from '../../../blockchain/services/network-registry.service';
import { 
  AssetStatus, 
  NotificationType, 
  NotificationSeverity, 
  NotificationAction 
} from '@openassets/types';

@Injectable()
export class MantleAdminStrategy implements IAdminDomainStrategy {
  private readonly logger = new Logger(MantleAdminStrategy.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private readonly blockchainService: BlockchainService,
    private readonly networkRegistryService: NetworkRegistryService,
    private readonly assetLifecycleService: AssetLifecycleService,
    private readonly notificationService: NotificationService,
  ) { }

  async registerAsset(assetId: string): Promise<any> {
    const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
    const txHash = await this.blockchainService.registerAsset(payload);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.REGISTERED,
          'registry.transactionHash': txHash,
          'registry.registeredAt': new Date(),
          'checkpoints.registered': true,
        },
      },
    );

    const asset = await this.assetModel.findOne({ assetId });
    if (asset) {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Asset Registered On-Chain',
        detail: `Your asset ${asset.metadata.invoiceNumber} has been successfully registered on the blockchain.`,
        type: NotificationType.ASSET_STATUS,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: { assetId },
      });
    }

    return {
      success: true,
      message: 'Asset successfully registered on-chain and database updated',
      assetId,
      status: AssetStatus.REGISTERED,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async deployToken(dto: DeployTokenDto): Promise<any> {
    const result = await this.blockchainService.deployToken(dto);

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.TOKENIZED,
          'token.address': result.tokenAddress,
          'token.deployedAt': new Date(),
          'token.transactionHash': result.hash,
          'token.supply': dto.totalSupply,
          'checkpoints.tokenized': true,
        },
      },
    );

    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (asset) {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Token Deployment Complete',
        detail: `Your asset ${asset.metadata.invoiceNumber} has been tokenized. Token address: ${result.tokenAddress}`,
        type: NotificationType.TOKEN_DEPLOYED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: { assetId: dto.assetId, tokenAddress: result.tokenAddress },
      });
    }

    return {
      success: true,
      message: 'Token deployed successfully and database updated',
      assetId: dto.assetId,
      status: AssetStatus.TOKENIZED,
      tokenAddress: result.tokenAddress,
      complianceAddress: result.complianceAddress,
      transactionHash: result.hash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${result.hash}`,
    };
  }

  async listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const listingType = asset.assetType;
    const price = asset.tokenParams?.pricePerToken;
    const minInvestment = asset.tokenParams?.minInvestment;
    const duration = dto.duration;

    if (listingType === 'AUCTION' && !duration) {
      throw new HttpException('Duration is required for AUCTION listings', HttpStatus.BAD_REQUEST);
    }

    if (!listingType || !price || !minInvestment) {
      throw new HttpException('Required listing parameters missing in database', HttpStatus.BAD_REQUEST);
    }

    const minPrice = listingType === 'AUCTION'
      ? (asset.listing?.priceRange?.min || price)
      : '0';

    const txHash = await this.blockchainService.listOnMarketplace(
      asset.token.address,
      listingType,
      price,
      minInvestment,
      duration,
      minPrice,
    );

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.LISTED,
          'listing.type': listingType,
          'listing.price': price,
          'listing.active': true,
          'listing.listedAt': new Date(),
          'listing.sold': '0',
          'listing.phase': listingType === 'AUCTION' ? 'BIDDING' : undefined,
          'listing.duration': duration,
        },
      },
    );

    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Asset Listed on Marketplace',
      detail: `Your asset ${asset.metadata.invoiceNumber} is now live on the marketplace.`,
      type: NotificationType.MARKETPLACE_LISTING,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_MARKETPLACE,
      actionMetadata: { assetId: dto.assetId, tokenAddress: asset.token.address },
    });

    return {
      success: true,
      message: 'Token listed on marketplace',
      assetId: dto.assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async revokeAsset(assetId: string, reason: string): Promise<any> {
    const txHash = await this.blockchainService.revokeAsset(assetId, reason);
    await this.assetModel.updateOne(
        { assetId },
        { $set: { status: AssetStatus.REVOKED } }
    );
    return {
      success: true,
      message: 'Asset revoked on-chain',
      assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const resultOrStatus: any = await this.networkRegistryService.endAuctionOnMarketplace(asset.token.address, clearingPrice);
    
    if (resultOrStatus.skipped) {
      throw new HttpException(`Auction end skipped: ${resultOrStatus.reason}`, HttpStatus.BAD_REQUEST);
    }

    const txId = resultOrStatus.txId;
    const result = await this.assetLifecycleService.endAuction(assetId, clearingPrice, txId);
    return {
      ...result,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txId}`,
    };
  }

  async approveMarketplace(assetId: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const txHash = await this.blockchainService.approveMarketplace(asset.token.address);

    return {
      success: true,
      message: 'Marketplace approved to spend tokens',
      assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }
}
