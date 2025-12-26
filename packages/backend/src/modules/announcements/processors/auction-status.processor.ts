import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { AnnouncementService } from '../services/announcement.service';

interface ActivateAuctionJob {
  assetId: string;
  scheduledStartTime: Date;
}

interface CheckAuctionStatusJob {
  assetId: string;
  expectedStartTime: Date;
}

@Processor('auction-status-check')
export class AuctionStatusProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionStatusProcessor.name);

  constructor(
    @InjectModel(Asset.name)
    private assetModel: Model<AssetDocument>,
    @InjectQueue('auction-status-check')
    private auctionStatusQueue: Queue,
    private announcementService: AnnouncementService,
  ) {
    super();
  }

  async process(job: Job<ActivateAuctionJob | CheckAuctionStatusJob>): Promise<void> {
    if (job.name === 'activate-auction') {
      await this.activateAuction(job as Job<ActivateAuctionJob>);
    } else if (job.name === 'check-auction-status') {
      await this.checkAuctionStatus(job as Job<CheckAuctionStatusJob>);
    } else {
      this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  private async activateAuction(job: Job<ActivateAuctionJob>): Promise<void> {
    const { assetId, scheduledStartTime } = job.data;

    this.logger.log(
      `Activating auction for asset ${assetId} (scheduled: ${scheduledStartTime})`,
    );

    try {
      const asset = await this.assetModel.findOne({ assetId });

      if (!asset) {
        this.logger.error(`Asset ${assetId} not found`);
        return;
      }

      if (asset.assetType !== 'AUCTION') {
        this.logger.error(`Asset ${assetId} is not an auction type`);
        return;
      }

      // Activate the auction
      const actualStartTime = new Date();
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'listing.active': true,
            'listing.listedAt': actualStartTime,
          },
        },
      );

      this.logger.log(`Auction ${assetId} activated at ${actualStartTime.toISOString()}`);

      // Queue status check job to run 1 minute later
      await this.auctionStatusQueue.add(
        'check-auction-status',
        {
          assetId,
          expectedStartTime: actualStartTime,
        },
        {
          delay: 60 * 1000, // 1 minute
        },
      );

      this.logger.log(
        `Queued auction status check for ${assetId} to run in 1 minute`,
      );
    } catch (error) {
      this.logger.error(
        `Error activating auction for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  private async checkAuctionStatus(job: Job<CheckAuctionStatusJob>): Promise<void> {
    const { assetId, expectedStartTime } = job.data;

    this.logger.log(
      `Checking auction status for asset ${assetId} (expected start: ${expectedStartTime})`,
    );

    try {
      const asset = await this.assetModel.findOne({ assetId });

      if (!asset) {
        this.logger.error(`Asset ${assetId} not found`);
        return;
      }

      // Check if auction is actually live
      if (asset.listing && asset.listing.active === true && asset.listing.type === 'AUCTION') {
        // Auction is live - create AUCTION_LIVE announcement
        this.logger.log(`Auction ${assetId} is LIVE. Creating announcement.`);
        await this.announcementService.createAuctionLiveAnnouncement(assetId);
      } else {
        // Auction failed to start - create AUCTION_FAILED announcement
        let reason = 'Unknown error';

        if (!asset.listing) {
          reason = 'Auction listing not found';
        } else if (asset.listing.active === false) {
          reason = 'Auction failed to activate on-chain';
        } else if (asset.listing.type !== 'AUCTION') {
          reason = 'Asset is not configured as auction type';
        }

        this.logger.warn(`Auction ${assetId} FAILED to start. Reason: ${reason}`);
        await this.announcementService.createAuctionFailedAnnouncement(assetId, reason);
      }
    } catch (error) {
      this.logger.error(
        `Error checking auction status for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
