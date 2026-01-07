import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SolvencyPositionService } from './solvency-position.service';
import { SolvencyBlockchainService } from './solvency-blockchain.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { PositionStatus } from '../../../database/schemas/solvency-position.schema';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

@Injectable()
export class RepaymentMonitorService {
  private readonly logger = new Logger(RepaymentMonitorService.name);

  constructor(
    private positionService: SolvencyPositionService,
    private blockchainService: SolvencyBlockchainService,
    private notificationService: NotificationService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE) // Check every minute for testing, can be hourly in prod
  async checkRepayments() {
    this.logger.log('Checking for overdue repayments...');

    const activePositions = await this.positionService.getAllPositions(PositionStatus.ACTIVE);
    const now = new Date();

    for (const position of activePositions) {
      // Skip if no repayment plan
      if (!position.nextPaymentDueDate || !position.installmentInterval) continue;

      // Check if overdue
      if (position.nextPaymentDueDate < now) {
        await this.handleOverduePosition(position);
      }
    }
  }

  private async handleOverduePosition(position: any) {
    this.logger.warn(`Position ${position.positionId} is overdue!`);

    // Calculate how many intervals have passed since due date
    const overdueMs = Date.now() - position.nextPaymentDueDate.getTime();
    const intervalMs = position.installmentInterval * 1000;
    
    // At least 1 missed payment if we are here
    // If multiple intervals passed, we might mark multiple misses, but let's do one at a time per cron run for safety
    // Or just increment by 1 and advance the date by 1 interval.
    
    // Increment missed payments
    position.missedPayments = (position.missedPayments || 0) + 1;
    
    // Update schedule array status
    if (position.repaymentSchedule && position.repaymentSchedule.length > 0) {
      const currentDue = position.repaymentSchedule.find((i: any) => i.status === 'PENDING');
      if (currentDue) {
        currentDue.status = 'MISSED';
      }
    }

    // Advance next due date
    position.nextPaymentDueDate = new Date(position.nextPaymentDueDate.getTime() + intervalMs);

    // Update Blockchain
    try {
      await this.blockchainService.markMissedPayment(position.positionId);
    } catch (error) {
      this.logger.error(`Failed to mark missed payment on-chain for ${position.positionId}: ${error}`);
      // Continue to update DB anyway so we don't get stuck loop, or maybe retry next time?
      // If we don't update DB date, we will loop forever. Better to update DB and retry chain later if critical.
      // But here we assume chain tx will eventually succeed or manual intervention.
    }

    // Check for Default
    if (position.missedPayments >= 3 && !position.isDefaulted) {
      this.logger.error(`Position ${position.positionId} has defaulted (3+ missed payments)`);
      position.isDefaulted = true;
      
      try {
        await this.blockchainService.markDefaulted(position.positionId);
      } catch (error) {
        this.logger.error(`Failed to mark default on-chain for ${position.positionId}: ${error}`);
      }

      // Notify User: DEFAULT
      await this.notificationService.create({
        userId: position.userAddress,
        walletAddress: position.userAddress,
        header: 'Loan Defaulted - Liquidation Risk',
        detail: `Position #${position.positionId} has missed 3 repayments and is now marked as DEFAULTED. Liquidation is imminent.`,
        type: NotificationType.SYSTEM_ALERT,
        severity: NotificationSeverity.ERROR,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: { positionId: position.positionId }
      });

    } else {
      // Notify User: MISSED PAYMENT
      await this.notificationService.create({
        userId: position.userAddress,
        walletAddress: position.userAddress,
        header: 'Missed Repayment',
        detail: `You missed a scheduled repayment for Position #${position.positionId}. Missed count: ${position.missedPayments}/3. Please repay immediately to avoid default.`,
        type: NotificationType.SYSTEM_ALERT,
        severity: NotificationSeverity.WARNING,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: { positionId: position.positionId }
      });
    }

    await position.save();
  }
}
