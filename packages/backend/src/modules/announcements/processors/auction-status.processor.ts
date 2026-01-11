import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { User, UserDocument, UserRole } from '../../../database/schemas/user.schema';
import { AnnouncementService } from '../services/announcement.service';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { toISTISOString } from '../../../utils/date.utils';

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
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectQueue('auction-status-check')
    private auctionStatusQueue: Queue,
    private announcementService: AnnouncementService,
    private blockchainService: BlockchainService,
    private notificationService: NotificationService,
    private assetLifecycleService: AssetLifecycleService,
  ) {
    super();
  }

  /**
   * Helper method to notify all admin users
   */
  private async notifyAllAdmins(header: string, detail: string, type: NotificationType, severity: NotificationSeverity, action: NotificationAction, actionMetadata?: any) {
    try {
      const admins = await this.userModel.find({ role: UserRole.ADMIN });
      this.logger.log(`Notifying ${admins.length} admin users: ${header}`);

      for (const admin of admins) {
        try {
          await this.notificationService.create({
            userId: admin.walletAddress,
            walletAddress: admin.walletAddress,
            header,
            detail,
            type,
            severity,
            action,
            actionMetadata,
          });
        } catch (error: any) {
          this.logger.error(`Failed to send notification to admin ${admin.walletAddress}: ${error.message}`);
          // Continue notifying other admins even if one fails
        }
      }
    } catch (error: any) {
      this.logger.error(`Failed to fetch admin users: ${error.message}`);
    }
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
      const minPrice = asset.listing?.priceRange?.min || reservePrice;
      const duration = asset.listing?.duration || 3600; // Default 1 hour
      const minInvestment = asset.tokenParams?.minInvestment || '1000000000000000000'; // Default 1 token

      this.logger.log(
        `Creating on-chain auction listing for ${assetId}: token=${tokenAddress}, reserve=${reservePrice}, minPrice=${minPrice}, duration=${duration}s`,
      );

      // Create the auction listing on-chain
      const txHash = await this.blockchainService.listOnMarketplace(
        tokenAddress,
        'AUCTION',
        reservePrice,
        minInvestment,
        duration.toString(),
        minPrice,
      );

      this.logger.log(`Auction listing created on-chain in tx: ${txHash}`);

      // Activate the auction in database
      const actualStartTime = new Date();
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            status: 'LISTED',
            'listing.active': true,
            'listing.listedAt': actualStartTime,
            'listing.transactionHash': txHash,
          },
        },
      );

      this.logger.log(`Auction ${assetId} activated at ${toISTISOString(actualStartTime)}`);

      // Notify originator that auction is now live
      try {
        await this.notificationService.create({
          userId: asset.originator,
          walletAddress: asset.originator,
          header: 'Auction Now Live!',
          detail: `Your auction for asset ${asset.metadata.invoiceNumber} is now live and accepting bids.`,
          type: NotificationType.ASSET_STATUS,
          severity: NotificationSeverity.SUCCESS,
          action: NotificationAction.VIEW_ASSET,
          actionMetadata: {
            assetId,
            listedAt: toISTISOString(actualStartTime),
            transactionHash: txHash,
          },
        });
      } catch (error: any) {
        this.logger.error(`Failed to send auction live notification to originator: ${error.message}`);
      }

      // Notify all admins that auction is now live
      await this.notifyAllAdmins(
        'Auction Now Live',
        `Auction for asset ${asset.metadata.invoiceNumber} from ${asset.originator} is now live and accepting bids.`,
        NotificationType.ASSET_STATUS,
        NotificationSeverity.INFO,
        NotificationAction.VIEW_ASSET,
        {
          assetId,
          originator: asset.originator,
          listedAt: toISTISOString(actualStartTime),
          transactionHash: txHash,
        }
      );

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

      // Calculate suggested clearing price and notify admins
      try {
        const clearingPriceAnalysis = await this.assetLifecycleService.calculateSuggestedClearingPrice(assetId);

        this.logger.log(
          `Suggested clearing price for ${assetId}: ${clearingPriceAnalysis.suggestedPrice} ` +
          `(${clearingPriceAnalysis.percentageOfSupply.toFixed(2)}% of supply, ${clearingPriceAnalysis.totalBids} bids)`,
        );

        // Format bid summary for admin notification
        const bidSummary = clearingPriceAnalysis.priceBreakdown
          .slice(0, 5) // Top 5 price points
          .map(
            (p) =>
              `  • $${(Number(p.price) / 1e6).toFixed(2)}: ${p.bidsCount} bids, ${p.percentage.toFixed(1)}% supply`,
          )
          .join('\n');

        const notificationDetail = `
Auction for ${asset.metadata.invoiceNumber} has ended!

📊 Suggested Clearing Price: $${(Number(clearingPriceAnalysis.suggestedPrice) / 1e6).toFixed(2)}
   → Sells ${clearingPriceAnalysis.percentageOfSupply.toFixed(1)}% of token supply
   → ${(Number(clearingPriceAnalysis.tokensAtPrice) / 1e18).toFixed(0)} tokens sold

📈 Bid Summary (${clearingPriceAnalysis.totalBids} total bids):
${bidSummary || '  No bids received'}

⚠️ Action Required: Please review bids and set the final clearing price via the admin panel.
        `.trim();

        // Notify all admins with suggested clearing price
        await this.notifyAllAdmins(
          'Auction Ended - Action Required',
          notificationDetail,
          NotificationType.SYSTEM_ALERT,
          NotificationSeverity.WARNING,
          NotificationAction.VIEW_ASSET,
          {
            assetId,
            suggestedClearingPrice: clearingPriceAnalysis.suggestedPrice,
            tokensAtPrice: clearingPriceAnalysis.tokensAtPrice,
            percentageOfSupply: clearingPriceAnalysis.percentageOfSupply,
            totalBids: clearingPriceAnalysis.totalBids,
            allBids: clearingPriceAnalysis.allBids,
            priceBreakdown: clearingPriceAnalysis.priceBreakdown,
          },
        );

        this.logger.log(`Sent clearing price suggestion to all admins for auction ${assetId}`);
      } catch (error) {
        this.logger.error(
          `Failed to calculate/send clearing price suggestion for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Continue execution even if suggestion fails
      }

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
        `Auction ${assetId} bidding period ended. Creating AUCTION_ENDED announcement and waiting for admin to declare results.`,
      );

      // Update asset status to ENDED (bidding closed, but results not yet declared)
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            status: 'ENDED', // Bidding closed
            'listing.active': false, // No more bids allowed
            'listing.phase': 'ENDED',
            'listing.endedAt': new Date(),
          },
        },
      );

      this.logger.log(`Asset ${assetId} status updated to ENDED. Bidding is now closed.`);

      // Update all bids for this auction from PLACED to FINALIZED
      const updateResult = await this.bidModel.updateMany(
        { assetId, status: 'PLACED' },
        { $set: { status: 'FINALIZED' } }
      );
      this.logger.log(`Updated ${updateResult.modifiedCount} bids from PLACED to FINALIZED for auction ${assetId}`);

      // Send notifications to all bidders who participated in this auction
      const bidders = await this.bidModel.distinct('bidder', { assetId });
      this.logger.log(`Sending auction ended notifications to ${bidders.length} bidders for auction ${assetId}`);

      for (const bidderWallet of bidders) {
        try {
          await this.notificationService.create({
            userId: bidderWallet,
            walletAddress: bidderWallet,
            header: 'Auction Ended',
            detail: `The auction for asset ${asset.metadata.invoiceNumber} has ended. The admin will declare results soon. Please check back for your bid outcome.`,
            type: NotificationType.ASSET_STATUS,
            severity: NotificationSeverity.INFO,
            action: NotificationAction.VIEW_ASSET,
            actionMetadata: {
              assetId,
              auctionEnded: true,
              awaitingResults: true,
            },
          });
        } catch (error: any) {
          this.logger.error(`Failed to send auction ended notification to ${bidderWallet}: ${error.message}`);
          // Continue with other notifications even if one fails
        }
      }

      this.logger.log(`Sent auction ended notifications to all ${bidders.length} bidders for auction ${assetId}`);

      // Create AUCTION_ENDED announcement (bidding closed, not results declared)
      await this.announcementService.createAuctionEndedAnnouncement(
        assetId,
        '0', // No clearing price yet
        '0', // No tokens sold yet
        asset.tokenParams.totalSupply, // All tokens still available
      );

      this.logger.log(`AUCTION_ENDED announcement created for ${assetId}. Admin must now declare results.`);
    } catch (error) {
      this.logger.error(
        `Error checking auction end for ${assetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}
