import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { AssetStatus } from '@openassets/types';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { ModuleRegistryService } from '../../registry/services/module-registry.service';
import { CreateAuctionDto } from '../dto/create-auction.dto';

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private moduleRegistry: ModuleRegistryService,
  ) {}

  async createAuction(dto: CreateAuctionDto) {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const strategy = this.moduleRegistry.getAdminDomainStrategy();
    
    // Delegate to strategy for listing. 
    // The strategy reads type and pricing from asset doc, but we pass duration from DTO.
    // NOTE: AuctionService.createAuction is redundant with admin strategy list endpoint,
    // but kept for backward compatibility.
    const result = await strategy.listOnMarketplace({
      assetId: dto.assetId,
      duration: dto.duration.toString(),
    });

    return {
      success: true,
      message: 'Auction created successfully',
      assetId: dto.assetId,
      transactionHash: result.transactionHash,
    };
  }

  async calculateAndEndAuction(assetId: string) {
    this.logger.log(`Starting clearing price calculation for auction ${assetId}`);
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.listing || !asset.token) {
      throw new HttpException('Auction not found or asset not tokenized', HttpStatus.NOT_FOUND);
    }

    const strategy = this.moduleRegistry.getAdminDomainStrategy();

    const bids = await this.bidModel.find({ assetId }).sort({ price: -1 });
    if (bids.length === 0) {
      this.logger.warn(`No bids found for auction ${assetId}. Ending without a sale.`);
      // End auction with a zero clearing price if no bids
      const result = await strategy.endAuctionOnChain(assetId, '0');
      return result;
    }
    
    let cumulativeAmount = BigInt(0);
    const totalSupply = BigInt(asset.token.supply); // CORRECT: supply is already in wei
    let clearingPrice = BigInt(0);

    for (const bid of bids) {
      cumulativeAmount += BigInt(bid.tokenAmount);
      if (cumulativeAmount >= totalSupply) {
        clearingPrice = BigInt(bid.price);
        break;
      }
    }

    const reservePrice = BigInt(asset.listing.reservePrice || '0');

    // Handle case where total demand is less than supply
    if (clearingPrice === BigInt(0) && cumulativeAmount < totalSupply) {
        // The clearing price is the price of the lowest bid if all bids are to be accepted.
        // Or if reserve price is the floor, clearing price becomes reserve price.
        // Let's stick to the user's logic where the price is the one where demand >= supply.
        // If not, it means no clearing price was found that satisfies the supply.
        this.logger.warn(`Total demand (${cumulativeAmount}) is less than total supply (${totalSupply}).`);
        clearingPrice = reservePrice; // Default to reserve if undersubscribed.
    }
    
    if (clearingPrice < reservePrice) {
        this.logger.error(`No valid clearing price found above reserve price ${reservePrice}. Auction failed.`);
        await this.assetModel.updateOne({ assetId }, { $set: { 'listing.phase': 'FAILED' } });
        // End the auction on-chain with a clearing price of 0 to signal failure
        const result = await strategy.endAuctionOnChain(assetId, '0');
        throw new HttpException('Auction failed: No bids met the reserve price.', HttpStatus.BAD_REQUEST);
    }


    this.logger.log(`Calculated clearing price for ${assetId}: ${clearingPrice.toString()}`);

    // Call strategy to end auction on-chain and in DB
    const result = await strategy.endAuctionOnChain(assetId, clearingPrice.toString());
    
    return {
      success: true,
      message: `Auction ended. Clearing price set to ${clearingPrice.toString()}`,
      assetId,
      clearingPrice: clearingPrice.toString(),
      transactionHash: result.transactionHash || result.txHash,
    };
  }
}
