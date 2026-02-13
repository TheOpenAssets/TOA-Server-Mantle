import { Controller, Post, Get, Body, UseGuards, Param, Query, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ModuleRegistryService } from '../../registry/services/module-registry.service';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { DeployTokenDto } from '../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../blockchain/dto/list-on-marketplace.dto';
import { CreateAuctionDto } from '../../marketplace/dto/create-auction.dto';
import { EndAuctionDto } from '../../marketplace/dto/end-auction.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { AssetStatus } from '@openassets/types';

import { AuctionService } from '../../marketplace/services/auction.service';

@Controller('admin/assets')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AssetOpsController {
  private readonly logger = new Logger(AssetOpsController.name);

  constructor(
    private readonly moduleRegistryService: ModuleRegistryService,
    private readonly assetLifecycleService: AssetLifecycleService,
    private readonly auctionService: AuctionService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) { }

  private get adminStrategy() {
    return this.moduleRegistryService.getAdminDomainStrategy();
  }

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
      return await this.adminStrategy.registerAsset(assetId);
    } catch (error: any) {
      this.handleError(error, assetId, 'Asset Registration Failed');
    }
  }

  @Post('deploy-token')
  async deployToken(@Body() dto: DeployTokenDto) {
    try {
      return await this.adminStrategy.deployToken(dto);
    } catch (error: any) {
      this.handleError(error, dto.assetId, 'Token Deployment Failed');
    }
  }

  @Post(':assetId/revoke')
  async revokeAsset(@Param('assetId') assetId: string, @Body('reason') reason: string) {
    try {
      return await this.adminStrategy.revokeAsset(assetId, reason);
    } catch (error: any) {
      this.handleError(error, assetId, 'Revocation Failed');
    }
  }

  @Post('list-on-marketplace')
  async listOnMarketplace(@Body() dto: ListOnMarketplaceDto) {
    try {
      return await this.adminStrategy.listOnMarketplace(dto);
    } catch (error: any) {
      this.handleError(error, dto.assetId, 'Listing Failed');
    }
  }

  @Post(':assetId/end-auction-onchain')
  async endAuctionOnChain(
    @Param('assetId') assetId: string,
    @Body('clearingPrice') clearingPrice: string,
  ) {
    try {
      return await this.adminStrategy.endAuctionOnChain(assetId, clearingPrice);
    } catch (error: any) {
      this.handleError(error, assetId, 'End Auction Failed');
    }
  }

  @Post(':assetId/approve-marketplace')
  async approveMarketplace(@Param('assetId') assetId: string) {
    try {
      return await this.adminStrategy.approveMarketplace(assetId);
    } catch (error: any) {
      this.handleError(error, assetId, 'Approval Failed');
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

  private handleError(error: any, assetId: string, defaultTitle: string) {
    if (error instanceof HttpException) {
      throw error;
    }

    const errorMessage = error.message || 'Unknown error';
    throw new HttpException(
      {
        success: false,
        error: defaultTitle,
        message: errorMessage.split('\n')[0],
        assetId,
        details: error.shortMessage || errorMessage,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
