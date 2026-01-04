import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { SolvencyBlockchainService } from '../services/solvency-blockchain.service';
import { SolvencyPositionService } from '../services/solvency-position.service';
import { PrivateAssetService } from '../services/private-asset.service';
import { MintPrivateAssetDto } from '../dto/mint-private-asset.dto';
import { ethers } from 'ethers';

@Controller('admin/solvency')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class SolvencyAdminController {
  constructor(
    private blockchainService: SolvencyBlockchainService,
    private positionService: SolvencyPositionService,
    private privateAssetService: PrivateAssetService,
  ) {}

  /**
   * Mint new Private Asset Token
   */
  @Post('private-asset/mint')
  @HttpCode(HttpStatus.CREATED)
  async mintPrivateAsset(@Body() dto: MintPrivateAssetDto) {
    const asset = await this.privateAssetService.mintPrivateAsset({
      name: dto.name,
      symbol: dto.symbol,
      assetType: dto.assetType,
      totalSupply: dto.totalSupply,
      valuation: dto.valuation,
      location: dto.location,
      documentHash: dto.documentHash,
      issuer: dto.issuer,
    });

    return {
      success: true,
      asset,
    };
  }

  /**
   * Update private asset valuation
   */
  @Post('private-asset/:id/valuation')
  @HttpCode(HttpStatus.OK)
  async updateValuation(
    @Param('id') id: string,
    @Body() body: { valuation: string; updatedBy: string },
  ) {
    const asset = await this.privateAssetService.updateValuation(
      id,
      body.valuation,
      body.updatedBy,
    );

    return {
      success: true,
      asset,
    };
  }

  /**
   * Update private asset status
   */
  @Post('private-asset/:id/status')
  @HttpCode(HttpStatus.OK)
  async updateAssetStatus(
    @Param('id') id: string,
    @Body() body: { isActive: boolean },
  ) {
    const asset = await this.privateAssetService.updateAssetStatus(id, body.isActive);

    return {
      success: true,
      asset,
    };
  }

  /**
   * Get all positions (admin view)
   */
  @Get('positions')
  async getAllPositions(
    @Query('status') status?: string,
    @Query('healthStatus') healthStatus?: string,
  ) {
    const positions = await this.positionService.getAllPositions(
      status as any,
      healthStatus as any,
    );

    return {
      success: true,
      count: positions.length,
      positions,
    };
  }

  /**
   * Get liquidatable positions
   */
  @Get('liquidatable')
  async getLiquidatablePositions() {
    const positions = await this.positionService.getLiquidatablePositions();

    return {
      success: true,
      count: positions.length,
      positions,
    };
  }

  /**
   * Get positions with health warnings
   */
  @Get('warnings')
  async getWarningPositions() {
    const positions = await this.positionService.getWarningPositions();

    return {
      success: true,
      count: positions.length,
      positions,
    };
  }

  /**
   * Liquidate position
   */
  @Post('liquidate/:id')
  @HttpCode(HttpStatus.OK)
  async liquidatePosition(@Param('id') id: string) {
    const positionId = parseInt(id);

    // Generate unique marketplace asset ID for liquidation
    const marketplaceAssetId = ethers.id(
      `liquidation-${positionId}-${Date.now()}`,
    );

    // Liquidate on-chain
    const result = await this.blockchainService.liquidatePosition(
      positionId,
      marketplaceAssetId,
    );

    // Update database
    const position = await this.positionService.markLiquidated(
      positionId,
      marketplaceAssetId,
      result.txHash,
    );

    // Update private asset tracking if applicable
    if (position.collateralTokenType === 'PRIVATE_ASSET') {
      const collateralChange = '-' + position.collateralAmount;
      const debtChange = '-' + position.usdcBorrowed;
      await this.privateAssetService.updateCollateralTracking(
        position.collateralTokenAddress,
        collateralChange,
        debtChange,
        -1,
      );
    }

    return {
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      marketplaceAssetId,
      discountedPrice: result.discountedPrice,
      position,
    };
  }

  /**
   * Sync position with blockchain
   */
  @Post('position/:id/sync')
  @HttpCode(HttpStatus.OK)
  async syncPosition(@Param('id') id: string) {
    const positionId = parseInt(id);
    const position = await this.positionService.syncPositionWithBlockchain(positionId);

    return {
      success: true,
      position,
    };
  }

  /**
   * Get all private assets (admin view)
   */
  @Get('private-assets')
  async getAllPrivateAssets(
    @Query('assetType') assetType?: string,
    @Query('isActive') isActive?: string,
  ) {
    const assets = await this.privateAssetService.getAllPrivateAssets(
      assetType as any,
      isActive === 'true' ? true : isActive === 'false' ? false : undefined,
    );

    return {
      success: true,
      count: assets.length,
      assets,
    };
  }

  /**
   * Get private asset statistics
   */
  @Get('private-assets/stats')
  async getPrivateAssetStats() {
    const stats = await this.privateAssetService.getAssetStatistics();

    return {
      success: true,
      stats,
    };
  }

  /**
   * Get private assets by issuer
   */
  @Get('private-assets/issuer/:address')
  async getAssetsByIssuer(@Param('address') address: string) {
    const assets = await this.privateAssetService.getAssetsByIssuer(address);

    return {
      success: true,
      count: assets.length,
      assets,
    };
  }
}
