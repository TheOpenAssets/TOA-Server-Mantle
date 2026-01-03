import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { LeveragePositionService } from './leverage-position.service';
import { LeverageBlockchainService } from './leverage-blockchain.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { PositionHealth } from '../../../database/schemas/leverage-position.schema';

/**
 * @title HealthMonitorService
 * @notice Automated service for monitoring position health and triggering liquidations
 * @dev Runs at configurable intervals (HEALTH_CHECK_INTERVAL_SECONDS)
 *
 * Health Thresholds:
 * - < 110%: Liquidatable → Execute liquidation
 * - 110-125%: Critical → Alert every 4 hours
 * - 125-140%: Warning → Alert once
 * - >= 140%: Healthy
 */
@Injectable()
export class HealthMonitorService implements OnModuleInit {
  private readonly logger = new Logger(HealthMonitorService.name);
  private readonly healthCheckIntervalMs: number;

  constructor(
    private configService: ConfigService,
    private positionService: LeveragePositionService,
    private blockchainService: LeverageBlockchainService,
    private notificationService: NotificationService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    // Get health check interval from config (default: 60 seconds = 1 minute)
    const intervalSeconds = this.configService.get<number>('HEALTH_CHECK_INTERVAL_SECONDS', 60);
    this.healthCheckIntervalMs = intervalSeconds * 1000;

    this.logger.log(
      `💊 Health Monitor initialized (Interval: ${intervalSeconds}s = ${intervalSeconds / 60} minutes)`,
    );
  }

  /**
   * Set up dynamic interval on module initialization
   */
  onModuleInit() {
    const callback = () => {
      this.executeHealthCheck().catch((error) => {
        this.logger.error(`Health check cycle failed: ${error.message}`, error.stack);
      });
    };

    const interval = setInterval(callback, this.healthCheckIntervalMs);
    this.schedulerRegistry.addInterval('health-check', interval);

    this.logger.log(`⏰ Health check interval scheduled: every ${this.healthCheckIntervalMs / 1000}s`);
  }

  /**
   * Execute health check for all active positions
   */
  private async executeHealthCheck() {
    this.logger.log('💊 Starting health check cycle...');

    try {
      const activePositions = await this.positionService.getActivePositions();
      this.logger.log(`Checking ${activePositions.length} active positions`);

      for (const position of activePositions) {
        try {
          await this.checkPositionHealth(position.positionId);
        } catch (error) {
          this.logger.error(
            `Failed to check health for position ${position.positionId}: ${error}`,
          );
        }
      }

      this.logger.log('✅ Health check cycle completed');
    } catch (error) {
      this.logger.error(`Health check cycle failed: ${error}`);
    }
  }

  /**
   * Check individual position health
   */
  private async checkPositionHealth(positionId: number) {
    // Get current health factor from contract
    const healthFactor = await this.blockchainService.getHealthFactor(positionId);

    // Update position health in database
    await this.positionService.updateHealth(positionId, healthFactor);

    const position = await this.positionService.getPosition(positionId);
    if (!position) return;

    this.logger.debug(
      `Position ${positionId}: ${(healthFactor / 100).toFixed(1)}% (${position.healthStatus})`,
    );

    // Handle based on health status
    if (healthFactor < 11000) {
      // < 110%: Liquidatable
      await this.handleLiquidation(positionId);
    } else if (healthFactor < 12500) {
      // 110-125%: Critical
      await this.handleCriticalHealth(positionId, healthFactor);
    } else if (healthFactor < 14000) {
      // 125-140%: Warning
      await this.handleWarningHealth(positionId, healthFactor);
    } else {
      // >= 140%: Healthy - reset notification flags
      if (position.warningNotificationSent || position.criticalNotificationSent) {
        await this.positionService.resetNotificationFlags(positionId);
      }
    }
  }

