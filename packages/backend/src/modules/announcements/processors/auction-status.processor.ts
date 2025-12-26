import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { AnnouncementService } from '../services/announcement.service';
import { BlockchainService } from '../../blockchain/services/blockchain.service';

interface ActivateAuctionJob {
  assetId: string;
  scheduledStartTime: Date;
}

interface CheckAuctionStatusJob {
  assetId: string;
  expectedStartTime: Date;
}

interface CheckAuctionEndJob {
  assetId: string;
  expectedEndTime: Date;
}

@Processor('auction-status-check')
export class AuctionStatusProcessor extends WorkerHost {
  private readonly logger = new Logger(AuctionStatusProcessor.name);

  constructor(
    @InjectModel(Asset.name)
    private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name)
    private bidModel: Model<BidDocument>,
    @InjectQueue('auction-status-check')
    private auctionStatusQueue: Queue,
    private announcementService: AnnouncementService,
    private blockchainService: BlockchainService,
  ) {
    super();
  }

  async process(job: Job<ActivateAuctionJob | CheckAuctionStatusJob | CheckAuctionEndJob>): Promise<void> {
    if (job.name === 'activate-auction') {
      await this.activateAuction(job as Job<ActivateAuctionJob>);
    } else if (job.name === 'check-auction-status') {
      await this.checkAuctionStatus(job as Job<CheckAuctionStatusJob>);
    } else if (job.name === 'check-auction-end') {
      await this.checkAuctionEnd(job as Job<CheckAuctionEndJob>);
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

      // Verify token is deployed
      if (!asset.token?.address) {
        this.logger.error(`Asset ${assetId} does not have a deployed token`);
        return;
      }

      // Extract auction parameters
      const tokenAddress = asset.token.address;
      const reservePrice = asset.listing?.reservePrice || '0';
      const duration = asset.listing?.duration || 3600; // Default 1 hour
      const minInvestment = asset.tokenParams?.minInvestment || '1000000000000000000'; // Default 1 token

      this.logger.log(
        `Creating on-chain auction listing for ${assetId}: token=${tokenAddress}, reserve=${reservePrice}, duration=${duration}s`,
      );

      // Create the auction listing on-chain
      const txHash = await this.blockchainService.listOnMarketplace(
        tokenAddress,
        'AUCTION',
        reservePrice,
        minInvestment,
        duration.toString(),
      );

      this.logger.log(`Auction listing created on-chain in tx: ${txHash}`);

      // Activate the auction in database
      const actualStartTime = new Date();
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'listing.active': true,
            'listing.listedAt': actualStartTime,
            'listing.transactionHash': txHash,
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

  private async checkAuctionEnd(job: Job<CheckAuctionEndJob>): Promise<void> {
    const { assetId, expectedEndTime } = job.data;

    this.logger.log(
      `Checking auction end for asset ${assetId} (expected end: ${expectedEndTime})`,
    );

    try {
      const asset = await this.assetModel.findOne({ assetId });

      if (!asset) {
        this.logger.error(`Asset ${assetId} not found`);
        return;
      }

      // Check if auction has ended
      const now = new Date();
      const auctionEndTime = asset.listing?.listedAt
        ? new Date(asset.listing.listedAt.getTime() + (asset.listing.duration || 0) * 1000)
        : null;

      if (!auctionEndTime) {
        this.logger.error(`Asset ${assetId} has no auction end time`);
        return;
      }

      if (now < auctionEndTime) {
        this.logger.warn(
          `Auction ${assetId} has not ended yet. Current time: ${now.toISOString()}, End time: ${auctionEndTime.toISOString()}`,
        );
        return;
      }

      this.logger.log(`Auction ${assetId} has ended. Checking if settled by admin...`);

      // Fetch all bids for this auction
      const bids = await this.bidModel.find({ assetId }).sort({ price: -1 }).exec();
      this.logger.log(`Found ${bids.length} bids for auction ${assetId}`);

      // ==============================================
      // MANUAL MODE: Get clearing price set by admin
      // ==============================================
      // Get clearing price from asset (should be set by admin via endAuction endpoint)
      // If not set, we'll use "0" to indicate auction ended without settlement yet
      const clearingPrice = asset.listing?.clearingPrice || '0';

      // Calculate tokens sold and remaining
      let tokensSold = '0';
      let tokensRemaining = asset.tokenParams.totalSupply;

      if (clearingPrice !== '0') {
        // If clearing price was set by admin, calculate sold tokens from listing.sold
        tokensSold = asset.listing?.sold || '0';
        const totalSupply = BigInt(asset.tokenParams.totalSupply);
        const sold = BigInt(tokensSold);
        tokensRemaining = (totalSupply - sold).toString();
      }

      // ==============================================
      // AUTOMATIC MODE (COMMENTED OUT - TODO: Enable later)
      // ==============================================
      // // Calculate clearing price using Dutch auction logic
      // // Sort bids by price (highest first) and find clearing price
      // const totalSupply = BigInt(asset.tokenParams.totalSupply);
      // let clearingPrice = asset.listing?.reservePrice || '0';
      // let tokensSold = BigInt(0);
      //
      // if (bids.length > 0) {
      //   let accumulatedDemand = BigInt(0);
      //
      //   for (const bid of bids) {
      //     const bidAmount = BigInt(bid.tokenAmount);
      //     accumulatedDemand += bidAmount;
      //
      //     // If accumulated demand meets or exceeds total supply, this bid's price is clearing price
      //     if (accumulatedDemand >= totalSupply) {
      //       clearingPrice = bid.price;
      //       tokensSold = totalSupply; // All tokens sold
      //       break;
      //     }
      //
      //     // Otherwise, keep going and this could be the clearing price for partial fill
      //     clearingPrice = bid.price;
      //     tokensSold = accumulatedDemand;
      //   }
      //
      //   this.logger.log(
      //     `Calculated clearing price: ${clearingPrice} with ${tokensSold.toString()} tokens sold`,
      //   );
      // } else {
      //   this.logger.log(`No bids received, using reserve price: ${clearingPrice}`);
      // }
      //
      // // Call blockchain to end auction with calculated clearing price
      // this.logger.log(`Calling blockchain to end auction ${assetId} with clearing price ${clearingPrice}`);
      // const txHash = await this.blockchainService.endAuction(assetId, clearingPrice);
      // this.logger.log(`Auction ended on-chain in tx: ${txHash}`);
      //
      // // Update asset with clearing price and mark as ended
      // await this.assetModel.updateOne(
      //   { assetId },
      //   {
      //     $set: {
      //       'listing.clearingPrice': clearingPrice,
      //       'listing.active': false,
      //       'listing.endedAt': new Date(),
      //       'listing.endTransactionHash': txHash,
      //       'listing.sold': tokensSold.toString(),
      //     },
      //   },
      // );
      //
      // const tokensRemaining = (totalSupply - tokensSold).toString();

      this.logger.log(
        `Auction ${assetId} results: Clearing price: ${clearingPrice}, Sold: ${tokensSold}, Remaining: ${tokensRemaining}`,
      );

      // Create AUCTION_ENDED announcement
      // Note: Admin should call endAuction endpoint to settle on-chain before this runs
      await this.announcementService.createAuctionEndedAnnouncement(
        assetId,
        clearingPrice,
        tokensSold,
        tokensRemaining,
      );
    } catch (error) {
      this.logger.error(
        `Error checking auction end for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
