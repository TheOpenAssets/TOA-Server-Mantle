import { Controller, Post, Get, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiHeader, ApiBody } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { UserYieldClaimService } from '../services/user-yield-claim.service';
import { NotifyYieldClaimDto } from '../dto/notify-yield-claim.dto';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationSeverity, NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Logger } from '@nestjs/common';
import { NetworkRegistryService } from '../../blockchain/services/network-registry.service';

@ApiTags('Yield')
@Controller('yield')
export class YieldController {
  private readonly logger = new Logger(YieldController.name);

  constructor(
    private userYieldClaimService: UserYieldClaimService,
    private notificationService: NotificationService,
    private networkRegistryService: NetworkRegistryService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {}

  /**
   * Notify backend when investor claims yield (burns tokens for USDC)
   * Called by frontend after successful claimYield() transaction
   */
  @ApiOperation({ summary: 'Notify yield claim', description: 'Records a yield claim transaction after it has been executed on-chain.' })
  @ApiHeader({ name: 'X-Network', description: 'Network context', enum: ['mantle', 'stellar', 'arbitrum', 'creditcoin'] })
  @ApiBody({ type: NotifyYieldClaimDto })
  @ApiResponse({ status: 201, description: 'Claim recorded' })
  @Post('claims/notify')
  @UseGuards(JwtAuthGuard)
  async notifyYieldClaim(@Request() req: any, @Body() dto: NotifyYieldClaimDto) {
    const investorWallet = req.user.walletAddress.toLowerCase();

    this.logger.log(
      `📥 Yield claim notification received from ${investorWallet} for asset ${dto.assetId}`,
    );

    try {
      // Get asset info
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      if (!asset) {
        return {
          success: false,
          error: 'Asset not found',
        };
      }

      // Record the claim
      const claim = await this.userYieldClaimService.recordClaim({
        userAddress: investorWallet,
        tokenAddress: dto.tokenAddress.toLowerCase(),
        assetId: dto.assetId,
        tokensBurned: dto.tokensBurned,
        usdcReceived: dto.usdcReceived,
        transactionHash: dto.txHash,
        blockNumber: dto.blockNumber ? parseInt(dto.blockNumber) : 0,
        claimTimestamp: new Date(),
      });

      // Send notification to user
      try {
        const tokensBurnedFormatted = (parseFloat(dto.tokensBurned) / 1e18).toFixed(2);
        const usdcReceivedFormatted = (parseFloat(dto.usdcReceived) / 1e6).toFixed(2);

        await this.notificationService.create({
          userId: investorWallet,
          walletAddress: investorWallet,
          header: 'Yield Claimed Successfully!',
          detail: `You've successfully claimed ${usdcReceivedFormatted} USDC by burning ${tokensBurnedFormatted} tokens for asset ${asset.metadata?.invoiceNumber || dto.assetId}`,
          type: NotificationType.YIELD_DISTRIBUTED,
          severity: NotificationSeverity.SUCCESS,
          action: NotificationAction.VIEW_PORTFOLIO,
          actionMetadata: {
            assetId: dto.assetId,
            tokenAddress: dto.tokenAddress,
            tokensBurned: dto.tokensBurned,
            usdcReceived: dto.usdcReceived,
            txHash: dto.txHash,
          },
        });

        await this.userYieldClaimService.markNotificationSent((claim as any)._id.toString());

        this.logger.log(
          `✅ Yield claim recorded and notification sent to ${investorWallet}`,
        );
      } catch (notifError) {
        this.logger.error(`Failed to send notification: ${notifError}`);
        // Don't fail the whole operation if notification fails
      }

      return {
        success: true,
        message: 'Yield claim recorded successfully',
        claim: {
          id: (claim as any)._id,
          tokensBurned: dto.tokensBurned,
          usdcReceived: dto.usdcReceived,
          transactionHash: dto.txHash,
        },
      };
    } catch (error) {
      this.logger.error(`Failed to process yield claim notification: ${error}`);
      return {
        success: false,
        error: error,
      };
    }
  }

  /**
   * Get user's yield claim history
   */
  @ApiOperation({ summary: 'Get my claims', description: 'Returns all yield claims for the authenticated investor.' })
  @ApiHeader({ name: 'X-Network', description: 'Network context', enum: ['mantle', 'stellar', 'arbitrum', 'creditcoin'] })
  @ApiResponse({ status: 200, description: 'Claims history' })
  @Get('claims/my-claims')
  @UseGuards(JwtAuthGuard)
  async getMyClaims(@Request() req: any) {
    const investorWallet = req.user.walletAddress.toLowerCase();

    try {
      const claims = await this.userYieldClaimService.getUserClaims(investorWallet);

      return {
        success: true,
        count: claims.length,
        claims: claims.map(claim => ({
          id: (claim as any)._id,
          assetId: claim.assetId,
          tokenAddress: claim.tokenAddress,
          tokensBurned: claim.tokensBurned,
          tokensBurnedFormatted: (parseFloat(claim.tokensBurned) / 1e18).toFixed(2),
          usdcReceived: claim.usdcReceived,
          usdcReceivedFormatted: (parseFloat(claim.usdcReceived) / 1e6).toFixed(2),
          transactionHash: claim.transactionHash,
          claimTimestamp: claim.claimTimestamp,
          status: claim.status,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get user claims: ${error}`);
      return {
        success: false,
        error: error,
      };
    }
  }

  /**
   * Get yield claims for a specific asset (for admin/originator)
   */
  @ApiOperation({ summary: 'Get asset claims', description: 'Returns all yield claims for a specific asset.' })
  @ApiHeader({ name: 'X-Network', description: 'Network context', enum: ['mantle', 'stellar', 'arbitrum', 'creditcoin'] })
  @ApiResponse({ status: 200, description: 'Asset claims history' })
  @Get('claims/asset/:assetId')
  @UseGuards(JwtAuthGuard)
  async getAssetClaims(@Param('assetId') assetId: string) {
    try {
      const claims = await this.userYieldClaimService.getAssetClaims(assetId);
      const totals = await this.userYieldClaimService.getTotalClaimedForAsset(assetId);

      return {
        success: true,
        count: claims.length,
        totals: {
          totalUSDC: totals.totalUSDC.toString(),
          totalUSDCFormatted: (Number(totals.totalUSDC) / 1e6).toFixed(2),
          totalTokensBurned: totals.totalTokensBurned.toString(),
          totalTokensBurnedFormatted: (Number(totals.totalTokensBurned) / 1e18).toFixed(2),
          claimCount: totals.claimCount,
        },
        claims: claims.map(claim => ({
          userAddress: claim.userAddress,
          tokensBurned: claim.tokensBurned,
          tokensBurnedFormatted: (parseFloat(claim.tokensBurned) / 1e18).toFixed(2),
          usdcReceived: claim.usdcReceived,
          usdcReceivedFormatted: (parseFloat(claim.usdcReceived) / 1e6).toFixed(2),
          transactionHash: claim.transactionHash,
          claimTimestamp: claim.claimTimestamp,
          status: claim.status,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get asset claims: ${error}`);
      return {
        success: false,
        error: error,
      };
    }
  }

  /**
   * Get recent yield claims (admin view)
   */
  @ApiOperation({ summary: 'Get recent claims', description: 'Returns recently recorded yield claims across all assets.' })
  @ApiHeader({ name: 'X-Network', description: 'Network context', enum: ['mantle', 'stellar', 'arbitrum', 'creditcoin'] })
  @ApiResponse({ status: 200, description: 'Recent claims' })
  @Get('claims/recent')
  @UseGuards(JwtAuthGuard)
  async getRecentClaims(@Query('limit') limit?: string) {
    try {
      const limitNum = limit ? parseInt(limit) : 50;
      const claims = await this.userYieldClaimService.getRecentClaims(limitNum);

      return {
        success: true,
        count: claims.length,
        claims: claims.map(claim => ({
          userAddress: claim.userAddress,
          assetId: claim.assetId,
          tokenAddress: claim.tokenAddress,
          tokensBurnedFormatted: (parseFloat(claim.tokensBurned) / 1e18).toFixed(2),
          usdcReceivedFormatted: (parseFloat(claim.usdcReceived) / 1e6).toFixed(2),
          transactionHash: claim.transactionHash,
          claimTimestamp: claim.claimTimestamp,
          status: claim.status,
        })),
      };
    } catch (error) {
      this.logger.error(`Failed to get recent claims: ${error}`);
      return {
        success: false,
        error: error,
      };
    }
  }

  /**
   * Get exact on-chain claimable yield amount
   */
  @ApiOperation({ summary: 'Get claimable yield', description: 'Queries the on-chain YieldVault for exact claimable USDC amount.' })
  @ApiHeader({ name: 'X-Network', description: 'Network context', enum: ['mantle', 'stellar', 'arbitrum', 'creditcoin'] })
  @ApiResponse({ status: 200, description: 'Claimable amount' })
  @Get('claimable')
  @UseGuards(JwtAuthGuard)
  async getClaimableYield(
    @Request() req: any,
    @Query('tokenAddress') tokenAddress?: string,
  ) {
    const investorWallet = req.user.walletAddress;
    
    try {
      const claimable = await this.networkRegistryService.getInvestorClaimableYield(
        investorWallet,
        tokenAddress,
      );

      return {
        success: true,
        investorWallet,
        tokenAddress: tokenAddress || 'ALL',
        claimableUSDC: claimable,
        claimableFormatted: `${claimable} USDC`,
      };
    } catch (error: any) {
      this.logger.error(`Failed to get claimable yield: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
