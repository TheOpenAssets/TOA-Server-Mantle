import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { InjectConnection } from '@nestjs/mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Payout, PayoutDocument } from '../../../database/schemas/payout.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { LeveragePosition, LeveragePositionDocument } from '../../../database/schemas/leverage-position.schema';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { v4 as uuidv4 } from 'uuid';
import {
  AssetStatus,
  UserRole,
  NotificationType,
  NotificationSeverity,
  NotificationAction
} from '@openassets/types';

import { RegisterAssetDto } from '../../blockchain/dto/register-asset.dto';
import { AttestationService } from '../../compliance-engine/services/attestation.service';
import { AnnouncementService } from '../../announcements/services/announcement.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NetworkContextService } from '../../blockchain/services/network-context.service';
import { fromCanonical } from '../../blockchain/utils/numeric-conversion';
import { PAYMENT_ADAPTER, BLOCKCHAIN_ADAPTER } from '../../blockchain/blockchain.constants';
import { PaymentAdapter } from '../../blockchain/adapters/payment-adapter.interface';
import { BlockchainAdapter } from '../../blockchain/adapters/blockchain-adapter.interface';
import { NetworkRegistryService } from '../../blockchain/services/network-registry.service';

@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Payout.name) private payoutModel: Model<PayoutDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(LeveragePosition.name) private leveragePositionModel: Model<LeveragePositionDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    @InjectQueue('auction-status-check') private auctionStatusQueue: Queue,
    private attestationService: AttestationService,
    @Inject(forwardRef(() => AnnouncementService))
    private announcementService: AnnouncementService,
    private notificationService: NotificationService,
    private networkContextService: NetworkContextService,
    @Inject(PAYMENT_ADAPTER) private paymentAdapter: PaymentAdapter,
    @Inject(BLOCKCHAIN_ADAPTER) private blockchainAdapter: BlockchainAdapter,
    private networkRegistryService: NetworkRegistryService,
    @InjectConnection() connection: Connection,
  ) {
    this.leveragePositionModel = connection.model<LeveragePosition>(LeveragePosition.name);
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

  async getRegisterAssetPayload(assetId: string): Promise<RegisterAssetDto> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new Error('Asset not found');

    // Convert UUID to bytes32 (remove hyphens and pad to 32 bytes)
    const assetIdBytes32 = '0x' + asset.assetId.replace(/-/g, '').padEnd(64, '0');

    // Mocks for now - in real flow these come from Attestation/EigenDA steps
    return {
      assetId: assetIdBytes32,
      attestationHash: asset.attestation?.hash || '0x' + '0'.repeat(64),
      blobId: asset.attestation?.hash || '0x' + '0'.repeat(64),
      payload: asset.attestation?.payload || '0x',
      signature: asset.attestation?.signature || '0x' + '0'.repeat(130),
    };
  }

  async createAsset(userWallet: string, dto: CreateAssetDto, file: Express.Multer.File) {
    const assetId = uuidv4();
    this.logger.log(`Creating ${dto.assetType} asset ${assetId} for originator ${userWallet}`);

    // Get configured network type from context
    const network = this.networkContextService.getNetwork();

    // All DTO values are now in canonical 4-decimal format
    // Parse them as floats for calculations
    const faceValue = parseFloat(dto.faceValue);
    const totalSupply = parseFloat(dto.totalSupply);
    const minRaisePercentage = parseFloat(dto.minRaisePercentage);
    const maxRaisePercentage = parseFloat(dto.maxRaisePercentage || '95.0000'); // Default 95%

    // Calculate minimum and maximum raise amounts (in USDC, canonical format)
    const minRaiseUSD = (faceValue * minRaisePercentage) / 100;
    const maxRaiseUSD = (faceValue * maxRaisePercentage) / 100;

    // Format to canonical 4-decimal strings
    const minRaise = minRaiseUSD.toFixed(4);
    const maxRaise = maxRaiseUSD.toFixed(4);

    // Calculate min and max price per token
    // Price = raiseAmount / totalSupply (both in canonical format)
    const minPricePerToken = (minRaiseUSD / totalSupply).toFixed(4);
    const maxPricePerToken = (maxRaiseUSD / totalSupply).toFixed(4);

    // Calculate average price per token (midpoint between min and max)
    const avgPricePerToken = ((parseFloat(minPricePerToken) + parseFloat(maxPricePerToken)) / 2).toFixed(4);

    // For STATIC assets, validate custom price if provided
    let finalPricePerToken: string | undefined;
    if (dto.assetType === 'STATIC') {
      if (dto.pricePerToken) {
        const customPrice = parseFloat(dto.pricePerToken);
        const minPrice = parseFloat(minPricePerToken);
        const maxPrice = parseFloat(maxPricePerToken);

        // Validate that custom price is within calculated range
        if (customPrice < minPrice || customPrice > maxPrice) {
          throw new Error(
            `Price per token must be between ${minPricePerToken} and ${maxPricePerToken} USDC. ` +
            `Provided: ${dto.pricePerToken}. This ensures the raise amount is between ${minRaisePercentage}% and ${maxRaisePercentage}% of face value.`
          );
        }
        finalPricePerToken = dto.pricePerToken;
      } else {
        // Use average price by default for static listings (average of min and max raise)
        finalPricePerToken = avgPricePerToken;
      }
    }

    // Create Asset Record - all values already in canonical format
    const asset = new this.assetModel({
      assetId,
      originator: userWallet,
      status: AssetStatus.UPLOADED,
      assetType: dto.assetType,
      network,
      metadata: {
        invoiceNumber: dto.invoiceNumber,
        faceValue: dto.faceValue, // Already canonical
        currency: dto.currency,
        issueDate: new Date(dto.issueDate),
        dueDate: new Date(dto.dueDate),
        buyerName: dto.buyerName,
        industry: dto.industry,
        riskTier: dto.riskTier,
      },
      tokenParams: {
        totalSupply: dto.totalSupply, // Already canonical
        pricePerToken: finalPricePerToken, // Already canonical
        minInvestment: dto.minInvestment, // Already canonical
        minRaise: minRaise, // Calculated in canonical
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
        reservePrice: avgPricePerToken, // Already canonical
        priceRange: {
          min: minPricePerToken, // Already canonical
          max: maxPricePerToken, // Already canonical
        },
        duration: parseInt(dto.auctionDuration),
        sold: '0.0000', // Initialize as canonical
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
        min: minPricePerToken, // Canonical format
        max: maxPricePerToken, // Canonical format
        avg: avgPricePerToken, // Canonical format
        minRaise: minRaise, // Canonical format
        maxRaise: maxRaise, // Canonical format
      },
    };
  }

  async getAsset(assetId: string) {
    const network = this.networkContextService.getNetwork();
    return this.assetModel.findOne({ assetId, network });
  }

  async getAssetsByOriginator(originator: string) {
    const network = this.networkContextService.getNetwork();
    return this.assetModel.find({ originator, network });
  }

  async approveAsset(assetId: string, adminWallet: string) {
    this.logger.log(`Asset ${assetId} approved by admin ${adminWallet}`);

    const network = this.networkContextService.getNetwork();

    // Get the asset to generate attestation
    const asset = await this.assetModel.findOne({ assetId, network });
    if (!asset) {
      throw new Error('Asset not found');
    }

    // Generate attestation with ECDSA signature
    const attestation = await this.attestationService.generateAttestation(asset, adminWallet);

    // Update asset with attestation and set status to ATTESTED
    await this.assetModel.updateOne(
      { assetId, network },
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

    this.logger.log(`Asset ${assetId} attested and ready for on-chain registration`);

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

    if (asset.status !== AssetStatus.TOKENIZED) {
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
        network: this.networkContextService.getNetwork(),
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
        network: this.networkContextService.getNetwork(),
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
    const network = this.networkContextService.getNetwork();
    const asset = await this.assetModel.findOne({ assetId, network });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const bids = await this.bidModel.find({ assetId, network }).sort({ price: -1 }).exec();
    // tokenParams.totalSupply is canonical 4-decimal format — parse as float
    const totalSupply = parseFloat(asset.tokenParams.totalSupply);

    if (bids.length === 0) {
      return {
        suggestedPrice: asset.listing?.reservePrice || '0.0000',
        tokensAtPrice: '0.0000',
        percentageOfSupply: 0,
        totalBids: 0,
        allBids: [],
        priceBreakdown: [],
      };
    }

    // Get unique price points sorted descending
    // bid.price is canonical 4-decimal format — compare as floats
    const uniquePrices = [...new Set(bids.map(b => b.price))].sort((a, b) => {
      return parseFloat(b) - parseFloat(a);
    });

    // Calculate cumulative tokens at each price point using floats (canonical format)
    const priceBreakdown = uniquePrices.map(price => {
      const priceFloat = parseFloat(price);
      let cumulativeTokens = 0;
      const bidsAtThisPrice = [];

      for (const bid of bids) {
        if (parseFloat(bid.price) >= priceFloat) {
          cumulativeTokens += parseFloat(bid.tokenAmount);
          bidsAtThisPrice.push({
            bidder: bid.bidder,
            price: bid.price,
            tokenAmount: bid.tokenAmount,
            usdcDeposited: bid.usdcDeposited,
          });
        }
      }

      const percentage = totalSupply > 0 ? (cumulativeTokens / totalSupply) * 100 : 0;

      return {
        price,
        cumulativeTokens: cumulativeTokens.toFixed(4),
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

    let suggestedPrice = asset.listing?.reservePrice || '0.0000';
    let tokensAtPrice = '0.0000';
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

    // If no threshold met, calculate tokens at reserve price
    if (percentageOfSupply === 0 && bids.length > 0) {
      const reservePrice = parseFloat(asset.listing?.reservePrice || '0');
      let tokensAtReserve = 0;

      for (const bid of bids) {
        if (parseFloat(bid.price) >= reservePrice) {
          tokensAtReserve += parseFloat(bid.tokenAmount);
        }
      }

      tokensAtPrice = tokensAtReserve.toFixed(4);
      percentageOfSupply = totalSupply > 0 ? (tokensAtReserve / totalSupply) * 100 : 0;

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
    const network = this.networkContextService.getNetwork();

    const asset = await this.assetModel.findOne({ assetId, network });
    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.assetType !== 'AUCTION') {
      throw new Error('Asset is not an auction type');
    }

    // Determine the decimal precision based on network type.
    // Stellar uses 7 decimals; all other networks (Mantle, Arbitrum, CreditCoin) use 6 for USDC.
    // ASSUMPTION: any non-Stellar network uses Mantle's precision. If a future chain differs, extend this.
    const decimals = asset.network === 'stellar' ? 7 : 6;

    // Normalize clearing price: if it's a decimal string (canonical format), convert to integer
    // Otherwise, assume it's already in integer format (wei/stroops)
    let clearingPriceBigInt: bigint;
    if (clearingPrice.includes('.')) {
      // Decimal format (e.g., "0.8600") - convert to integer
      clearingPriceBigInt = BigInt(Math.round(parseFloat(clearingPrice) * Math.pow(10, decimals)));
      this.logger.log(`Converted decimal clearing price ${clearingPrice} to ${clearingPriceBigInt.toString()}`);
    } else {
      // Already integer format (e.g., "8600000")
      clearingPriceBigInt = BigInt(clearingPrice);
    }

    // Check if results are already declared (idempotent behavior)
    // Only check idempotency if clearing price is ALREADY SET
    // If listing.active = false but clearingPrice is undefined, we're in ENDED stage waiting for admin to declare results
    if (asset.listing?.clearingPrice) {
      // Clearing price already set - check if it matches (idempotent)
      // Compare as BigInt to handle both decimal and integer formats
      const existingClearingPrice = asset.listing.clearingPrice.includes('.')
        ? BigInt(Math.round(parseFloat(asset.listing.clearingPrice) * Math.pow(10, decimals)))
        : BigInt(asset.listing.clearingPrice);

      if (existingClearingPrice === clearingPriceBigInt) {
        this.logger.log(`Auction ${assetId} results already declared with clearing price ${clearingPriceBigInt.toString()} - skipping duplicate processing`);

        // Get all bids to calculate results for response
        const bids = await this.bidModel.find({ assetId, network }).exec();
        let tokensSold = BigInt(0);
        let wonCount = 0;
        let lostCount = 0;

        // Update bid statuses if not already done (idempotent)
        for (const bid of bids) {
          // Normalize bid price: if it's a decimal string (canonical format), convert to integer
          let bidPrice: bigint;
          if (bid.price.includes('.')) {
            // Decimal format (e.g., "0.8900") - convert to integer
            bidPrice = BigInt(Math.round(parseFloat(bid.price) * Math.pow(10, decimals)));
          } else {
            // Already integer format
            bidPrice = BigInt(bid.price);
          }

          // Normalize token amount: if it's a decimal string, convert to integer
          let tokenAmount: bigint;
          if (bid.tokenAmount.includes('.')) {
            // Token amounts use 7 decimals on Stellar, 18 on EVM
            const tokenDecimals = asset.network === 'stellar' ? 7 : 18;
            tokenAmount = BigInt(Math.round(parseFloat(bid.tokenAmount) * Math.pow(10, tokenDecimals)));
          } else {
            tokenAmount = BigInt(bid.tokenAmount);
          }

          if (bidPrice > clearingPriceBigInt) {
            tokensSold += tokenAmount;
            // Update to WON if not already
            if (bid.status === 'FINALIZED') {
              await this.bidModel.updateOne(
                { _id: bid._id },
                { $set: { status: 'WON' } },
              );
              wonCount++;
            }
          } else {
            // Update to LOST if not already (includes bids AT clearing price)
            if (bid.status === 'FINALIZED') {
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

        const tokenDecimals = asset.network === 'stellar' ? 7 : 18;
        const totalSupply = fromCanonical(asset.tokenParams.totalSupply, tokenDecimals);
        const tokensRemaining = totalSupply - tokensSold;

        return {
          success: true,
          assetId,
          clearingPrice: clearingPriceBigInt.toString(),
          tokensSold: tokensSold.toString(),
          tokensRemaining: tokensRemaining.toString(),
          totalBids: bids.length,
          transactionHash,
          message: 'Auction already ended (idempotent)',
        };
      } else {
        throw new Error(`Auction already ended with different clearing price: ${existingClearingPrice.toString()} (received: ${clearingPriceBigInt.toString()})`);
      }
    }

    // Store clearing price in canonical format
    const storedClearingPrice = clearingPrice.includes('.') ? clearingPrice : clearingPriceBigInt.toString();
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.clearingPrice': storedClearingPrice,
          'listing.active': false,
          'listing.phase': 'ENDED',
          'listing.endedAt': new Date(),
          'listing.endTransactionHash': transactionHash,
        },
      },
    );

    this.logger.log(`Auction ${assetId} ended with clearing price ${storedClearingPrice}`);

    // Get all bids to calculate results
    const bids = await this.bidModel.find({ assetId, network }).exec();
    this.logger.log(`Found ${bids.length} bids for auction ${assetId}`);

    // Calculate tokens sold and update bid statuses (bids > clearing price = WON, else LOST)
    let tokensSold = BigInt(0);
    let wonCount = 0;
    let lostCount = 0;

    for (const bid of bids) {
      // Normalize bid price: if it's a decimal string (canonical format), convert to integer
      let bidPrice: bigint;
      if (bid.price.includes('.')) {
        // Decimal format (e.g., "0.8900") - convert to integer
        bidPrice = BigInt(Math.round(parseFloat(bid.price) * Math.pow(10, decimals)));
        this.logger.debug(`Converted bid price ${bid.price} to ${bidPrice.toString()}`);
      } else {
        // Already integer format
        bidPrice = BigInt(bid.price);
      }

      // Normalize token amount: if it's a decimal string, convert to integer
      let tokenAmount: bigint;
      if (bid.tokenAmount.includes('.')) {
        // Token amounts use 7 decimals on Stellar, 18 on EVM
        const tokenDecimals = asset.network === 'stellar' ? 7 : 18;
        tokenAmount = BigInt(Math.round(parseFloat(bid.tokenAmount) * Math.pow(10, tokenDecimals)));
        this.logger.debug(`Converted token amount ${bid.tokenAmount} to ${tokenAmount.toString()}`);
      } else {
        tokenAmount = BigInt(bid.tokenAmount);
      }

      if (bidPrice > clearingPriceBigInt) {
        tokensSold += tokenAmount;
        // Update bid status to WON (only bids > clearing price win)
        await this.bidModel.updateOne(
          { _id: bid._id },
          { $set: { status: 'WON' } },
        );
        wonCount++;
      } else {
        // Update bid status to LOST (includes bids AT clearing price)
        await this.bidModel.updateOne(
          { _id: bid._id },
          { $set: { status: 'LOST' } },
        );
        lostCount++;
      }
    }

    this.logger.log(`Bid statuses updated: ${wonCount} WON, ${lostCount} LOST`);

    // Calculate remaining tokens — totalSupply is canonical, convert to match tokensSold units
    const tokenDecimals = asset.network === 'stellar' ? 7 : 18;
    const totalSupply = fromCanonical(asset.tokenParams.totalSupply, tokenDecimals);
    const tokensRemaining = totalSupply - tokensSold;

    this.logger.log(
      `Auction results: Clearing price: ${clearingPriceBigInt.toString()}, Sold: ${tokensSold.toString()}, Remaining: ${tokensRemaining.toString()}`,
    );

    // Update asset status to AUCTION_DECLARED (results declared by admin)
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: 'AUCTION_DECLARED', // Results declared by admin
        },
      },
    );

    // Create AUCTION_RESULTS_DECLARED announcement
    await this.announcementService.createAuctionResultsDeclaredAnnouncement(
      assetId,
      clearingPriceBigInt.toString(),
      tokensSold.toString(),
      tokensRemaining.toString(),
    );

    // Notify all bidders that auction has ended with the clearing price
    try {
      const uniqueBidders = [...new Set(bids.map(b => b.bidder))];
      this.logger.log(`Notifying ${uniqueBidders.length} bidders that auction has ended`);

      for (const bidderAddress of uniqueBidders) {
        try {
          // clearing price is canonical — display directly
          const clearingPriceDisplay = parseFloat(clearingPrice).toFixed(2);
          await this.notificationService.create({
            userId: bidderAddress,
            walletAddress: bidderAddress,
            header: 'Auction Results Declared',
            detail: `Auction results for asset ${asset.metadata.invoiceNumber} have been declared with a clearing price of $${clearingPriceDisplay}. Please settle your bid to claim tokens or receive refund.`,
            type: NotificationType.ASSET_STATUS,
            severity: NotificationSeverity.SUCCESS,
            action: NotificationAction.VIEW_PORTFOLIO,
            actionMetadata: {
              assetId,
              clearingPrice: storedClearingPrice,
              clearingPriceUSDC: clearingPriceDisplay,
              resultsDeclared: true,
              needsSettlement: true,
            },
          });
        } catch (error: any) {
          this.logger.error(`Failed to notify bidder ${bidderAddress}: ${error.message}`);
        }
      }

      this.logger.log(`Sent auction end notifications to ${uniqueBidders.length} bidders`);
    } catch (error: any) {
      this.logger.error(`Failed to send bidder notifications: ${error.message}`);
    }

    // If there are remaining tokens, update listing to allow sales at clearing price
    // clearingPrice is already canonical (passed in as canonical or converted above)
    const clearingPriceCanonical = clearingPrice.includes('.') ? clearingPrice : clearingPriceBigInt.toString();
    if (tokensRemaining > BigInt(0)) {
      await this.assetModel.updateOne(
        { assetId },
        {
          $set: {
            'listing.staticPrice': clearingPriceCanonical,
            'listing.price': clearingPriceCanonical,
            'listing.type': 'STATIC',
            'listing.active': true,
            'listing.phase': 'CONFIRMED',
            'listing.tokensSold': tokensSold.toString(),
            'listing.status': 'LISTED',
          },
        },
      );

      this.logger.log(
        `Remaining tokens (${tokensRemaining.toString()}) now available for purchase at clearing price $${parseFloat(clearingPrice).toFixed(2)}. Listing re-activated as STATIC.`,
      );
    }

    return {
      success: true,
      assetId,
      clearingPrice: clearingPriceCanonical,
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
    const query: any = { network: this.networkContextService.getNetwork() };

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
   * Helper method to burn tokens with retry logic and exponential backoff
   */
  private async burnTokensWithRetry(
    tokenAddress: string,
    assetId: string,
    maxRetries: number = 3
  ): Promise<import('../../blockchain/adapters/blockchain-adapter.interface').TokenBurnResult | null> {
    const delays = [5000, 10000, 20000]; // 5s, 10s, 20s exponential backoff

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(`🔄 Burn attempt ${attempt}/${maxRetries} for asset ${assetId}`);

        const result = await this.networkRegistryService.burnUnsoldTokens(tokenAddress, assetId);

        this.logger.log(`✅ Burn successful on attempt ${attempt}`);
        return result;
      } catch (error: any) {
        this.logger.error(`❌ Burn attempt ${attempt}/${maxRetries} failed: ${error.message}`);

        if (attempt < maxRetries) {
          const delay = delays[attempt - 1];
          this.logger.log(`⏳ Waiting ${(delay || 500) / 1000}s before retry ${attempt + 1}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          this.logger.error(`❌ All ${maxRetries} burn attempts failed`);
          return null;
        }
      }
    }

    return null;
  }

  /**
   * Calculate and payout USDC to originator
   * Simple: Sum USDC from settled bids, verify balance, transfer to originator
   */
  async payoutOriginator(assetId: string) {
    this.logger.log(`Processing originator payout for asset: ${assetId}`);
    const network = this.networkContextService.getNetwork();

    const asset = await this.assetModel.findOne({ assetId, network });
    if (!asset) {
      throw new Error('Asset not found');
    }

    let totalUsdcRaised = BigInt(0);
    let confirmedPurchases: any[] = [];
    let leveragePositions: any[] = [];

    // Both STATIC and AUCTION use Purchase records. Auction settlements use source='PRIMARY_MARKET'
    // (set by bid-tracker), but 'AUCTION' is also a valid source value — include both.
    this.logger.log(`${asset.listing?.type} listing detected - calculating from purchases + leverage positions`);

    // 1. Get confirmed primary-sale purchases (excludes P2P/secondary trades)
    confirmedPurchases = await this.purchaseModel.find({
      assetId,
      status: 'CONFIRMED',
      source: { $in: ['PRIMARY_MARKET', 'AUCTION'] },
      network,
    });

    // Determine stablecoin decimals based on network
    const stablecoinDecimals = network === 'stellar' ? 7 : 6;

    for (const purchase of confirmedPurchases) {
      // Handle both old (wei) and new (canonical) format purchases
      const totalPayment = purchase.totalPayment.includes('.')
        ? fromCanonical(purchase.totalPayment, stablecoinDecimals)  // Canonical → chain-native
        : BigInt(purchase.totalPayment);  // Old wei format (already chain-native)
      totalUsdcRaised += totalPayment;
    }

    this.logger.log(`Found ${confirmedPurchases.length} confirmed PRIMARY_MARKET/AUCTION purchases`);

    // ========================================================================
    // AUCTION FALLBACK: if notify-settlement was never called (or verifyBidSettlement
    // failed), no purchase records exist. Compute the raised amount directly from
    // WON bids × clearing price so the originator can still be paid out.
    // ========================================================================
    if (totalUsdcRaised === BigInt(0) && asset.listing?.type === 'AUCTION') {
      const clearingPriceStr = asset.listing?.clearingPrice;
      if (clearingPriceStr) {
        const wonBids = await this.bidModel.find({
          assetId,
          status: { $in: ['WON', 'SETTLED', 'FINALIZED'] },
          network,
        });

        if (wonBids.length > 0) {
          this.logger.log(`Auction fallback: ${wonBids.length} WON bid(s) found, computing from clearing price ${clearingPriceStr}`);
          const tokenDecimals = asset.network === 'stellar' ? 7 : 18;

          let clearingPriceBigInt: bigint;
          if (clearingPriceStr.includes('.')) {
            clearingPriceBigInt = fromCanonical(clearingPriceStr, stablecoinDecimals);
          } else {
            clearingPriceBigInt = BigInt(clearingPriceStr);
          }

          for (const bid of wonBids) {
            let tokenAmountBigInt: bigint;
            if (bid.tokenAmount.includes('.')) {
              tokenAmountBigInt = fromCanonical(bid.tokenAmount, tokenDecimals);
            } else {
              tokenAmountBigInt = BigInt(bid.tokenAmount);
            }
            // actual_cost = (clearing_price_raw × token_amount_raw) / token_scale
            const costRaw = (clearingPriceBigInt * tokenAmountBigInt) / (10n ** BigInt(tokenDecimals));
            totalUsdcRaised += costRaw;
            this.logger.log(`   Bid ${bid.bidder}: ${bid.tokenAmount} tokens × clearing price → costRaw=${costRaw.toString()}`);
          }

          this.logger.log(`Auction fallback total: ${totalUsdcRaised.toString()} (${Number(totalUsdcRaised) / 10 ** stablecoinDecimals} USDC)`);
        } else {
          this.logger.log(`Auction fallback: no WON bids found for asset ${assetId}`);
        }
      } else {
        this.logger.log(`Auction fallback skipped: clearing price not set for asset ${assetId}`);
      }
    }

    // ========================================================================
    // CHECK FOR LEVERAGE POSITIONS
    // ========================================================================
    this.logger.log(`\n🔍 Checking for leverage positions holding this asset...`);

    if (asset.token?.address) {
      const tokenAddressLower = asset.token.address.toLowerCase();
      this.logger.log(`   Asset token address: ${asset.token.address}`);
      this.logger.log(`   Searching for positions with assetId: ${assetId}`);
      this.logger.log(`   Searching for positions with rwaTokenAddress: ${tokenAddressLower}`);

      // Use case-insensitive regex for token address matching
      leveragePositions = await this.leveragePositionModel.find({
        assetId,
        rwaTokenAddress: { $regex: new RegExp(`^${tokenAddressLower}$`, 'i') },
        status: { $in: ['ACTIVE', 'LIQUIDATED'] }, // Include both active and liquidated positions
        network,
      });

      this.logger.log(`   Query returned ${leveragePositions.length} positions`);

      if (leveragePositions.length > 0) {
        this.logger.log(`📊 Found ${leveragePositions.length} leverage position(s)`);

        for (const position of leveragePositions) {
          // LeveragePosition schema now stores canonical format - convert to chain-native decimals
          const usdcBorrowed = fromCanonical(position.usdcBorrowed, stablecoinDecimals);
          totalUsdcRaised += usdcBorrowed;
          this.logger.log(
            `   Position ${position.positionId}: ${position.usdcBorrowed} USDC borrowed (${position.status})`
          );
        }
      } else {
        this.logger.log(`✅ No leverage positions found for this asset`);

        // Debug: Check if any positions exist for this assetId at all
        const anyPositions = await this.leveragePositionModel.find({ assetId });
        this.logger.log(`   Debug: Total positions with assetId ${assetId}: ${anyPositions.length}`);
        if (anyPositions.length > 0) {
          anyPositions.forEach(pos => {
            this.logger.log(`      - Position ${pos.positionId}: status=${pos.status}, rwaTokenAddress=${pos.rwaTokenAddress}`);
          });
        }
      }
    } else {
      this.logger.log(`   ⚠️ Asset has no token address`);
    }

    if (totalUsdcRaised === BigInt(0)) {
      throw new Error('No USDC raised yet - no confirmed purchases or leverage positions');
    }

    this.logger.log(`Total USDC to payout: ${totalUsdcRaised.toString()} (${Number(totalUsdcRaised) / 10 ** stablecoinDecimals} USDC)`);
    this.logger.log(`  - PRIMARY_MARKET purchases: ${confirmedPurchases.length}`);
    this.logger.log(`  - Leverage positions: ${leveragePositions.length}`);

    // Execute transfer using network registry (which uses appropriate adapter)
    this.logger.log(`\n💸 ========== EXECUTING PAYOUT TRANSFER ==========`);
    const transferResult = await this.networkRegistryService.payoutToRecipient(
      asset.originator,
      totalUsdcRaised.toString(),
    );
    this.logger.log(`========================================\n`);

    // Create payout record in MongoDB
    const payoutData: any = {
      assetId,
      originator: asset.originator,
      amount: totalUsdcRaised.toString(),
      amountFormatted: `${(Number(totalUsdcRaised) / 10 ** stablecoinDecimals).toFixed(2)} USDC`,
      transactionHash: transferResult.txId,
      blockNumber: 0, // Block number not returned by transferUSDC currently
      paidAt: new Date(),
      purchaseIds: confirmedPurchases.map(p => p._id.toString()),
      purchasesCount: confirmedPurchases.length,
      leveragePositionIds: leveragePositions.map(p => p._id.toString()),
      leveragePositionsCount: leveragePositions.length,
    };

    const payoutRecord = new this.payoutModel(payoutData);
    await payoutRecord.save();
    this.logger.log(`Payout record saved to MongoDB with ID: ${payoutRecord._id}`);

    // Burn unsold tokens before completing payout
    this.logger.log(`\n🔥 ========== BURNING UNSOLD TOKENS ==========`);
    let burnResult: import('../../blockchain/adapters/blockchain-adapter.interface').TokenBurnResult | null = null;

    if (asset.token?.address) {
      try {
        // Use adapter with retry logic
        burnResult = await this.burnTokensWithRetry(asset.token.address, assetId);

        if (burnResult && burnResult.tokensBurned !== '0') {
          this.logger.log(`✅ Burned ${burnResult.tokensBurnedFormatted}`);
          this.logger.log(`   Old supply: ${burnResult.oldTotalSupplyFormatted}`);
          this.logger.log(`   New supply: ${burnResult.newTotalSupplyFormatted}`);
          this.logger.log(`   Burn tx: ${burnResult.txId}`);

          // Update asset's token supply in database
          await this.assetModel.updateOne(
            { assetId },
            {
              $set: {
                'token.supply': burnResult.newTotalSupply,
                'token.unsoldTokensBurned': burnResult.tokensBurned,
                'token.burnTransactionHash': burnResult.txId,
              }
            }
          );

          // Notify originator about burned tokens
          await this.notificationService.create({
            userId: asset.originator,
            walletAddress: asset.originator,
            header: 'Unsold Tokens Burned',
            detail: `${burnResult.tokensBurnedFormatted} from ${asset.metadata.invoiceNumber} were burned during payout. Total supply reduced from ${burnResult.oldTotalSupplyFormatted} to ${burnResult.newTotalSupplyFormatted}. Your payout is based on sold tokens only.`,
            type: NotificationType.ASSET_STATUS,
            severity: NotificationSeverity.INFO,
            action: NotificationAction.VIEW_ASSET,
            actionMetadata: { assetId, burnTxHash: burnResult.txId },
          });

          // Notify admins about token burn
          await this.notifyAllAdmins(
            'Tokens Burned During Payout',
            `${burnResult.tokensBurnedFormatted} from asset ${asset.metadata.invoiceNumber} (${asset.assetId.slice(0, 8)}...) were burned. Supply: ${burnResult.oldTotalSupplyFormatted} → ${burnResult.newTotalSupplyFormatted}. Tx: ${burnResult.txId}`,
            NotificationType.ASSET_STATUS,
            NotificationSeverity.INFO,
            NotificationAction.VIEW_ASSET,
            { assetId, burnTxHash: burnResult.txId, tokensBurned: burnResult.tokensBurnedFormatted }
          );
        } else if (burnResult === null) {
          this.logger.log(`✅ No unsold tokens to burn - all tokens were sold`);

          // Notify originator that all tokens were sold
          await this.notificationService.create({
            userId: asset.originator,
            walletAddress: asset.originator,
            header: 'All Tokens Sold!',
            detail: `Congratulations! All tokens from ${asset.metadata.invoiceNumber} were sold. No tokens were burned.`,
            type: NotificationType.ASSET_STATUS,
            severity: NotificationSeverity.SUCCESS,
            action: NotificationAction.VIEW_ASSET,
            actionMetadata: { assetId },
          });
        } else {
          // All retries failed - manually update token supply
          this.logger.warn(`⚠️ Burn failed after 3 retries - manually updating token supply`);

          // Calculate tokens that would have been burned
          const totalSupply = BigInt(asset.tokenParams.totalSupply);
          let tokensSold = BigInt(0);

          if (asset.listing?.type === 'STATIC') {
            for (const purchase of confirmedPurchases) {
              tokensSold += BigInt(purchase.amount);
            }
          } else if (asset.listing?.type === 'AUCTION') {
            for (const purchase of confirmedPurchases) {
              tokensSold += BigInt(purchase.amount);
            }
          }

          const tokensToBurn = totalSupply - tokensSold;
          const newSupply = totalSupply - tokensToBurn;

          this.logger.log(`   Calculated tokens to burn: ${Number(tokensToBurn) / 1e18}`);
          this.logger.log(`   Old supply: ${Number(totalSupply) / 1e18} tokens`);
          this.logger.log(`   New supply: ${Number(newSupply) / 1e18} tokens`);

          // Update database with calculated supply
          await this.assetModel.updateOne(
            { assetId },
            {
              $set: {
                'token.supply': newSupply.toString(),
                'token.unsoldTokensBurned': tokensToBurn.toString(),
                'token.burnTransactionHash': 'MANUAL_UPDATE_AFTER_RETRY_FAILURE',
              }
            }
          );

          this.logger.log(`✅ Token supply manually updated in database`);

          const tokensBurnedFormatted = (Number(tokensToBurn) / 1e18).toFixed(2);
          const oldSupplyFormatted = (Number(totalSupply) / 1e18).toFixed(2);
          const newSupplyFormatted = (Number(newSupply) / 1e18).toFixed(2);

          // Notify admins about manual update
          await this.notifyAllAdmins(
            'Token Supply Manually Updated',
            `Burn transaction failed after 3 retries for asset ${asset.metadata.invoiceNumber}. Token supply manually updated from ${oldSupplyFormatted} to ${newSupplyFormatted} tokens (${tokensBurnedFormatted} tokens marked as burned).`,
            NotificationType.ASSET_STATUS,
            NotificationSeverity.WARNING,
            NotificationAction.VIEW_ASSET,
            { assetId, tokensBurned: tokensBurnedFormatted, manualUpdate: true }
          );
        }
      } catch (error: any) {
        this.logger.error(`Failed during burn process: ${error.message}`);
        throw error; // Re-throw to prevent payout from continuing
      }
    } else {
      this.logger.warn(`No token address found for asset ${assetId} - skipping burn`);
    }

    this.logger.log(`========================================\n`);

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
      this.logger.warn(`Asset ${assetId} status update to PAYOUT_COMPLETE already applied`);
    } else {
      this.logger.log(`Asset ${assetId} status updated to PAYOUT_COMPLETE`);
    }

    // Send notification to originator about payout
    try {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Payout Complete',
        detail: `Your payout of ${(Number(totalUsdcRaised) / 10 ** stablecoinDecimals).toFixed(2)} USDC for asset ${asset.metadata.invoiceNumber} has been successfully transferred to your wallet.`,
        type: NotificationType.PAYOUT_SETTLED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId,
          amount: totalUsdcRaised.toString(),
          transactionHash: transferResult.txId,
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
      totalUsdcRaisedFormatted: `${(Number(totalUsdcRaised) / 10 ** stablecoinDecimals).toFixed(2)} USDC`,
      listingType: asset.listing?.type,
      transactionCount: confirmedPurchases.length + leveragePositions.length,
      transactionHash: transferResult.txId,
      blockNumber: '0',
      payoutId: payoutRecord._id.toString(),
      message: 'Payout executed successfully!',
    };
  }

  /**
   * Get purchase history for an asset (for buy history graph)
   * Includes both regular purchases and leveraged position purchases
   */
  async getPurchaseHistory(assetId: string) {
    const network = this.networkContextService.getNetwork();
    const asset = await this.assetModel.findOne({ assetId, network });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const purchases: any[] = [];
    let totalTokensSold = 0; // canonical float (tokens)
    let totalUSDCRaised = 0; // canonical float (USDC)

    if (asset.listing?.type === 'STATIC') {
      // Get confirmed purchases for STATIC listings
      const confirmedPurchases = await this.purchaseModel
        .find({ assetId, status: { $in: ['CONFIRMED', 'CLAIMED'] }, network })
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
          purchaseMethod: 'DIRECT',
        });

        totalTokensSold += parseFloat(purchase.amount);
        totalUSDCRaised += parseFloat(purchase.totalPayment);
      }
    } else if (asset.listing?.type === 'AUCTION') {
      const settlementPurchases = await this.purchaseModel
        .find({ assetId, status: { $in: ['CONFIRMED', 'CLAIMED'] }, network })
        .sort({ createdAt: 1 })
        .exec();

      for (const purchase of settlementPurchases) {
        purchases.push({
          buyer: purchase.investorWallet,
          tokenAmount: purchase.amount,
          price: purchase.price,
          totalPayment: purchase.totalPayment,
          timestamp: purchase.createdAt,
          transactionHash: purchase.txHash,
          type: 'PURCHASE',
          purchaseMethod: 'DIRECT',
        });

        totalTokensSold += parseFloat(purchase.amount);
        totalUSDCRaised += parseFloat(purchase.totalPayment);
      }
    }

    // Get leveraged position purchases for this asset
    try {
      const leveragePositions = await this.leveragePositionModel
        .find({ assetId, status: { $in: ['ACTIVE', 'SETTLED', 'LIQUIDATED', 'CLOSED'] }, network })
        .sort({ createdAt: 1 })
        .exec();

      for (const position of leveragePositions) {
        // Calculate effective price: totalPayment / tokenAmount
        // Total payment for leverage = mETH collateral value + USDC borrowed
        // For simplicity, we'll use USDC borrowed as the payment amount
        // LeveragePosition schema stores canonical format - use float arithmetic
        const usdcBorrowedFloat = parseFloat(position.usdcBorrowed);
        const rwaTokenAmountFloat = parseFloat(position.rwaTokenAmount);

        // Calculate price per token: usdcBorrowed / rwaTokenAmount (USDC per token, canonical)
        const pricePerToken = rwaTokenAmountFloat > 0
          ? (usdcBorrowedFloat / rwaTokenAmountFloat).toFixed(4)
          : '0.0000';

        purchases.push({
          buyer: position.userAddress,
          tokenAmount: position.rwaTokenAmount,
          price: pricePerToken,
          totalPayment: position.usdcBorrowed,
          timestamp: position.createdAt,
          transactionHash: position.settlementTxHash || `position-${position.positionId}`,
          type: 'PURCHASE',
          purchaseMethod: 'LEVERAGE',
          positionId: position.positionId,
          mETHCollateral: position.mETHCollateral,
          positionStatus: position.status,
        });

        totalTokensSold += rwaTokenAmountFloat;
        totalUSDCRaised += usdcBorrowedFloat;
      }

      this.logger.log(`Found ${leveragePositions.length} leverage positions for asset ${assetId}`);
    } catch (error: any) {
      this.logger.error(`Error fetching leverage positions for purchase history: ${error.message}`);
      // Continue without leverage positions if there's an error
    }

    // Sort all purchases by timestamp (ascending)
    purchases.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // Generate chart data with cumulative tokens
    const chartData: any[] = [];
    let cumulativeTokens = 0;

    for (const purchase of purchases) {
      cumulativeTokens += parseFloat(purchase.tokenAmount);

      chartData.push({
        timestamp: purchase.timestamp,
        tokensPurchased: purchase.tokenAmount,
        cumulativeTokens: cumulativeTokens.toFixed(4),
        price: purchase.price,
        purchaseMethod: purchase.purchaseMethod,
      });
    }

    // Calculate metadata
    const totalSupplyFloat = parseFloat(asset.tokenParams.totalSupply);
    const percentageSold = totalSupplyFloat > 0
      ? (totalTokensSold / totalSupplyFloat) * 100
      : 0;

    const averagePrice = purchases.length > 0
      ? (totalUSDCRaised / purchases.length).toFixed(4)
      : '0.0000';

    const firstPurchaseAt = purchases.length > 0 ? purchases[0].timestamp : undefined;
    const lastPurchaseAt = purchases.length > 0 ? purchases[purchases.length - 1].timestamp : undefined;

    // Count direct vs leverage purchases
    const directPurchases = purchases.filter(p => p.purchaseMethod === 'DIRECT').length;
    const leveragePurchases = purchases.filter(p => p.purchaseMethod === 'LEVERAGE').length;

    return {
      assetId,
      assetType: asset.listing?.type || asset.assetType,
      purchases,
      chartData,
      totalTokensSold: totalTokensSold.toFixed(4),
      totalUSDCRaised: totalUSDCRaised.toFixed(4),
      totalTransactions: purchases.length,
      metadata: {
        totalSupply: asset.tokenParams.totalSupply,
        percentageSold,
        averagePrice,
        firstPurchaseAt,
        lastPurchaseAt,
        directPurchases,
        leveragePurchases,
      },
    };
  }
}
