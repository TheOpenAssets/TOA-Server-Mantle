import { Controller, Get, Param, UseGuards, Query } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('marketplace')
export class MarketplaceController {
  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
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
      listings: listings.map(asset => ({
        assetId: asset.assetId,
        tokenAddress: asset.token?.address,
        name: `${asset.metadata.invoiceNumber} - ${asset.metadata.buyerName}`,
        industry: asset.metadata.industry,
        faceValue: asset.metadata.faceValue,
        currency: asset.metadata.currency,
        riskTier: asset.metadata.riskTier,
        dueDate: asset.metadata.dueDate,
        totalSupply: asset.tokenParams.totalSupply,
        pricePerToken: asset.listing?.price || asset.tokenParams.pricePerToken,
        minInvestment: asset.tokenParams.minInvestment,
        listingType: asset.listing?.type,
        listedAt: asset.listing?.listedAt,
        status: asset.status,
      })),
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
}
