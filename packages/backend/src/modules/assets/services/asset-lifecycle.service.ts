import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { v4 as uuidv4 } from 'uuid';

import { RegisterAssetDto } from '../../blockchain/dto/register-asset.dto';
import { AttestationService } from '../../compliance-engine/services/attestation.service';
import { AnnouncementService } from '../../announcements/services/announcement.service';

@Injectable()
export class AssetLifecycleService {
  private readonly logger = new Logger(AssetLifecycleService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectQueue('asset-processing') private assetQueue: Queue,
    @InjectQueue('auction-status-check') private auctionStatusQueue: Queue,
    private attestationService: AttestationService,
    @Inject(forwardRef(() => AnnouncementService))
    private announcementService: AnnouncementService,
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
        // Use max price by default for static listings
        finalPricePerToken = maxPricePerToken.toString();
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
}
