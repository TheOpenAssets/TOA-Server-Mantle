import { Controller, Post, Get, Body, UseGuards, Param, Query, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { DeployTokenDto } from '../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../blockchain/dto/list-on-marketplace.dto';
import { CreateAuctionDto } from '../../marketplace/dto/create-auction.dto';
import { EndAuctionDto } from '../../marketplace/dto/end-auction.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';

import { AuctionService } from '../../marketplace/services/auction.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

@Controller('admin/assets')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AssetOpsController {
  private readonly logger = new Logger(AssetOpsController.name);

  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly assetLifecycleService: AssetLifecycleService,
    private readonly auctionService: AuctionService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private readonly notificationService: NotificationService,
  ) {}

  @Get()
  async getAllAssets(
    @Query('status') status?: AssetStatus,
    @Query('originator') originator?: string,
    @Query('needsAttention') needsAttention?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      status,
      originator,
      needsAttention: needsAttention === 'true',
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    return this.assetLifecycleService.getAllAssets(filters);
  }

  @Post(':assetId/register')
  async registerAsset(@Param('assetId') assetId: string) {
    try {
      const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
      const txHash = await this.blockchainService.registerAsset(payload);

      // Update MongoDB status to REGISTERED (atomic operation)
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

      // Get asset for notification
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
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${txHash}`,
      };
    } catch (error: any) {
      // Parse blockchain errors
      const errorMessage = error.message || 'Unknown error';

      // Check for common contract revert reasons
      if (errorMessage.includes('Asset already registered')) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Already Registered',
            message: 'This asset has already been registered on-chain',
            assetId,
            details: 'The asset cannot be registered twice. If you need to update it, use the revoke and re-register flow.',
          },
          HttpStatus.CONFLICT,
        );
      }

      if (errorMessage.includes('Invalid signature')) {
        throw new HttpException(
          {
            success: false,
            error: 'Invalid Attestation Signature',
            message: 'The attestation signature verification failed',
            assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Generic blockchain error
      throw new HttpException(
        {
          success: false,
          error: 'Blockchain Transaction Failed',
          message: errorMessage.split('\n')[0], // First line of error
          assetId,
          details: error.shortMessage || errorMessage,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('deploy-token')
  async deployToken(@Body() dto: DeployTokenDto) {
    try {
      const result = await this.blockchainService.deployToken(dto);

      // Update MongoDB status to TOKENIZED (atomic operation)
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

      // Get asset for notification
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
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${result.hash}`,
      };
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown error';

      // Check for common token deployment errors
      if (errorMessage.includes('Asset not registered')) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Not Registered',
            message: 'The asset must be registered on-chain before deploying a token',
            assetId: dto.assetId,
            hint: 'Call POST /admin/assets/:assetId/register first',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (errorMessage.includes('Token already deployed')) {
        throw new HttpException(
          {
            success: false,
            error: 'Token Already Deployed',
            message: 'A token has already been deployed for this asset',
            assetId: dto.assetId,
          },
          HttpStatus.CONFLICT,
        );
      }
      
      // Generic blockchain error
      throw new HttpException(
        {
          success: false,
          error: 'Token Deployment Failed',
          message: errorMessage.split('\n')[0],
          assetId: dto.assetId,
          details: error.shortMessage || errorMessage,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post(':assetId/revoke')
  async revokeAsset(@Param('assetId') assetId: string, @Body('reason') reason: string) {
    try {
      const txHash = await this.blockchainService.revokeAsset(assetId, reason);
      return {
        success: true,
        message: 'Asset revoked on-chain',
        assetId,
        reason,
        transactionHash: txHash,
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${txHash}`,
      };
    } catch (error: any) {
      throw new HttpException(
        {
          success: false,
          error: 'Revocation Failed',
          message: error.message?.split('\n')[0] || 'Failed to revoke asset',
          assetId,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('list-on-marketplace')
  async listOnMarketplace(@Body() dto: ListOnMarketplaceDto) {
    try {
      // First, get the asset and extract token address
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      
      if (!asset) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Not Found',
            message: 'Asset does not exist in database',
            assetId: dto.assetId,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (!asset.token?.address) {
        throw new HttpException(
          {
            success: false,
            error: 'Token Not Deployed',
            message: 'Token has not been deployed for this asset yet',
            assetId: dto.assetId,
            hint: 'Call POST /admin/assets/deploy-token first',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // Extract values from database (single source of truth)
      const listingType = asset.assetType;
      const price = asset.tokenParams?.pricePerToken;
      const minInvestment = asset.tokenParams?.minInvestment;
      const duration = dto.duration; // Only used for AUCTION

      // Validate required values exist in database
      if (!listingType) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Type Not Available',
            message: 'Asset type not found in database',
            assetId: dto.assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!price) {
        throw new HttpException(
          {
            success: false,
            error: 'Price Not Available',
            message: 'Price per token not found in asset tokenParams',
            assetId: dto.assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!minInvestment) {
        throw new HttpException(
          {
            success: false,
            error: 'Min Investment Not Available',
            message: 'Minimum investment not found in asset tokenParams',
            assetId: dto.assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`Listing asset ${dto.assetId} - Type: ${listingType}, Price: ${price}, MinInv: ${minInvestment}`);

      // List on marketplace
      const txHash = await this.blockchainService.listOnMarketplace(
        asset.token.address,
        listingType,
        price,
        minInvestment,
        duration,
      );

      // Update asset listing status in DB
      await this.assetModel.updateOne(
        { assetId: dto.assetId },
        {
          $set: {
            status: AssetStatus.LISTED,
            'listing.type': listingType,
            'listing.price': price,
            'listing.active': true,
            'listing.listedAt': new Date(),
            'listing.sold': '0', // Initialize sold amount
          },
        },
      );

      // Send notification for marketplace listing
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Asset Listed on Marketplace',
        detail: `Your asset ${asset.metadata.invoiceNumber} is now live on the marketplace and available for investment.`,
        type: NotificationType.MARKETPLACE_LISTING,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_MARKETPLACE,
        actionMetadata: { assetId: dto.assetId, tokenAddress: asset.token.address },
      });

      return {
        success: true,
        message: 'Token listed on marketplace',
        assetId: dto.assetId,
        tokenAddress: asset.token.address,
        listingType,
        price,
        minInvestment,
        duration,
        transactionHash: txHash,
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${txHash}`,
      };
    } catch (error: any) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error.message || 'Unknown error';

      // Check for marketplace-specific errors
      if (errorMessage.includes('Token already listed')) {
        throw new HttpException(
          {
            success: false,
            error: 'Already Listed',
            message: 'This token is already listed on the marketplace',
            assetId: dto.assetId,
          },
          HttpStatus.CONFLICT,
        );
      }

      throw new HttpException(
        {
          success: false,
          error: 'Listing Failed',
          message: errorMessage.split('\n')[0],
          assetId: dto.assetId,
          details: error.shortMessage || errorMessage,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post(':assetId/end-auction-onchain')
  async endAuctionOnChain(
    @Param('assetId') assetId: string,
    @Body('clearingPrice') clearingPrice: string,
  ) {
    try {
      // Get the asset from database
      const asset = await this.assetModel.findOne({ assetId });

      if (!asset) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Not Found',
            message: 'Asset does not exist in database',
            assetId,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (asset.assetType !== 'AUCTION') {
        throw new HttpException(
          {
            success: false,
            error: 'Not an Auction',
            message: 'Asset is not an auction type',
            assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!clearingPrice) {
        throw new HttpException(
          {
            success: false,
            error: 'Missing Clearing Price',
            message: 'Clearing price is required to end auction',
            assetId,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`Ending auction on-chain for asset ${assetId}, clearing price: ${clearingPrice}`);

      // Call blockchain service to end auction on-chain
      const txHash = await this.blockchainService.endAuction(assetId, clearingPrice);

      // Update database with transaction hash and clearing price
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'listing.clearingPrice': clearingPrice,
            'listing.active': false,
            'listing.endedAt': new Date(),
            'listing.endTransactionHash': txHash,
          },
        },
      );

      return {
        success: true,
        message: 'Auction ended on-chain successfully',
        assetId,
        clearingPrice,
        transactionHash: txHash,
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${txHash}`,
      };
    } catch (error: any) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error.message || 'Unknown error';

      throw new HttpException(
        {
          success: false,
          error: 'End Auction Failed',
          message: errorMessage.split('\n')[0],
          assetId,
          details: error.shortMessage || errorMessage,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post(':assetId/approve-marketplace')
  async approveMarketplace(@Param('assetId') assetId: string) {
    try {
      // Get the asset from database
      const asset = await this.assetModel.findOne({ assetId });

      if (!asset) {
        throw new HttpException(
          {
            success: false,
            error: 'Asset Not Found',
            message: 'Asset does not exist in database',
            assetId,
          },
          HttpStatus.NOT_FOUND,
        );
      }

      if (!asset.token?.address) {
        throw new HttpException(
          {
            success: false,
            error: 'Token Not Deployed',
            message: 'Token has not been deployed for this asset yet',
            assetId,
            hint: 'Call POST /admin/assets/deploy-token first',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      this.logger.log(`Approving marketplace for asset ${assetId}, token: ${asset.token.address}`);

      // Approve marketplace to spend tokens
      const txHash = await this.blockchainService.approveMarketplace(asset.token.address);

      return {
        success: true,
        message: 'Marketplace approved to spend tokens',
        assetId,
        tokenAddress: asset.token.address,
        transactionHash: txHash,
        explorerUrl: `https://explorer.sepolia.mantle.xyz/tx/${txHash}`,
      };
    } catch (error: any) {
      // Re-throw HttpExceptions as-is
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error.message || 'Unknown error';

      throw new HttpException(
        {
          success: false,
          error: 'Approval Failed',
          message: errorMessage.split('\n')[0],
          assetId,
          details: error.shortMessage || errorMessage,
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('auctions/create')
  async createAuction(@Body() dto: CreateAuctionDto) {
    return this.auctionService.createAuction(dto);
  }

  @Post('auctions/end')
  async endAuction(@Body() dto: EndAuctionDto) {
    return this.auctionService.calculateAndEndAuction(dto.assetId);
  }
}
