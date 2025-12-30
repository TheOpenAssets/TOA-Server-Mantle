import { Controller, Post, Get, UseGuards, Request, Body, Param, Query } from '@nestjs/common';
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

@Controller('yield')
export class YieldController {
  private readonly logger = new Logger(YieldController.name);

  constructor(
    private userYieldClaimService: UserYieldClaimService,
    private notificationService: NotificationService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {}

  /**
   * Notify backend when investor claims yield (burns tokens for USDC)
   * Called by frontend after successful claimYield() transaction
   */
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

        await this.userYieldClaimService.markNotificationSent(claim._id.toString());

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
          id: claim._id,
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
          id: claim._id,
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
}
