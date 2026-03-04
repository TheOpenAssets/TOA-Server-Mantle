import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { UscEvent, UscEventDocument } from '@/src/database/schemas/usc-event.schema';
import { NotificationService } from '@/src/modules/notifications/services/notification.service';
import { CreditcoinSubstrateService } from '@/src/modules/blockchain/services/creditcoin-substrate.service';
import {
  NotificationType,
  NotificationSeverity,
  NotificationAction,
} from '@openassets/types';

@Processor('usc-events')
export class UscEventProcessor extends WorkerHost {
  private readonly logger = new Logger(UscEventProcessor.name);

  constructor(
    @InjectModel(UscEvent.name) private readonly uscEventModel: Model<UscEventDocument>,
    private readonly notificationService: NotificationService,
    private readonly substrateService: CreditcoinSubstrateService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    this.logger.log(`Processing USC job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case 'usc-event-verified':
        return this.processUscEventVerified(job.data);
      default:
        this.logger.warn(`Unknown USC job: ${job.name}`);
    }
  }

  private async processUscEventVerified(data: any) {
    const { walletAddress, sourceChain, eventType, scoreDelta, txHash, blockNumber } = data;

    this.logger.log(`Processing verified USC event for wallet ${walletAddress} from ${sourceChain}`);

    // Save the USC event record
    const uscEvent = new this.uscEventModel({
      uuid: uuidv4(),
      walletAddress: walletAddress.toLowerCase(),
      sourceChain,
      eventType,
      scoreDelta,
      txHash,
      blockNumber,
      verifiedAt: new Date(),
    });
    await uscEvent.save();

    // Clear credit score cache so next fetch is fresh
    try {
      await this.substrateService.clearCache(walletAddress);
      this.logger.log(`Cleared credit score cache for wallet ${walletAddress}`);
    } catch (error: any) {
      this.logger.error(`Failed to clear credit score cache for ${walletAddress}: ${error.message}`);
    }

    // Send notification to user
    try {
      await this.notificationService.create({
        userId: walletAddress,
        walletAddress,
        header: 'Cross-Chain Activity Verified',
        detail: `Your ${sourceChain} ${eventType.toLowerCase()} event has been verified on Creditcoin. Your credit score has been updated.`,
        type: NotificationType.SYSTEM_ALERT,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: { walletAddress, txHash },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send USC notification to ${walletAddress}: ${error.message}`);
    }

    return { walletAddress, txHash };
  }
}
