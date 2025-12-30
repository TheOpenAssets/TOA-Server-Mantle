import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Payout, PayoutDocument } from '../../../database/schemas/payout.schema';
import { User, UserDocument, UserRole } from '../../../database/schemas/user.schema';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';

import { RegisterAssetDto } from '../../blockchain/dto/register-asset.dto';
import { AttestationService } from '../../compliance-engine/services/attestation.service';
import { AnnouncementService } from '../../announcements/services/announcement.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Payout.name) private payoutModel: Model<PayoutDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    @InjectQueue('auction-status-check') private auctionStatusQueue: Queue,
    private attestationService: AttestationService,
    @Inject(forwardRef(() => AnnouncementService))
    private announcementService: AnnouncementService,
    private configService: ConfigService,
    private notificationService: NotificationService,
  ) {}

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

  async getRegisterAssetPayload(assetId: string): Promise<RegisterAssetDto> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new Error('Asset not found');

    // Convert UUID to bytes32 (remove hyphens and pad to 32 bytes)
    const assetIdBytes32 = '0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0');

    // Mocks for now - in real flow these come from Attestation/EigenDA steps
    return {
        assetId: assetIdBytes32,
        attestationHash: asset.attestation?.hash || '0x' + '0'.repeat(64),
        blobId: asset.eigenDA?.blobId || '0x' + '0'.repeat(64),
        payload: asset.attestation?.payload || '0x',
        signature: asset.attestation?.signature || '0x' + '0'.repeat(130),
    };
  }

  async createAsset(userWallet: string, dto: CreateAssetDto, file: Express.Multer.File) {
    const assetId = uuidv4();
    this.logger.log(`Creating ${dto.assetType} asset ${assetId} for originator ${userWallet}`);

    // Calculate price ranges based on face value and percentages
    const faceValue = BigInt(dto.faceValue);
    const totalSupply = BigInt(dto.totalSupply);
    const minRaisePercentage = BigInt(dto.minRaisePercentage);
    const maxRaisePercentage = BigInt(dto.maxRaisePercentage || '95'); // Default 95%

    // Calculate minimum and maximum raise amounts (in USD, no decimals yet)
    const minRaiseUSD = (faceValue * minRaisePercentage) / BigInt(100);
    const maxRaiseUSD = (faceValue * maxRaisePercentage) / BigInt(100);

    // Convert to USDC (6 decimals) for blockchain
    const minRaise = minRaiseUSD * BigInt(10 ** 6);
    const maxRaise = maxRaiseUSD * BigInt(10 ** 6);

    // Calculate min and max price per token
    // totalSupply is in wei (18 decimals), e.g., 100000 * 10^18
    // raiseAmount is in USDC wei (6 decimals), e.g., 80000 * 10^6
    // Price formula: (raiseAmount * 10^18) / totalSupply
    // Result is in USDC wei (6 decimals) per full token (10^18 wei)
    // Example: (80000 * 10^6 * 10^18) / (100000 * 10^18) = 800000 USDC wei = 0.8 USDC
    const minPricePerToken = (minRaise * BigInt(10 ** 18)) / totalSupply;
    const maxPricePerToken = (maxRaise * BigInt(10 ** 18)) / totalSupply;

    // For STATIC assets, validate custom price if provided
    let finalPricePerToken: string | undefined;
    if (dto.assetType === 'STATIC') {
      if (dto.pricePerToken) {
        const customPrice = BigInt(dto.pricePerToken);
        // Validate that custom price is within calculated range
        if (customPrice < minPricePerToken || customPrice > maxPricePerToken) {
          throw new Error(
            `Price per token must be between ${minPricePerToken.toString()} and ${maxPricePerToken.toString()} wei. ` +
            `Provided: ${customPrice.toString()} wei. This ensures the raise amount is between ${minRaisePercentage}% and ${maxRaisePercentage}% of face value.`
          );
        }
        finalPricePerToken = dto.pricePerToken;
      } else {
        // Use min price by default for static listings (based on minimum raise requirement)
        finalPricePerToken = minPricePerToken.toString();
      }
    }

    // Create Asset Record
    const asset = new this.assetModel({
      assetId,
      originator: userWallet,
      status: AssetStatus.UPLOADED,
      assetType: dto.assetType,
      metadata: {
        invoiceNumber: dto.invoiceNumber,
        faceValue: dto.faceValue,
        currency: dto.currency,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        buyerName: dto.buyerName,
        industry: dto.industry,
        riskTier: dto.riskTier,
      },
      tokenParams: {
        totalSupply: dto.totalSupply,
        pricePerToken: finalPricePerToken,
        minInvestment: dto.minInvestment,
        minRaise: minRaise.toString(),
      },
      files: {
        invoice: {
          tempPath: file.path,
          size: file.size,
          uploadedAt: new Date(),
        },
      },
      checkpoints: {
        uploaded: true,
      },
    });

    // Store auction parameters if asset type is AUCTION
    if (dto.assetType === 'AUCTION') {
      asset.listing = {
        type: 'AUCTION',
        reservePrice: minPricePerToken.toString(),
        priceRange: {
          min: minPricePerToken.toString(),
          max: maxPricePerToken.toString(),
        },
        duration: parseInt(dto.auctionDuration),
        sold: '0',
        active: false, // Will be activated when admin approves and deploys
        listedAt: new Date(),
        phase: 'BIDDING',
      };
    }

    await asset.save();

    // Queue Hash Computation
    await this.assetQueue.add('hash-computation', {
      assetId,
      filePath: file.path,
    });

    // Send notification for asset upload
    await this.notificationService.create({
      userId: userWallet,
      walletAddress: userWallet,
      header: 'Asset Upload Successful',
      detail: `Your asset ${dto.invoiceNumber} has been uploaded and is being processed.`,
      type: NotificationType.ASSET_STATUS,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_ASSET,
      actionMetadata: { assetId },
    });

    return {
      assetId,
      status: AssetStatus.UPLOADED,
      assetType: dto.assetType,
      message: `${dto.assetType} asset uploaded successfully. Processing started.`,
      priceRange: {
        min: minPricePerToken.toString(),
        max: maxPricePerToken.toString(),
        minRaise: minRaise.toString(),
        maxRaise: maxRaise.toString(),
      },
    };
  }

  async getAsset(assetId: string) {
    return this.assetModel.findOne({ assetId });
  }

  async getAssetsByOriginator(originator: string) {
    return this.assetModel.find({ originator });
  }

  async approveAsset(assetId: string, adminWallet: string) {
    this.logger.log(`Asset ${assetId} approved by admin ${adminWallet}`);

    // Get the asset to generate attestation
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    // Generate attestation with ECDSA signature
    const attestation = await this.attestationService.generateAttestation(asset, adminWallet);

    // Update asset with attestation and set status to ATTESTED
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.ATTESTED,
          'checkpoints.attested': true,
          'attestation.payload': attestation.payload,
          'attestation.hash': attestation.hash,
          'attestation.signature': attestation.signature,
          'attestation.attestor': adminWallet,
          'attestation.timestamp': new Date()
        }
      }
    );

    // Queue EigenDA anchoring job
    await this.assetQueue.add('eigenda-anchoring', { assetId });

    this.logger.log(`Asset ${assetId} attested and queued for EigenDA anchoring`);

    // Send notification for attestation
    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Asset Approved by Compliance',
      detail: `Your asset ${asset.metadata.invoiceNumber} has been approved and is ready for registration.`,
      type: NotificationType.ASSET_STATUS,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_ASSET,
      actionMetadata: { assetId },
    });

    return { success: true, assetId, status: AssetStatus.ATTESTED };
  }

  async scheduleAuction(assetId: string, startDelayMinutes: number) {
    this.logger.log(`Scheduling auction for asset ${assetId} to start in ${startDelayMinutes} minutes`);

    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.assetType !== 'AUCTION') {
      throw new Error('Asset is not an auction type');
    }

    if ( asset.status !== AssetStatus.TOKENIZED) {
      throw new Error('Asset must be TOKENIZED before scheduling auction');
    }

    // Calculate auction start time
    const auctionStartTime = new Date(Date.now() + startDelayMinutes * 60 * 1000);

    // Calculate auction end time (start time + duration)
    const auctionDuration = asset.listing?.duration || 0; // Duration in seconds
    const auctionEndTime = new Date(auctionStartTime.getTime() + auctionDuration * 1000);

    // Calculate when to check if auction ended (1 minute after end time)
    const endCheckTime = new Date(auctionEndTime.getTime() + 60 * 1000);

    this.logger.log(`Auction ${assetId} will start at ${auctionStartTime.toISOString()}`);
    this.logger.log(`Auction ${assetId} will end at ${auctionEndTime.toISOString()}`);

    // Update asset status to SCHEDULED
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.SCHEDULED,
          'listing.scheduledStartTime': auctionStartTime,
          'listing.scheduledEndTime': auctionEndTime,
        },
      },
    );

    this.logger.log(`Asset ${assetId} status updated to SCHEDULED`);

    // Create AUCTION_SCHEDULED announcement immediately
    await this.announcementService.createAuctionScheduledAnnouncement(
      assetId,
      auctionStartTime,
    );

    // Send notification to originator about auction scheduling
    try {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Auction Scheduled',
        detail: `Your auction for asset ${asset.metadata.invoiceNumber} has been scheduled to start at ${auctionStartTime.toLocaleString()}.`,
        type: NotificationType.ASSET_STATUS,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: {
          assetId,
          scheduledStartTime: auctionStartTime.toISOString(),
          scheduledEndTime: auctionEndTime.toISOString(),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send auction scheduled notification: ${error.message}`);
      // Don't fail the scheduling if notification fails
    }

    // Notify all admins about the scheduled auction
    await this.notifyAllAdmins(
      'Auction Scheduled',
      `Auction for asset ${asset.metadata.invoiceNumber} from ${asset.originator} has been scheduled to start at ${auctionStartTime.toLocaleString()}.`,
      NotificationType.ASSET_STATUS,
      NotificationSeverity.INFO,
      NotificationAction.VIEW_ASSET,
      {
        assetId,
        originator: asset.originator,
        scheduledStartTime: auctionStartTime.toISOString(),
        scheduledEndTime: auctionEndTime.toISOString(),
      }
    );

    // Queue delayed job to activate auction at the scheduled time
    await this.auctionStatusQueue.add(
      'activate-auction',
      {
        assetId,
        scheduledStartTime: auctionStartTime,
      },
      {
        delay: startDelayMinutes * 60 * 1000, // Convert minutes to milliseconds
      },
    );

    this.logger.log(
      `Queued auction activation for ${assetId} to run at ${auctionStartTime.toISOString()}`,
    );

    // Queue delayed job to check if auction ended (1 minute after end time)
    const totalDelayMs = startDelayMinutes * 60 * 1000 + auctionDuration * 1000 + 60 * 1000;
    await this.auctionStatusQueue.add(
      'check-auction-end',
      {
        assetId,
        expectedEndTime: auctionEndTime,
      },
      {
        delay: totalDelayMs,
      },
    );

    this.logger.log(
      `Queued auction end check for ${assetId} to run at ${endCheckTime.toISOString()}`,
    );

    return {
      success: true,
      assetId,
      scheduledStartTime: auctionStartTime,
      scheduledEndTime: auctionEndTime,
      message: `Auction scheduled to start in ${startDelayMinutes} minutes and run for ${auctionDuration / 60} minutes`,
    };
  }

  /**
   * Calculate suggested clearing price for an auction
   * Algorithm:
   * 1. Find price where tokens sold >= total supply (100%)
   * 2. If not found, try 75%, 50%, 25% thresholds (in order)
   * 3. Return the first threshold met
   */
  async calculateSuggestedClearingPrice(assetId: string): Promise<{
    suggestedPrice: string;
    tokensAtPrice: string;
    percentageOfSupply: number;
    totalBids: number;
    allBids: any[];
    priceBreakdown: any[];
  }> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const bids = await this.bidModel.find({ assetId }).sort({ price: -1 }).exec();
    const totalSupply = BigInt(asset.tokenParams.totalSupply);

    if (bids.length === 0) {
      return {
        suggestedPrice: asset.listing?.reservePrice || '0',
        tokensAtPrice: '0',
        percentageOfSupply: 0,
        totalBids: 0,
        allBids: [],
        priceBreakdown: [],
      };
    }

    // Get unique price points sorted descending
    const uniquePrices = [...new Set(bids.map(b => b.price))].sort((a, b) => {
      const aNum = BigInt(a);
      const bNum = BigInt(b);
      return aNum > bNum ? -1 : aNum < bNum ? 1 : 0;
    });

    // Calculate cumulative tokens at each price point
    const priceBreakdown = uniquePrices.map(price => {
      const priceBigInt = BigInt(price);
      let cumulativeTokens = BigInt(0);
      const bidsAtThisPrice = [];

      for (const bid of bids) {
        if (BigInt(bid.price) >= priceBigInt) {
          cumulativeTokens += BigInt(bid.tokenAmount);
          bidsAtThisPrice.push({
            bidder: bid.bidder,
            price: bid.price,
            tokenAmount: bid.tokenAmount,
            usdcDeposited: bid.usdcDeposited,
          });
        }
      }

      const percentage = Number((cumulativeTokens * BigInt(10000)) / totalSupply) / 100;

      return {
        price,
        cumulativeTokens: cumulativeTokens.toString(),
        percentage,
        bidsCount: bidsAtThisPrice.length,
      };
    });

    // Find clearing price based on thresholds
    const thresholds = [
      { percentage: 100, label: '100% (Full Supply)' },
      { percentage: 75, label: '75% of Supply' },
      { percentage: 50, label: '50% of Supply' },
      { percentage: 25, label: '25% of Supply' },
    ];

    let suggestedPrice = asset.listing?.reservePrice || '0';
    let tokensAtPrice = '0';
    let percentageOfSupply = 0;

    for (const threshold of thresholds) {
      const breakdown = priceBreakdown.find(p => p.percentage >= threshold.percentage);
      if (breakdown) {
        suggestedPrice = breakdown.price;
        tokensAtPrice = breakdown.cumulativeTokens;
        percentageOfSupply = breakdown.percentage;
        this.logger.log(
          `Found clearing price at ${threshold.label}: ${suggestedPrice} (${percentageOfSupply.toFixed(2)}% of supply)`,
        );
        break;
      }
    }

    // FIX: If no threshold met, calculate tokens at reserve price
    if (percentageOfSupply === 0 && bids.length > 0) {
      const reservePrice = BigInt(asset.listing?.reservePrice || '0');
      let tokensAtReserve = BigInt(0);

      for (const bid of bids) {
        if (BigInt(bid.price) >= reservePrice) {
          tokensAtReserve += BigInt(bid.tokenAmount);
        }
      }

      tokensAtPrice = tokensAtReserve.toString();
      percentageOfSupply = Number((tokensAtReserve * BigInt(10000)) / totalSupply) / 100;

      this.logger.log(
        `No threshold met. Using reserve price ${suggestedPrice} with ${percentageOfSupply.toFixed(2)}% of supply`,
      );
    }

    return {
      suggestedPrice,
      tokensAtPrice,
      percentageOfSupply,
      totalBids: bids.length,
      allBids: bids.map(b => ({
        bidder: b.bidder,
        price: b.price,
        tokenAmount: b.tokenAmount,
        usdcDeposited: b.usdcDeposited,
        status: b.status,
        createdAt: b.createdAt,
      })),
      priceBreakdown,
    };
  }

  async endAuction(assetId: string, clearingPrice: string, transactionHash: string) {
    this.logger.log(`Ending auction for asset ${assetId} with clearing price ${clearingPrice}`);

    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.assetType !== 'AUCTION') {
      throw new Error('Asset is not an auction type');
    }

    // Check if auction is already ended (idempotent behavior for event processing)
    if (!asset.listing || !asset.listing.active) {
      // If already ended, verify it's the same clearing price
      if (asset.listing?.clearingPrice === clearingPrice) {
        this.logger.log(`Auction ${assetId} already ended with clearing price ${clearingPrice} - skipping duplicate processing`);

        // Get all bids to calculate results for response
        const bids = await this.bidModel.find({ assetId }).exec();
        const clearingPriceBigInt = BigInt(clearingPrice);
        let tokensSold = BigInt(0);
        let wonCount = 0;
        let lostCount = 0;

        // Update bid statuses if not already done (idempotent)
        for (const bid of bids) {
          const bidPrice = BigInt(bid.price);
          if (bidPrice >= clearingPriceBigInt) {
            tokensSold += BigInt(bid.tokenAmount);
            // Update to WON if not already
            if (bid.status === 'PENDING') {
              await this.bidModel.updateOne(
                { _id: bid._id },
                { $set: { status: 'WON' } },
              );
              wonCount++;
            }
          } else {
            // Update to LOST if not already
            if (bid.status === 'PENDING') {
              await this.bidModel.updateOne(
                { _id: bid._id },
                { $set: { status: 'LOST' } },
              );
              lostCount++;
            }
          }
        }

        if (wonCount > 0 || lostCount > 0) {
          this.logger.log(`Bid statuses updated (idempotent): ${wonCount} WON, ${lostCount} LOST`);
        }

        const totalSupply = BigInt(asset.tokenParams.totalSupply);
        const tokensRemaining = totalSupply - tokensSold;

        return {
          success: true,
          assetId,
          clearingPrice,
          tokensSold: tokensSold.toString(),
          tokensRemaining: tokensRemaining.toString(),
          totalBids: bids.length,
          transactionHash,
          message: 'Auction already ended (idempotent)',
        };
      } else {
        throw new Error(`Auction already ended with different clearing price: ${asset.listing?.clearingPrice}`);
      }
    }

    // Update asset with clearing price and mark as ended
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.clearingPrice': clearingPrice,
          'listing.active': false,
          'listing.phase': 'ENDED',
          'listing.endedAt': new Date(),
          'listing.endTransactionHash': transactionHash,
        },
      },
    );

    this.logger.log(`Auction ${assetId} ended with clearing price ${clearingPrice}`);

    // Get all bids to calculate results
    const bids = await this.bidModel.find({ assetId }).exec();
    this.logger.log(`Found ${bids.length} bids for auction ${assetId}`);

    // Calculate tokens sold and update bid statuses (bids >= clearing price = WON, else LOST)
    const clearingPriceBigInt = BigInt(clearingPrice);
    let tokensSold = BigInt(0);
    let wonCount = 0;
    let lostCount = 0;

    for (const bid of bids) {
      const bidPrice = BigInt(bid.price);
      if (bidPrice >= clearingPriceBigInt) {
        tokensSold += BigInt(bid.tokenAmount);
        // Update bid status to WON
        await this.bidModel.updateOne(
          { _id: bid._id },
          { $set: { status: 'WON' } },
        );
        wonCount++;
      } else {
        // Update bid status to LOST
        await this.bidModel.updateOne(
          { _id: bid._id },
          { $set: { status: 'LOST' } },
        );
        lostCount++;
      }
    }

    this.logger.log(`Bid statuses updated: ${wonCount} WON, ${lostCount} LOST`);

    // Calculate remaining tokens
    const totalSupply = BigInt(asset.tokenParams.totalSupply);
    const tokensRemaining = totalSupply - tokensSold;

    this.logger.log(
      `Auction results: Clearing price: ${clearingPrice}, Sold: ${tokensSold.toString()}, Remaining: ${tokensRemaining.toString()}`,
    );

    // Create AUCTION_ENDED announcement
    await this.announcementService.createAuctionEndedAnnouncement(
      assetId,
      clearingPrice,
      tokensSold.toString(),
      tokensRemaining.toString(),
    );

    // If there are remaining tokens, update listing to allow sales at clearing price
    if (tokensRemaining > BigInt(0)) {
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'listing.staticPrice': clearingPrice, // Set static price to clearing price
            'listing.price': clearingPrice, // Also set price field
            'listing.type': 'STATIC', // Convert to static listing for remaining tokens
            'listing.active': true, // Re-activate listing for remaining token sales
          },
        },
      );

      this.logger.log(
        `Remaining tokens (${tokensRemaining.toString()}) now available for purchase at clearing price $${Number(clearingPrice) / 1e6}. Listing re-activated as STATIC.`,
      );
    }

    return {
      success: true,
      assetId,
      clearingPrice,
      tokensSold: tokensSold.toString(),
      tokensRemaining: tokensRemaining.toString(),
      totalBids: bids.length,
      transactionHash,
      message: 'Auction ended successfully',
    };
  }

  async rejectAsset(assetId: string, reason: string) {
    this.logger.log(`Asset ${assetId} rejected. Reason: ${reason}`);
    return this.assetModel.updateOne(
        { assetId },
        { 
            $set: { 
                status: AssetStatus.REJECTED 
            } 
        }
    );
  }

  async getAllAssets(filters?: {
    status?: AssetStatus;
    originator?: string;
    needsAttention?: boolean;
    page?: number;
    limit?: number;
  }) {
    const query: any = {};

    // Apply status filter
    if (filters?.status) {
      query.status = filters.status;
    }

    // Apply originator filter
    if (filters?.originator) {
      query.originator = filters.originator;
    }

    // Apply "needs attention" filter (assets requiring admin action)
    if (filters?.needsAttention) {
      query.status = {
        $in: [
          AssetStatus.UPLOADED,
          AssetStatus.ATTESTED,
          AssetStatus.REGISTERED,
          AssetStatus.TOKENIZED,
        ],
      };
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const skip = (page - 1) * limit;

    const [assets, total] = await Promise.all([
      this.assetModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.assetModel.countDocuments(query),
    ]);

    return {
      assets,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Calculate and payout USDC to originator
   * Simple: Sum USDC from settled bids, verify balance, transfer to originator
   */
  async payoutOriginator(assetId: string) {
    this.logger.log(`Processing originator payout for asset: ${assetId}`);

    // Get asset
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    let totalUsdcRaised = BigInt(0);
    let settledBids: any[] = [];
    let confirmedPurchases: any[] = [];

    // Handle based on listing type
    if (asset.listing?.type === 'STATIC') {
      // For STATIC listings: sum USDC from confirmed purchases
      this.logger.log(`STATIC listing detected - calculating from purchases`);

      confirmedPurchases = await this.purchaseModel.find({
        assetId,
        status: 'CONFIRMED',
      });

      for (const purchase of confirmedPurchases) {
        totalUsdcRaised += BigInt(purchase.totalPayment);
      }

      this.logger.log(`Found ${confirmedPurchases.length} confirmed purchases`);
    } else if (asset.listing?.type === 'AUCTION') {
      // For AUCTION listings: sum USDC from settled bids
      this.logger.log(`AUCTION listing detected - calculating from bids`);

      settledBids = await this.bidModel.find({
        assetId,
        status: { $in: ['SETTLED', 'REFUNDED'] },
      });

      // Sum up USDC received (only from winning bids - SETTLED status means they got tokens)
      for (const bid of settledBids) {
        if (bid.status === 'SETTLED') {
          totalUsdcRaised += BigInt(bid.usdcDeposited);
        }
      }

      this.logger.log(`Found ${settledBids.filter(b => b.status === 'SETTLED').length} settled bids`);
    } else {
      throw new Error(`Unknown or missing listing type: ${asset.listing?.type}`);
    }

    if (totalUsdcRaised === BigInt(0)) {
      throw new Error('No USDC raised yet - no confirmed purchases or settled bids');
    }

    this.logger.log(`Total USDC to payout: ${totalUsdcRaised.toString()} (${Number(totalUsdcRaised) / 1e6} USDC)`);

    // Execute transfer on-chain
    const platformPrivateKey = this.configService.get<string>('PLATFORM_PRIVATE_KEY');
    const rpcUrl = this.configService.get<string>('blockchain.rpcUrl');

    if (!platformPrivateKey) {
      throw new Error('PLATFORM_PRIVATE_KEY not configured');
    }

    // Read deployed contracts for USDC address
    const fs = require('fs');
    const path = require('path');
    const deployedContractsPath = path.join(process.cwd(), '../contracts/deployed_contracts.json');
    const deployedContracts = JSON.parse(fs.readFileSync(deployedContractsPath, 'utf-8'));
    const usdcAddress = deployedContracts.contracts.USDC;

    if (!usdcAddress) {
      throw new Error('USDC address not found in deployed contracts');
    }

    this.logger.log(`Using USDC contract: ${usdcAddress}`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(platformPrivateKey, provider);

    const USDC_ABI = [
      'function balanceOf(address) view returns (uint256)',
      'function transfer(address to, uint256 amount) returns (bool)',
    ];

    const usdc = new ethers.Contract(usdcAddress, USDC_ABI, wallet) as any;

    // Check platform balance
    const balance = await usdc.balanceOf(wallet.address) as bigint;
    this.logger.log(`Platform USDC balance: ${balance.toString()} (${Number(balance) / 1e6} USDC)`);

    if (balance < totalUsdcRaised) {
      throw new Error(`Insufficient USDC balance. Have: ${Number(balance) / 1e6}, Need: ${Number(totalUsdcRaised) / 1e6}`);
    }

    // Execute transfer
    this.logger.log(`Transferring ${Number(totalUsdcRaised) / 1e6} USDC to ${asset.originator}`);
    const tx = await usdc.transfer(asset.originator, totalUsdcRaised) as any;
    this.logger.log(`Transaction submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    this.logger.log(`Transaction confirmed in block ${receipt.blockNumber}`);

    // Create payout record in MongoDB
    const payoutData: any = {
      assetId,
      originator: asset.originator,
      amount: totalUsdcRaised.toString(),
      amountFormatted: `${Number(totalUsdcRaised) / 1e6} USDC`,
      transactionHash: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      paidAt: new Date(),
    };

    // Add type-specific data
    if (asset.listing?.type === 'STATIC') {
      payoutData.purchaseIds = confirmedPurchases.map(p => p._id.toString());
      payoutData.purchasesCount = confirmedPurchases.length;
    } else if (asset.listing?.type === 'AUCTION') {
      const settledBidsOnly = settledBids.filter(b => b.status === 'SETTLED');
      payoutData.settledBidIds = settledBidsOnly.map(bid => bid._id.toString());
      payoutData.settledBidsCount = settledBidsOnly.length;
    }

    const payoutRecord = new this.payoutModel(payoutData);

    await payoutRecord.save();
    this.logger.log(`Payout record saved to MongoDB with ID: ${payoutRecord._id}`);

    // Update asset with amountRaised and status
    const updateResult = await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.amountRaised': totalUsdcRaised.toString(),
          status: AssetStatus.PAYOUT_COMPLETE,
          'checkpoints.payoutComplete': true,
        },
      },
    );

    this.logger.log(`Asset ${assetId} update result: matched=${updateResult.matchedCount}, modified=${updateResult.modifiedCount}`);

    if (updateResult.matchedCount === 0) {
      this.logger.error(`Failed to update asset ${assetId} - asset not found in database`);
      throw new Error(`Asset ${assetId} not found for status update`);
    }

    if (updateResult.modifiedCount === 0) {
      this.logger.warn(`Asset ${assetId} matched but not modified - may already be in PAYOUT_COMPLETE status`);
    } else {
      this.logger.log(`Asset ${assetId} updated: amountRaised=${Number(totalUsdcRaised) / 1e6} USDC, status=PAYOUT_COMPLETE`);
    }

    // Send notification to originator about payout
    try {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Payout Complete',
        detail: `Your payout of ${Number(totalUsdcRaised) / 1e6} USDC for asset ${asset.metadata.invoiceNumber} has been successfully transferred to your wallet.`,
        type: NotificationType.PAYOUT_SETTLED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId,
          amount: totalUsdcRaised.toString(),
          transactionHash: tx.hash,
        },
      });
      this.logger.log(`Payout notification sent to originator ${asset.originator}`);
    } catch (error) {
      this.logger.error(`Failed to send payout notification: ${error}`);
      // Don't throw - notification failure shouldn't fail the payout
    }

    return {
      success: true,
      assetId,
      originator: asset.originator,
      totalUsdcRaised: totalUsdcRaised.toString(),
      totalUsdcRaisedFormatted: `${Number(totalUsdcRaised) / 1e6} USDC`,
      listingType: asset.listing?.type,
      transactionCount: asset.listing?.type === 'STATIC' ? confirmedPurchases.length : settledBids.filter(b => b.status === 'SETTLED').length,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      payoutId: payoutRecord._id.toString(),
      message: 'Payout executed successfully!',
    };
  }

  /**
   * Get purchase history for an asset (for buy history graph)
   */
  async getPurchaseHistory(assetId: string) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const purchases: any[] = [];
    let totalTokensSold = BigInt(0);
    let totalUSDCRaised = BigInt(0);

    if (asset.listing?.type === 'STATIC') {
      // Get confirmed purchases for STATIC listings
      const confirmedPurchases = await this.purchaseModel
        .find({ assetId, status: 'CONFIRMED' })
        .sort({ createdAt: 1 }) // Sort by time ascending
        .exec();

      for (const purchase of confirmedPurchases) {
        purchases.push({
          buyer: purchase.investorWallet,
          tokenAmount: purchase.amount,
          price: purchase.price,
          totalPayment: purchase.totalPayment,
          timestamp: purchase.createdAt,
          transactionHash: purchase.txHash,
          type: 'PURCHASE',
        });

        totalTokensSold += BigInt(purchase.amount);
        totalUSDCRaised += BigInt(purchase.totalPayment);
      }
    } else if (asset.listing?.type === 'AUCTION') {
      // Get settled bids for AUCTION listings
      const settledBids = await this.bidModel
        .find({ assetId, status: 'SETTLED' })
        .sort({ createdAt: 1 }) // Sort by time ascending
        .exec();

      for (const bid of settledBids) {
        purchases.push({
          buyer: bid.bidder,
          tokenAmount: bid.tokenAmount,
          price: bid.price,
          totalPayment: bid.usdcDeposited,
          timestamp: bid.createdAt || new Date(),
          transactionHash: bid.transactionHash,
          type: 'BID',
        });

        totalTokensSold += BigInt(bid.tokenAmount);
        totalUSDCRaised += BigInt(bid.usdcDeposited);
      }
    }

    // Generate chart data with cumulative tokens
    const chartData: any[] = [];
    let cumulativeTokens = BigInt(0);

    for (const purchase of purchases) {
      cumulativeTokens += BigInt(purchase.tokenAmount);

      chartData.push({
        timestamp: purchase.timestamp,
        tokensPurchased: purchase.tokenAmount,
        cumulativeTokens: cumulativeTokens.toString(),
        price: purchase.price,
      });
    }

    // Calculate metadata
    const totalSupply = BigInt(asset.tokenParams.totalSupply);
    const percentageSold = totalSupply > BigInt(0)
      ? Number((totalTokensSold * BigInt(10000)) / totalSupply) / 100
      : 0;

    const averagePrice = purchases.length > 0
      ? totalUSDCRaised / BigInt(purchases.length)
      : BigInt(0);

    const firstPurchaseAt = purchases.length > 0 ? purchases[0].timestamp : undefined;
    const lastPurchaseAt = purchases.length > 0 ? purchases[purchases.length - 1].timestamp : undefined;

    return {
      assetId,
      assetType: asset.listing?.type || asset.assetType,
      purchases,
      chartData,
      totalTokensSold: totalTokensSold.toString(),
      totalUSDCRaised: totalUSDCRaised.toString(),
      totalTransactions: purchases.length,
      metadata: {
        totalSupply: asset.tokenParams.totalSupply,
        percentageSold,
        averagePrice: averagePrice.toString(),
        firstPurchaseAt,
        lastPurchaseAt,
      },
    };
  }
}
