import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import {
  Announcement,
  AnnouncementDocument,
  AnnouncementType,
  AnnouncementStatus,
} from '../../../database/schemas/announcement.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@Injectable()
export class AnnouncementService {
  private readonly logger = new Logger(AnnouncementService.name);

  constructor(
    @InjectModel(Announcement.name)
    private announcementModel: Model<AnnouncementDocument>,
    @InjectModel(Asset.name)
    private assetModel: Model<AssetDocument>,
  ) {}

  async createAuctionScheduledAnnouncement(assetId: string, auctionStartTime: Date) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const auctionEndTime = new Date(
      auctionStartTime.getTime() + (asset.listing?.duration || 0) * 1000,
    );

    const announcement = new this.announcementModel({
      announcementId: uuidv4(),
      assetId,
      type: AnnouncementType.AUCTION_SCHEDULED,
      title: `Auction Scheduled: ${asset.metadata.invoiceNumber}`,
      message: `A new auction has been scheduled for invoice ${asset.metadata.invoiceNumber}. ` +
        `The auction will start at ${auctionStartTime.toISOString()} and run for ${asset.listing?.duration ? asset.listing.duration / 3600 : 0} hours. ` +
        `Face value: ${asset.metadata.faceValue} ${asset.metadata.currency}. ` +
        `Total supply: ${Number(asset.tokenParams.totalSupply) / 10**18} tokens. ` +
        `Bid range: $${Number(asset.listing?.priceRange?.min || 0) / 10**6} - $${Number(asset.listing?.priceRange?.max || 0) / 10**6} per token.`,
      status: AnnouncementStatus.ACTIVE,
      metadata: {
        invoiceNumber: asset.metadata.invoiceNumber,
        faceValue: asset.metadata.faceValue,
        totalSupply: asset.tokenParams.totalSupply,
        priceRange: asset.listing?.priceRange,
        auctionStartTime,
        auctionEndTime,
        duration: asset.listing?.duration,
        industry: asset.metadata.industry,
        riskTier: asset.metadata.riskTier,
      },
    });

