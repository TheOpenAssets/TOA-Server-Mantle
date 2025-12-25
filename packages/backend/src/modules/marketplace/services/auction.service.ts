import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { CreateAuctionDto } from '../dto/create-auction.dto';

@Injectable()
export class AuctionService {
  private readonly logger = new Logger(AuctionService.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    private blockchainService: BlockchainService,
  ) {}

  async createAuction(dto: CreateAuctionDto) {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const txHash = await this.blockchainService.listOnMarketplace(
      asset.token.address,
      'AUCTION',
      dto.reservePrice,
      asset.tokenParams.minInvestment,
      dto.duration,
    );

    // Update asset status in DB
    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          'listing.type': 'AUCTION',
          'listing.reservePrice': dto.reservePrice,
          'listing.active': true,
          'listing.listedAt': new Date(),
          'listing.duration': dto.duration,
          'listing.phase': 'BIDDING',
        },
      },
    );

    return {
      success: true,
      message: 'Auction created successfully',
      assetId: dto.assetId,
      transactionHash: txHash,
    };
  }

  async calculateAndEndAuction(assetId: string) {
    this.logger.log(`Starting clearing price calculation for auction ${assetId}`);
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.listing || !asset.token) {
      throw new HttpException('Auction not found or asset not tokenized', HttpStatus.NOT_FOUND);
    }

    const bids = await this.bidModel.find({ assetId }).sort({ price: -1 });
    if (bids.length === 0) {
      this.logger.warn(`No bids found for auction ${assetId}. Ending without a sale.`);
      // End auction with a zero clearing price if no bids
      return this.blockchainService.endAuction(assetId, '0');
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
        await this.blockchainService.endAuction(assetId, '0');
        throw new HttpException('Auction failed: No bids met the reserve price.', HttpStatus.BAD_REQUEST);
    }


    this.logger.log(`Calculated clearing price for ${assetId}: ${clearingPrice.toString()}`);

    // Call blockchain service to end auction
    const txHash = await this.blockchainService.endAuction(assetId, clearingPrice.toString());
    
    return {
      success: true,
      message: `Auction ended. Clearing price set to ${clearingPrice.toString()}`,
      assetId,
      clearingPrice: clearingPrice.toString(),
      transactionHash: txHash,
    };
  }
}
