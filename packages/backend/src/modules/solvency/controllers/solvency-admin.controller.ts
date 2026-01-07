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
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { SolvencyBlockchainService } from '../services/solvency-blockchain.service';
import { SolvencyPositionService } from '../services/solvency-position.service';
import { PrivateAssetService } from '../services/private-asset.service';
import { LeverageBlockchainService } from '../../leverage/services/leverage-blockchain.service';
import { LeveragePositionService } from '../../leverage/services/leverage-position.service';
import { MethPriceService } from '../../blockchain/services/meth-price.service';
import { MintPrivateAssetDto } from '../dto/mint-private-asset.dto';
import { ApprovePrivateAssetRequestDto } from '../dto/approve-private-asset-request.dto';
import { RejectPrivateAssetRequestDto } from '../dto/reject-private-asset-request.dto';
import { PrivateAssetRequestStatus } from '../../../database/schemas/private-asset-request.schema';
import { PositionStatus } from '../../../database/schemas/solvency-position.schema';
import { ethers } from 'ethers';

@Controller('admin/solvency')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class SolvencyAdminController {
  private readonly logger = new Logger(SolvencyAdminController.name);

  constructor(
    private blockchainService: SolvencyBlockchainService,
    private positionService: SolvencyPositionService,
    private privateAssetService: PrivateAssetService,
    private leverageBlockchainService: LeverageBlockchainService,
    private leveragePositionService: LeveragePositionService,
    private methPriceService: MethPriceService,
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
  async liquidatePosition(
    @Param('id') id: string,
    @Body('testPrice') testPrice?: string,
  ) {
    const positionId = parseInt(id);

    // If testPrice is provided, assume it is for LEVERAGE position testing
    if (testPrice) {
      this.logger.warn(`⚠️ Triggering LEVERAGE liquidation for position ${positionId} with test price: ${testPrice}`);
      
      const mETHPrice = ethers.parseEther(testPrice);
      
      // Get position details before liquidation
      const position = await this.leveragePositionService.getPosition(positionId);
      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      this.logger.log(`📊 Position ${positionId} before liquidation:`);
      this.logger.log(`   mETH Collateral: ${position.mETHCollateral}`);
      this.logger.log(`   USDC Borrowed: ${position.usdcBorrowed}`);
      this.logger.log(`   Health Factor: ${(position.currentHealthFactor / 100).toFixed(2)}%`);
      this.logger.log(`   Status: ${position.status}`);
      
      const txHash = await this.leverageBlockchainService.liquidatePosition(
        positionId,
        mETHPrice,
      );

      this.logger.log(`✅ On-chain liquidation completed: ${txHash}`);
      this.logger.log(`🔄 Updating database...`);

      // Mark position as liquidated in database
      await this.leveragePositionService.markLiquidated(positionId, {
        mETHSold: position.mETHCollateral,
        usdcRecovered: position.usdcBorrowed, // Approximate
        shortfall: '0', // Will be calculated from events
        txHash,
      });

      this.logger.log(`✅ Position ${positionId} marked as LIQUIDATED in database`);
      this.logger.log(`📊 Liquidation Summary:`);
      this.logger.log(`   Position ID: ${positionId}`);
      this.logger.log(`   mETH Sold: ${position.mETHCollateral}`);
      this.logger.log(`   Test Price Used: ${testPrice} USD`);
      this.logger.log(`   TX Hash: ${txHash}`);

      return {
        success: true,
        type: 'LEVERAGE_TEST',
        txHash,
        testPrice,
        positionId,
        mETHSold: position.mETHCollateral,
        message: 'Position liquidated and database updated',
      };
    }

    // Standard SolvencyVault Liquidation
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

  /**
   * Get all private asset requests
   */
  @Get('private-asset/requests')
  async getAllPrivateAssetRequests(@Query('status') status?: string) {
    const parsedStatus = status as PrivateAssetRequestStatus | undefined;
    const requests = await this.privateAssetService.getAllRequests(parsedStatus);

    return {
      success: true,
      count: requests.length,
      requests,
    };
  }

  /**
   * Get pending private asset requests
   */
  @Get('private-asset/requests/pending')
  async getPendingPrivateAssetRequests() {
    const requests = await this.privateAssetService.getPendingRequests();

    return {
      success: true,
      count: requests.length,
      requests,
    };
  }

  /**
   * Get private asset request details
   */
  @Get('private-asset/request/:id')
  async getPrivateAssetRequestDetails(@Param('id') id: string) {
    const request = await this.privateAssetService.getRequest(id);

    return {
      success: true,
      request,
    };
  }

  /**
   * Approve private asset request
   * Mints token and deposits directly to SolvencyVault
   */
  @Post('private-asset/approve/:id')
  @HttpCode(HttpStatus.OK)
  async approvePrivateAssetRequest(
    @Param('id') id: string,
    @Body() dto: ApprovePrivateAssetRequestDto,
  ) {
    // TODO: Get admin wallet from request context
    const adminAddress = '0xAdminAddress'; // Replace with actual admin address from JWT

    const result = await this.privateAssetService.approveRequest(
      id,
      adminAddress,
      dto.finalValuation,
      dto.notes,
    );

    return {
      success: true,
      message: 'Private asset request approved and token minted',
      requestId: id,
      tokenAddress: result.asset.tokenAddress,
      tokenSymbol: result.asset.symbol,
      assetId: result.asset.assetId,
      mintTxHash: result.mintTxHash,
      finalValuation: dto.finalValuation,
    };
  }

  /**
   * Reject private asset request
   */
  @Post('private-asset/reject/:id')
  @HttpCode(HttpStatus.OK)
  async rejectPrivateAssetRequest(
    @Param('id') id: string,
    @Body() dto: RejectPrivateAssetRequestDto,
  ) {
    // TODO: Get admin wallet from request context
    const adminAddress = '0xAdminAddress'; // Replace with actual admin address from JWT

    const request = await this.privateAssetService.rejectRequest(
      id,
      adminAddress,
      dto.rejectionReason,
    );

    return {
      success: true,
      message: 'Private asset request rejected',
      requestId: id,
      rejectionReason: dto.rejectionReason,
      reviewedAt: request.reviewedAt,
    };
  }

  /**
   * Purchase and settle liquidated Private Asset position
   * Admin buys the collateral tokens by sending USDC
   */
  @Post('position/:id/purchase-liquidation')
  @HttpCode(HttpStatus.OK)
  async purchaseAndSettleLiquidation(
    @Param('id') id: string,
    @Body() body: { purchaseAmount: string },
  ) {
    const positionId = parseInt(id);
    
    this.logger.log(`Admin purchasing liquidated position ${positionId}`);
    this.logger.log(`Purchase amount: ${body.purchaseAmount} USDC (6 decimals)`);

    // Get position to verify it's liquidated and is Private Asset
    const position = await this.positionService.getPosition(positionId);
    
    if (!position) {
      return {
        success: false,
        message: 'Position not found',
      };
    }

    if (position.status !== PositionStatus.LIQUIDATED) {
      return {
        success: false,
        message: 'Position is not liquidated',
        currentStatus: position.status,
      };
    }

    if (position.collateralTokenType !== 'PRIVATE_ASSET') {
      return {
        success: false,
        message: 'Position collateral is not a Private Asset',
        tokenType: position.collateralTokenType,
      };
    }

    // Execute purchase and settlement on-chain
    const result = await this.blockchainService.purchaseAndSettleLiquidation(
      positionId,
      body.purchaseAmount,
    );

    // Update position in database
    position.status = PositionStatus.SETTLED;
    position.settledAt = new Date();
    await position.save();

    return {
      success: true,
      message: 'Private asset liquidation purchased and settled',
      positionId,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      purchaseAmount: body.purchaseAmount,
      liquidationFee: result.liquidationFee,
      userRefund: result.userRefund,
    };
  }
}
