import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { Payout, PayoutDocument } from '../../../database/schemas/payout.schema';
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
    @InjectModel(Payout.name) private payoutModel: Model<PayoutDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    @InjectQueue('auction-status-check') private auctionStatusQueue: Queue,
    private attestationService: AttestationService,
    @Inject(forwardRef(() => AnnouncementService))
    private announcementService: AnnouncementService,
    private configService: ConfigService,
    private notificationService: NotificationService,
  ) {}

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

    // Create AUCTION_SCHEDULED announcement immediately
    await this.announcementService.createAuctionScheduledAnnouncement(
      assetId,
      auctionStartTime,
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

  async endAuction(assetId: string, clearingPrice: string, transactionHash: string) {
    this.logger.log(`Ending auction for asset ${assetId} with clearing price ${clearingPrice}`);

    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.assetType !== 'AUCTION') {
      throw new Error('Asset is not an auction type');
    }

    if (!asset.listing || !asset.listing.active) {
      throw new Error('Auction is not active');
    }

    // Update asset with clearing price and mark as ended
    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.clearingPrice': clearingPrice,
          'listing.active': false,
          'listing.endedAt': new Date(),
          'listing.endTransactionHash': transactionHash,
        },
      },
    );

    this.logger.log(`Auction ${assetId} ended with clearing price ${clearingPrice}`);

    // Get all bids to calculate results
    const bids = await this.bidModel.find({ assetId }).exec();
    this.logger.log(`Found ${bids.length} bids for auction ${assetId}`);

    // Calculate tokens sold (bids >= clearing price)
    const clearingPriceBigInt = BigInt(clearingPrice);
    let tokensSold = BigInt(0);

    for (const bid of bids) {
      const bidPrice = BigInt(bid.price);
      if (bidPrice >= clearingPriceBigInt) {
        tokensSold += BigInt(bid.tokenAmount);
      }
    }

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

    // Calculate total USDC raised from settled bids
    const settledBids = await this.bidModel.find({
      assetId,
      status: { $in: ['SETTLED', 'REFUNDED'] },
    });

    // Sum up USDC received (only from winning bids - SETTLED status means they got tokens)
    let totalUsdcRaised = BigInt(0);
    for (const bid of settledBids) {
      if (bid.status === 'SETTLED') {
        totalUsdcRaised += BigInt(bid.usdcDeposited);
      }
    }

    if (totalUsdcRaised === BigInt(0)) {
      throw new Error('No USDC raised yet - no settled bids');
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
    const settledBidsOnly = settledBids.filter(b => b.status === 'SETTLED');
    const payoutRecord = new this.payoutModel({
      assetId,
      originator: asset.originator,
      amount: totalUsdcRaised.toString(),
      amountFormatted: `${Number(totalUsdcRaised) / 1e6} USDC`,
      settledBidIds: settledBidsOnly.map(bid => bid._id.toString()),
      settledBidsCount: settledBidsOnly.length,
      transactionHash: tx.hash,
      blockNumber: Number(receipt.blockNumber),
      paidAt: new Date(),
    });

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
        type: NotificationType.YIELD_DISTRIBUTED,
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
      this.logger.error(`Failed to send payout notification: ${error.message}`);
      // Don't throw - notification failure shouldn't fail the payout
    }

    return {
      success: true,
      assetId,
      originator: asset.originator,
      totalUsdcRaised: totalUsdcRaised.toString(),
      totalUsdcRaisedFormatted: `${Number(totalUsdcRaised) / 1e6} USDC`,
      settledBidsCount: settledBidsOnly.length,
      transactionHash: tx.hash,
      blockNumber: receipt.blockNumber.toString(),
      payoutId: payoutRecord._id.toString(),
      message: 'Payout executed successfully!',
    };
  }
}
