import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { LeveragePositionService } from './leverage-position.service';
import { LeverageBlockchainService } from './leverage-blockchain.service';
import { FluxionDEXService } from './fluxion-dex.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

/**
 * @title HarvestKeeperService
 * @notice Automated service for harvesting mETH yield and paying interest
 * @dev Runs as cron job - every 4 minutes in demo mode, 24 hours in production
 *
 * Flow:
 * 1. Get all active positions
 * 2. For each position:
 *    - Check if interest is due
 *    - Check DEX liquidity
 *    - Execute harvest on-chain
 *    - Record harvest in database
 *    - Send notification to user
 */
@Injectable()
export class HarvestKeeperService {
  private readonly logger = new Logger(HarvestKeeperService.name);
  private isDemoMode: boolean;

  constructor(
    private configService: ConfigService,
    private positionService: LeveragePositionService,
    private blockchainService: LeverageBlockchainService,
    private dexService: FluxionDEXService,
    private notificationService: NotificationService,
  ) {
    // Check if demo mode is enabled
    this.isDemoMode = this.configService.get<string>('DEMO_MODE') === 'true';
    this.logger.log(
      `🌾 Harvest Keeper initialized (${this.isDemoMode ? 'DEMO MODE: 4 min' : 'Production: 24hr'})`,
    );
  }

  /**
   * Harvest cron job - every 4 minutes in demo mode
   * In production, this would run every 24 hours
   */
  @Cron('*/4 * * * *', {
    name: 'harvest-yield-demo',
  })
  async harvestYieldDemo() {
    if (!this.isDemoMode) return;
    await this.executeHarvest();
  }

  /**
   * Harvest cron job - every 24 hours in production
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, {
    name: 'harvest-yield-production',
  })
  async harvestYieldProduction() {
    if (this.isDemoMode) return;
    await this.executeHarvest();
  }

  /**
   * Execute harvest for all active positions
   */
  private async executeHarvest() {
    this.logger.log('🌾 Starting harvest cycle...');

    try {
      const activePositions = await this.positionService.getActivePositions();
      this.logger.log(`Found ${activePositions.length} active positions`);

      for (const position of activePositions) {
        try {
          await this.harvestPosition(position.positionId);
        } catch (error) {
          this.logger.error(
            `Failed to harvest position ${position.positionId}: ${error}`,
          );
          // Continue with next position even if one fails
        }
      }

      this.logger.log('✅ Harvest cycle completed');
    } catch (error) {
      this.logger.error(`Harvest cycle failed: ${error}`);
    }
  }

  /**
   * Harvest individual position
   */
  private async harvestPosition(positionId: number) {
    this.logger.log(`🌾 Processing position ${positionId}...`);

    // Get outstanding interest
    const outstandingInterest =
      await this.blockchainService.getAccruedInterest(positionId);

    if (outstandingInterest === BigInt(0)) {
      this.logger.log(`Position ${positionId}: No interest to pay, skipping`);
      return;
    }

    this.logger.log(
      `Position ${positionId}: ${Number(outstandingInterest) / 1e6} USDC interest due`,
    );

    // Calculate mETH needed for interest
    const mETHNeeded = await this.dexService.calculateMETHForUSDC(
      outstandingInterest,
    );

    // Add 5% buffer for slippage
    const mETHWithBuffer = (mETHNeeded * BigInt(105)) / BigInt(100);

    // Check DEX liquidity
    const hasLiquidity = await this.dexService.checkLiquidity(mETHWithBuffer);
    if (!hasLiquidity) {
      this.logger.warn(
        `Position ${positionId}: Insufficient DEX liquidity, skipping`,
      );
      return;
    }

    // Get health factor before harvest
    const healthFactorBefore =
      await this.blockchainService.getHealthFactor(positionId);

    // Execute harvest on-chain
    try {
      const txHash = await this.blockchainService.harvestYield(positionId);

      // Get harvest details from contract (or parse event)
      const position = await this.blockchainService.getPosition(positionId);

      // Get health factor after harvest
      const healthFactorAfter =
        await this.blockchainService.getHealthFactor(positionId);

      // Record harvest in database
      await this.positionService.recordHarvest(positionId, {
        mETHSwapped: mETHWithBuffer.toString(),
        usdcReceived: outstandingInterest.toString(),
        interestPaid: outstandingInterest.toString(),
        transactionHash: txHash,
        healthFactorBefore,
        healthFactorAfter,
      });

      // Update position health
      await this.positionService.updateHealth(positionId, healthFactorAfter);

      // Send notification to user
      const dbPosition = await this.positionService.getPosition(positionId);
      if (dbPosition) {
        await this.notificationService.create({
          userId: dbPosition.userAddress,
          walletAddress: dbPosition.userAddress,
          header: 'Yield Harvested',
          detail: `${(Number(outstandingInterest) / 1e6).toFixed(2)} USDC interest paid from your mETH yield. Health factor: ${(healthFactorAfter / 100).toFixed(1)}%`,
          type: NotificationType.YIELD_DISTRIBUTED,
          severity: NotificationSeverity.INFO,
          action: NotificationAction.VIEW_PORTFOLIO,
          actionMetadata: {
            positionId,
            mETHSwapped: mETHWithBuffer.toString(),
            usdcReceived: outstandingInterest.toString(),
            healthFactorBefore,
            healthFactorAfter,
            txHash,
          },
        });
      }

      this.logger.log(
        `✅ Position ${positionId} harvested: ${Number(outstandingInterest) / 1e6} USDC paid`,
      );
    } catch (error) {
      this.logger.error(`Failed to execute harvest for position ${positionId}: ${error}`);
      throw error;
    }
  }

  /**
   * Manual harvest trigger (for testing/admin)
   */
  async manualHarvest(positionId: number): Promise<void> {
    this.logger.log(`🔧 Manual harvest triggered for position ${positionId}`);
    await this.harvestPosition(positionId);
  }

  /**
   * Manual harvest all (for testing/admin)
   */
  async manualHarvestAll(): Promise<void> {
    this.logger.log('🔧 Manual harvest all triggered');
    await this.executeHarvest();
  }
}