  /**
   * Handle liquidation (health < 110%)
   */
  private async handleLiquidation(positionId: number) {
    this.logger.warn(`⚠️ Position ${positionId} is liquidatable, executing liquidation...`);

    const position = await this.positionService.getPosition(positionId);
    if (!position) return;

    try {
      // Execute liquidation on-chain
      const txHash = await this.blockchainService.liquidatePosition(positionId);

      // Get liquidation details (would normally parse from event)
      const outstandingDebt =
        await this.blockchainService.getOutstandingDebt(positionId);

      // Mark position as liquidated in database
      await this.positionService.markLiquidated(positionId, {
        mETHSold: position.mETHCollateral,
        usdcRecovered: outstandingDebt.toString(), // Approximation
        shortfall: '0', // Calculate actual shortfall
        txHash,
      });

      // Send liquidation notification
      await this.notificationService.create({
        userId: position.userAddress,
        walletAddress: position.userAddress,
        header: 'Position Liquidated',
        detail: `Your leveraged position has been liquidated due to low health factor. All collateral was sold to repay the loan.`,
        type: NotificationType.SYSTEM_ALERT,
        severity: NotificationSeverity.ERROR,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          positionId,
          txHash,
          mETHSold: position.mETHCollateral,
        },
      });

      this.logger.warn(`⚠️ Position ${positionId} liquidated: ${txHash}`);
    } catch (error) {
      this.logger.error(`Failed to liquidate position ${positionId}: ${error}`);
    }
  }

  /**
   * Handle critical health (110-125%)
   */
  private async handleCriticalHealth(positionId: number, healthFactor: number) {
    const position = await this.positionService.getPosition(positionId);
    if (!position) return;

    // Send notification every 4 hours
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const shouldNotify =
      !position.lastNotificationTime ||
      position.lastNotificationTime < fourHoursAgo;

    if (shouldNotify) {
      await this.notificationService.create({
        userId: position.userAddress,
        walletAddress: position.userAddress,
        header: '🚨 Critical: Position Near Liquidation',
        detail: `Your leveraged position health is ${(healthFactor / 100).toFixed(1)}%. Add collateral now to avoid liquidation at 110%.`,
        type: NotificationType.SYSTEM_ALERT,
        severity: NotificationSeverity.WARNING,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          positionId,
          healthFactor,
          liquidationThreshold: 11000,
        },
      });

      await this.positionService.updateNotificationTracking(positionId, 'critical');
      this.logger.warn(`📧 Critical health alert sent for position ${positionId}`);
    }
  }

  /**
   * Handle warning health (125-140%)
   */
  private async handleWarningHealth(positionId: number, healthFactor: number) {
    const position = await this.positionService.getPosition(positionId);
    if (!position || position.warningNotificationSent) return;

    // Send warning notification (one-time)
    await this.notificationService.create({
      userId: position.userAddress,
      walletAddress: position.userAddress,
      header: '⚠️ Position Health Warning',
      detail: `Your leveraged position health is ${(healthFactor / 100).toFixed(1)}%. Consider adding collateral to maintain a healthy position.`,
      type: NotificationType.SYSTEM_ALERT,
      severity: NotificationSeverity.WARNING,
      action: NotificationAction.VIEW_PORTFOLIO,
      actionMetadata: {
        positionId,
        healthFactor,
        recommendedThreshold: 14000,
      },
    });

    await this.positionService.updateNotificationTracking(positionId, 'warning');
    this.logger.log(`📧 Warning health alert sent for position ${positionId}`);
  }

  /**
   * Manual health check trigger (for testing/admin)
   */
  async manualCheck(positionId: number): Promise<void> {
    this.logger.log(`🔧 Manual health check triggered for position ${positionId}`);
    await this.checkPositionHealth(positionId);
  }

  /**
   * Manual check all (for testing/admin)
   */
  async manualCheckAll(): Promise<void> {
    this.logger.log('🔧 Manual health check all triggered');
    await this.executeHealthCheck();
  }
}
