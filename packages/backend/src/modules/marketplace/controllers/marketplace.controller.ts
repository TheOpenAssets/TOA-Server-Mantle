import { Controller, Get, Post, Param, UseGuards, Query, Body, Request } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { Settlement, SettlementDocument } from '../../../database/schemas/settlement.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PurchaseTrackerService } from '../services/purchase-tracker.service';
import { BidTrackerService } from '../services/bid-tracker.service';
import { NotifyPurchaseDto } from '../dto/notify-purchase.dto';
import { NotifyBidDto } from '../dto/notify-bid.dto';
import { NotifySettlementDto } from '../dto/notify-settlement.dto';
import { NotifyYieldClaimDto } from '../dto/notify-yield-claim.dto';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private purchaseTracker: PurchaseTrackerService,
    private bidTracker: BidTrackerService,
  ) {}

  @Get('listings')
  @UseGuards(JwtAuthGuard) // Investors must be authenticated
  async getListings(
    @Query('status') status?: string,
    @Query('industry') industry?: string,
  ) {
    const query: any = {
      status: { $in: [AssetStatus.LISTED, AssetStatus.TOKENIZED] },
      'listing.active': true,
      'token.address': { $exists: true }, // Must have token deployed
    };

    if (industry) {
      query['metadata.industry'] = industry;
    }

    const listings = await this.assetModel
      .find(query)
      .select({
        assetId: 1,
        metadata: 1,
        tokenParams: 1,
        token: 1,
        listing: 1,
        status: 1,
      })
      .sort({ 'listing.listedAt': -1 })
      .limit(100);

    return {
      success: true,
      count: listings.length,
      listings: listings.map(asset => {
        // Calculate percentage sold
        const totalSupply = BigInt(asset.tokenParams.totalSupply || '0');
        const sold = BigInt(asset.listing?.sold || '0');
        const percentageSold = totalSupply > 0n
          ? Number((sold * 10000n) / totalSupply) / 100 // Use 10000 for 2 decimal precision
          : 0;

        return {
          assetId: asset.assetId,
          tokenAddress: asset.token?.address,
          name: `${asset.metadata.invoiceNumber} - ${asset.metadata.buyerName}`,
          industry: asset.metadata.industry,
          faceValue: asset.metadata.faceValue,
          currency: asset.metadata.currency,
          riskTier: asset.metadata.riskTier,
          dueDate: asset.metadata.dueDate,
          totalSupply: asset.tokenParams.totalSupply,
          sold: asset.listing?.sold || '0',
          percentageSold,
          pricePerToken: asset.listing?.price || asset.tokenParams.pricePerToken,
          minInvestment: asset.tokenParams.minInvestment,
          listingType: asset.listing?.type,
          listedAt: asset.listing?.listedAt,
          status: asset.status,
        };
      }),
    };
  }

  @Get('listings/:assetId')
  @UseGuards(JwtAuthGuard)
  async getListingDetail(@Param('assetId') assetId: string) {
    const asset = await this.assetModel.findOne({ assetId });

    if (!asset) {
      return {
        success: false,
        error: 'Asset not found',
      };
    }

    if (!asset.token?.address) {
      return {
        success: false,
        error: 'Token not yet deployed for this asset',
      };
    }

    return {
      success: true,
      asset: {
        assetId: asset.assetId,
        status: asset.status,
        metadata: asset.metadata,
        tokenParams: asset.tokenParams,
        token: asset.token,
        listing: asset.listing,
        registry: asset.registry,
        cryptography: {
          documentHash: asset.cryptography?.documentHash,
          merkleRoot: asset.cryptography?.merkleRoot,
        },
        attestation: {
          hash: asset.attestation?.hash,
          attestor: asset.attestation?.attestor,
          timestamp: asset.attestation?.timestamp,
        },
      },
    };
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getMarketplaceStats() {
    const totalListed = await this.assetModel.countDocuments({
      'listing.active': true,
      'token.address': { $exists: true },
    });

    const byIndustry = await this.assetModel.aggregate([
      {
        $match: {
          'listing.active': true,
          'token.address': { $exists: true },
        },
      },
      {
        $group: {
          _id: '$metadata.industry',
          count: { $sum: 1 },
          totalValue: { $sum: { $toDouble: '$metadata.faceValue' } },
        },
      },
    ]);

    return {
      success: true,
      stats: {
        totalListings: totalListed,
        byIndustry,
      },
    };
  }

  @Get('info')
  @UseGuards(JwtAuthGuard)
  async getMarketplaceInfo() {
    // Include all assets that have been tokenized and listed (regardless of current lifecycle stage)
    // This includes: TOKENIZED, SCHEDULED, LISTED, PAYOUT_COMPLETE, YIELD_SETTLED, ENDED
    const includedStatuses = [
      AssetStatus.TOKENIZED,
      AssetStatus.SCHEDULED,
      AssetStatus.LISTED,
      AssetStatus.PAYOUT_COMPLETE,
      AssetStatus.YIELD_SETTLED,
      AssetStatus.ENDED,
    ];

    // 1. Total assets (all tokenized assets that have reached listing stage or beyond)
    const totalAssets = await this.assetModel.countDocuments({
      'token.address': { $exists: true },
      status: { $in: includedStatuses },
    });

    // 2. Active users (users who have made purchases or bids)
    const purchaseInvestors = await this.purchaseModel.distinct('investorWallet');
    const bidInvestors = await this.bidModel.distinct('investor');
    const uniqueInvestors = new Set([...purchaseInvestors, ...bidInvestors]);
    const activeUsers = uniqueInvestors.size;

    // 3. Total settlements
    const totalSettlements = await this.settlementModel.countDocuments();

    // 4. Total value tokenized (sum of face values of all tokenized assets)
    const tokenizedAssets = await this.assetModel.aggregate([
      {
        $match: {
          'token.address': { $exists: true },
          status: { $in: includedStatuses },
        },
      },
      {
        $group: {
          _id: null,
          totalValue: { $sum: { $toDouble: '$metadata.faceValue' } },
        },
      },
    ]);

    const totalValueTokenized = tokenizedAssets.length > 0 ? tokenizedAssets[0].totalValue : 0;

    return {
      success: true,
      info: {
        totalAssets,
        activeUsers,
        totalSettlements,
        totalValueTokenized,
      },
    };
  }

  @Get('top-grossing')
  @UseGuards(JwtAuthGuard)
  async getTopGrossingAssets(@Query('limit') limit?: string) {
    const limitNum = limit ? parseInt(limit) : 5; // Default to 5

    // Aggregate purchases by assetId
    const purchaseCounts = await this.purchaseModel.aggregate([
      {
        $match: {
          status: 'CONFIRMED', // Only count confirmed purchases
        },
      },
      {
        $group: {
          _id: '$assetId',
          purchaseCount: { $sum: 1 },
        },
      },
    ]);

    // Aggregate bids by assetId
    const bidCounts = await this.bidModel.aggregate([
      {
        $group: {
          _id: '$assetId',
          bidCount: { $sum: 1 },
        },
      },
    ]);

    // Create a map of assetId -> counts
    const activityMap = new Map<string, { purchaseCount: number; bidCount: number; totalActivity: number }>();

    purchaseCounts.forEach(item => {
      activityMap.set(item._id, {
        purchaseCount: item.purchaseCount,
        bidCount: 0,
        totalActivity: item.purchaseCount,
      });
    });

    bidCounts.forEach(item => {
      const existing = activityMap.get(item._id);
      if (existing) {
        existing.bidCount = item.bidCount;
        existing.totalActivity += item.bidCount;
      } else {
        activityMap.set(item._id, {
          purchaseCount: 0,
          bidCount: item.bidCount,
          totalActivity: item.bidCount,
        });
      }
    });

    // Sort by total activity and get top N
    const topAssetIds = Array.from(activityMap.entries())
      .sort((a, b) => b[1].totalActivity - a[1].totalActivity)
      .slice(0, limitNum)
      .map(([assetId, counts]) => ({ assetId, ...counts }));

    // Fetch asset details for top assets (only LISTED status)
    const assetIds = topAssetIds.map(item => item.assetId);
    const assets = await this.assetModel
      .find({
        assetId: { $in: assetIds },
        status: AssetStatus.LISTED,
      })
      .select({
        assetId: 1,
        metadata: 1,
        tokenParams: 1,
        token: 1,
        listing: 1,
        status: 1,
      });

    // Map assets with their activity counts
    const result = topAssetIds.map(activityItem => {
      const asset = assets.find(a => a.assetId === activityItem.assetId);
      if (!asset) return null;

      // Calculate percentage sold
      const totalSupply = BigInt(asset.tokenParams?.totalSupply || '0');
      const sold = BigInt(asset.listing?.sold || '0');
      const percentageSold = totalSupply > 0n
        ? Number((sold * 10000n) / totalSupply) / 100
        : 0;

      return {
        assetId: asset.assetId,
        tokenAddress: asset.token?.address,
        name: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
        industry: asset.metadata?.industry,
        faceValue: asset.metadata?.faceValue,
        currency: asset.metadata?.currency,
        riskTier: asset.metadata?.riskTier,
        dueDate: asset.metadata?.dueDate,
        totalSupply: asset.tokenParams?.totalSupply,
        sold: asset.listing?.sold || '0',
        percentageSold,
        pricePerToken: asset.listing?.price || asset.tokenParams?.pricePerToken,
        minInvestment: asset.tokenParams?.minInvestment,
        listingType: asset.listing?.type,
        listedAt: asset.listing?.listedAt,
        status: asset.status,
        activityMetrics: {
          purchaseCount: activityItem.purchaseCount,
          bidCount: activityItem.bidCount,
          totalActivity: activityItem.totalActivity,
        },
      };
    }).filter(item => item !== null);

    return {
      success: true,
      count: result.length,
      assets: result,
    };
  }

  @Post('purchases/notify')
  @UseGuards(JwtAuthGuard)
  async notifyPurchase(@Request() req: any, @Body() dto: NotifyPurchaseDto) {
    const investorWallet = req.user.walletAddress;
    return this.purchaseTracker.notifyPurchase(dto, investorWallet);
  }

  @Get('portfolio')
  @UseGuards(JwtAuthGuard)
  async getPortfolio(@Request() req: any) {
    const investorWallet = req.user.walletAddress;
    return this.purchaseTracker.getInvestorPortfolio(investorWallet);
  }

  @Get('purchases/history')
  @UseGuards(JwtAuthGuard)
  async getPurchaseHistory(@Request() req: any, @Query('limit') limit?: string) {
    const investorWallet = req.user.walletAddress;
    const limitNum = limit ? parseInt(limit) : 50;
    return this.purchaseTracker.getPurchaseHistory(investorWallet, limitNum);
  }

  @Post('bids/notify')
  @UseGuards(JwtAuthGuard)
  async notifyBid(@Request() req: any, @Body() dto: NotifyBidDto) {
    const investorWallet = req.user.walletAddress;
    return this.bidTracker.notifyBid(dto, investorWallet);
  }

  @Get('bids/my-bids')
  @UseGuards(JwtAuthGuard)
  async getMyBids(@Request() req: any, @Query('assetId') assetId?: string) {
    const investorWallet = req.user.walletAddress;
    return this.bidTracker.getInvestorBids(investorWallet, assetId);
  }

  @Get('auctions/:assetId/bids')
  @UseGuards(JwtAuthGuard)
  async getAuctionBids(@Param('assetId') assetId: string) {
    return this.bidTracker.getAuctionBids(assetId);
  }

  @Post('bids/settle-notify')
  @UseGuards(JwtAuthGuard)
  async notifySettlement(@Request() req: any, @Body() dto: NotifySettlementDto) {
    const investorWallet = req.user.walletAddress;
    return this.bidTracker.notifySettlement(dto, investorWallet);
  }

  @Post('yield-claim/notify')
  @UseGuards(JwtAuthGuard)
  async notifyYieldClaim(@Request() req: any, @Body() dto: NotifyYieldClaimDto) {
    const investorWallet = req.user.walletAddress;
    return this.purchaseTracker.notifyYieldClaim(dto, investorWallet);
  }
}
