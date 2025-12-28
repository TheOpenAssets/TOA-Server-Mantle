import { Controller, Get, Post, Param, UseGuards, Query, Body, Request } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PurchaseTrackerService } from '../services/purchase-tracker.service';
import { BidTrackerService } from '../services/bid-tracker.service';
import { NotifyPurchaseDto } from '../dto/notify-purchase.dto';
import { NotifyBidDto } from '../dto/notify-bid.dto';
import { NotifySettlementDto } from '../dto/notify-settlement.dto';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
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
}