    await announcement.save();
    this.logger.log(`Created AUCTION_SCHEDULED announcement for asset ${assetId}`);
    return announcement;
  }

  async createAuctionLiveAnnouncement(assetId: string) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const auctionEndTime = asset.listing?.listedAt
      ? new Date(asset.listing.listedAt.getTime() + (asset.listing.duration || 0) * 1000)
      : new Date();

    const announcement = new this.announcementModel({
      announcementId: uuidv4(),
      assetId,
      type: AnnouncementType.AUCTION_LIVE,
      title: `Auction Now Live: ${asset.metadata.invoiceNumber}`,
      message: `The auction for invoice ${asset.metadata.invoiceNumber} is now live! ` +
        `Place your bids before ${auctionEndTime.toISOString()}. ` +
        `Face value: ${asset.metadata.faceValue} ${asset.metadata.currency}. ` +
        `Total supply: ${Number(asset.tokenParams.totalSupply) / 10**18} tokens. ` +
        `Bid range: $${Number(asset.listing?.priceRange?.min || 0) / 10**6} - $${Number(asset.listing?.priceRange?.max || 0) / 10**6} per token.`,
      status: AnnouncementStatus.ACTIVE,
      metadata: {
        invoiceNumber: asset.metadata.invoiceNumber,
        faceValue: asset.metadata.faceValue,
        totalSupply: asset.tokenParams.totalSupply,
        priceRange: asset.listing?.priceRange,
        auctionStartTime: asset.listing?.listedAt,
        auctionEndTime,
        duration: asset.listing?.duration,
        industry: asset.metadata.industry,
        riskTier: asset.metadata.riskTier,
      },
    });

    await announcement.save();
    this.logger.log(`Created AUCTION_LIVE announcement for asset ${assetId}`);
    return announcement;
  }

  async createAuctionFailedAnnouncement(assetId: string, reason: string) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const announcement = new this.announcementModel({
      announcementId: uuidv4(),
      assetId,
      type: AnnouncementType.AUCTION_FAILED,
      title: `Auction Failed: ${asset.metadata.invoiceNumber}`,
      message: `The auction for invoice ${asset.metadata.invoiceNumber} has failed. Reason: ${reason}`,
      status: AnnouncementStatus.ACTIVE,
      metadata: {
        invoiceNumber: asset.metadata.invoiceNumber,
        faceValue: asset.metadata.faceValue,
        failureReason: reason,
        industry: asset.metadata.industry,
        riskTier: asset.metadata.riskTier,
      },
    });

    await announcement.save();
    this.logger.log(`Created AUCTION_FAILED announcement for asset ${assetId}: ${reason}`);
    return announcement;
  }

  async createAuctionEndedAnnouncement(
    assetId: string,
    clearingPrice: string,
    tokensSold: string,
    tokensRemaining: string,
  ) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const clearingPriceUSD = Number(clearingPrice) / 10**6; // Convert from USDC wei
    const tokensSoldFormatted = Number(tokensSold) / 10**18; // Convert from wei
    const tokensRemainingFormatted = Number(tokensRemaining) / 10**18;
    const totalSupply = Number(asset.tokenParams.totalSupply) / 10**18;

    let message = `The auction for invoice ${asset.metadata.invoiceNumber} has ended! `;

    if (tokensSoldFormatted > 0) {
      message += `Clearing price: $${clearingPriceUSD.toFixed(2)} per token. `;
      message += `Total tokens sold: ${tokensSoldFormatted.toLocaleString()} out of ${totalSupply.toLocaleString()}. `;

      if (tokensRemainingFormatted > 0) {
        message += `Remaining ${tokensRemainingFormatted.toLocaleString()} tokens are now available for purchase at $${clearingPriceUSD.toFixed(2)} per token.`;
      } else {
        message += `All tokens have been sold!`;
      }
    } else {
      message += `No tokens were sold. The auction did not meet the minimum requirements.`;
    }

    const announcement = new this.announcementModel({
      announcementId: uuidv4(),
      assetId,
      type: AnnouncementType.AUCTION_ENDED,
      title: `Auction Ended: ${asset.metadata.invoiceNumber}`,
      message,
      status: AnnouncementStatus.ACTIVE,
      metadata: {
        invoiceNumber: asset.metadata.invoiceNumber,
        faceValue: asset.metadata.faceValue,
        totalSupply: asset.tokenParams.totalSupply,
        tokensSold,
        tokensRemaining,
        clearingPrice,
        industry: asset.metadata.industry,
        riskTier: asset.metadata.riskTier,
      },
    });

    await announcement.save();
    this.logger.log(
      `Created AUCTION_ENDED announcement for asset ${assetId}: ${tokensSoldFormatted} tokens sold at $${clearingPriceUSD.toFixed(2)}`,
    );
    return announcement;
  }

  async createAuctionResultsDeclaredAnnouncement(
    assetId: string,
    clearingPrice: string,
    tokensSold: string,
    tokensRemaining: string,
  ) {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) {
      throw new Error('Asset not found');
    }

    const clearingPriceUSD = Number(clearingPrice) / 10**6; // Convert from USDC wei
    const tokensSoldFormatted = Number(tokensSold) / 10**18; // Convert from wei
    const tokensRemainingFormatted = Number(tokensRemaining) / 10**18;
    const totalSupply = Number(asset.tokenParams.totalSupply) / 10**18;

    let message = `Results declared for auction ${asset.metadata.invoiceNumber}! `;
    message += `Clearing price: $${clearingPriceUSD.toFixed(2)} per token. `;
    message += `Winning bids: ${tokensSoldFormatted.toLocaleString()} tokens out of ${totalSupply.toLocaleString()}. `;

    if (tokensRemainingFormatted > 0) {
      message += `Remaining ${tokensRemainingFormatted.toLocaleString()} tokens are now available for purchase at $${clearingPriceUSD.toFixed(2)} per token.`;
    } else {
      message += `All tokens have been allocated to winning bids!`;
    }

    const announcement = new this.announcementModel({
      announcementId: uuidv4(),
      assetId,
      type: AnnouncementType.AUCTION_RESULTS_DECLARED,
      title: `Auction Results: ${asset.metadata.invoiceNumber}`,
      message,
      status: AnnouncementStatus.ACTIVE,
      metadata: {
        invoiceNumber: asset.metadata.invoiceNumber,
        faceValue: asset.metadata.faceValue,
        totalSupply: asset.tokenParams.totalSupply,
        tokensSold,
        tokensRemaining,
        clearingPrice,
        industry: asset.metadata.industry,
        riskTier: asset.metadata.riskTier,
      },
    });

    await announcement.save();
    this.logger.log(
      `Created AUCTION_RESULTS_DECLARED announcement for asset ${assetId}: ${tokensSoldFormatted} tokens at $${clearingPriceUSD.toFixed(2)}`,
    );
    return announcement;
  }

  async getAllAnnouncements(filters?: {
    type?: AnnouncementType;
    status?: AnnouncementStatus;
    page?: number;
    limit?: number;
  }) {
    const query: any = {};

    if (filters?.type) {
      query.type = filters.type;
    }

    if (filters?.status) {
      query.status = filters.status;
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const [announcements, total] = await Promise.all([
      this.announcementModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.announcementModel.countDocuments(query),
    ]);

    return {
      announcements,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAnnouncementsByAsset(assetId: string) {
    return this.announcementModel.find({ assetId }).sort({ createdAt: -1 }).exec();
  }

  async archiveAnnouncement(announcementId: string) {
    return this.announcementModel.updateOne(
      { announcementId },
      { $set: { status: AnnouncementStatus.ARCHIVED } },
    );
  }
}
