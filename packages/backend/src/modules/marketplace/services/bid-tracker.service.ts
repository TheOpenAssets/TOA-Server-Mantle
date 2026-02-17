import { Injectable, Logger, BadRequestException, ConflictException, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Bid, BidDocument } from '../../../database/schemas/bid.schema';
import { BidStatus } from '@openassets/types';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { NotifyBidDto } from '../dto/notify-bid.dto';
import { NotifySettlementDto } from '../dto/notify-settlement.dto';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { BLOCKCHAIN_ADAPTER } from '../../blockchain/blockchain.constants';
import { BlockchainAdapter } from '../../blockchain/adapters/blockchain-adapter.interface';
import { UserPortfolioService } from '../../user-portfolio/services/user-portfolio.service';
import { toCanonical, fromCanonical } from '../../blockchain/utils/numeric-conversion';

@Injectable()
export class BidTrackerService {
  private readonly logger = new Logger(BidTrackerService.name);

  constructor(
    private configService: ConfigService,
    @Inject(BLOCKCHAIN_ADAPTER) private blockchainAdapter: BlockchainAdapter,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    private notificationService: NotificationService,
    private userPortfolioService: UserPortfolioService,
  ) {}

  /**
   * Validate and record a bid transaction
   */
  async notifyBid(dto: NotifyBidDto, investorWallet: string) {
    this.logger.log(`Processing bid notification: ${dto.txHash}`);

    // Check if already processed
    const existing = await this.bidModel.findOne({ transactionHash: dto.txHash });
    if (existing) {
      this.logger.warn(`Bid ${dto.txHash} already processed`);
      throw new ConflictException('Bid already recorded');
    }

    // Validate transaction on-chain
    const bidData = await this.blockchainAdapter.verifyBidTransaction(
      dto.txHash,
      dto.assetId,
      investorWallet,
    );

    if (!bidData) {
      throw new BadRequestException('Invalid bid transaction');
    }

    // Get asset details
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // Verify asset is an auction
    if (asset.listing?.type !== 'AUCTION') {
      throw new BadRequestException('Asset is not an auction');
    }

    // Calculate USDC deposited: payment = price * tokenAmount / 1e18
    // We use raw bigints for internal calculation to maintain precision
    const tokenAmountBigInt = fromCanonical(bidData.tokenAmount.value, 18);
    const priceBigInt = fromCanonical(bidData.price.value, 6);
    const usdcDepositedRaw = (priceBigInt * tokenAmountBigInt) / BigInt(10 ** 18);
    const usdcDepositedCanonical = toCanonical(usdcDepositedRaw, 6);

    const network = this.configService.get<string>('network.networkType') || 'mantle';

    // Record bid in database
    const bid = await this.bidModel.create({
      assetId: dto.assetId,
      bidder: investorWallet.toLowerCase(),
      tokenAmount: bidData.tokenAmount.value,
      price: bidData.price.value,
      usdcDeposited: usdcDepositedCanonical.value,
      bidIndex: bidData.bidIndex,
      status: BidStatus.PLACED,
      transactionHash: dto.txHash,
      network,
      // Companion fields for precision
      rawPrecise: bidData.tokenAmount.rawPrecise || bidData.price.rawPrecise || usdcDepositedCanonical.rawPrecise,
      // blockNumber: bidData.blockNumber,
    });

    this.logger.log(`Bid recorded: ${(bid as any)._id}`);

    // Send notification to bidder
    try {
      const usdcDepositedFormatted = (Number(usdcDepositedCanonical.value)).toFixed(2);
      const assetName = `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`;

      await this.notificationService.create({
        userId: investorWallet,
        walletAddress: investorWallet,
        header: 'Bid Placed Successfully',
        detail: `Your bid of $${usdcDepositedFormatted} for ${assetName} has been placed.`,
        type: NotificationType.BID_PLACED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: {
          assetId: dto.assetId,
          bidId: (bid as any)._id.toString(),
          tokenAmount: bidData.tokenAmount.value,
          price: bidData.price.value,
          usdcDeposited: usdcDepositedCanonical.value,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send bid notification: ${error.message}`);
      // Don't fail the bid if notification fails
    }

    return {
      success: true,
      bidId: (bid as any)._id,
      assetId: dto.assetId,
      tokenAmount: bidData.tokenAmount,
      price: bidData.price,
      usdcDeposited: usdcDepositedCanonical.value,
      bidIndex: bidData.bidIndex,
    };
  }

  /**
   * Get investor's bids for an auction
   */
  async getInvestorBids(investorWallet: string, assetId?: string) {
    const query: any = {
      bidder: investorWallet.toLowerCase(),
    };

    if (assetId) {
      query.assetId = assetId;
    }

    const bids = await this.bidModel
      .find(query)
      .sort({ createdAt: -1 });

    return {
      success: true,
      count: bids.length,
      bids: bids.map(b => ({
        bidId: (b as any)._id,
        assetId: b.assetId,
        tokenAmount: b.tokenAmount,
        price: b.price,
        usdcDeposited: b.usdcDeposited,
        bidIndex: b.bidIndex,
        status: b.status,
        txHash: b.transactionHash,
        settlementTxHash: b.status === BidStatus.SETTLED || b.status === BidStatus.REFUNDED ? b.settlementTxHash : undefined,
        bidDate: b.createdAt,
        settledAt: b.settledAt,
      })),
    };
  }

  /**
   * Get all bids for an auction (admin/public view)
   */
  async getAuctionBids(assetId: string) {
    const bids = await this.bidModel
      .find({ assetId })
      .sort({ price: -1, createdAt: 1 }); // Highest price first, then chronological

    // Calculate total demand at each price point
    const pricePoints = new Map<string, { price: string; totalDemand: string; bidCount: number }>();

    for (const bid of bids) {
      const existing = pricePoints.get(bid.price);
      if (existing) {
        existing.totalDemand = (BigInt(existing.totalDemand) + BigInt(bid.tokenAmount)).toString();
        existing.bidCount += 1;
      } else {
        pricePoints.set(bid.price, {
          price: bid.price,
          totalDemand: bid.tokenAmount,
          bidCount: 1,
        });
      }
    }

    return {
      success: true,
      assetId,
      totalBids: bids.length,
      pricePoints: Array.from(pricePoints.values()),
      bids: bids.map(b => ({
        bidder: b.bidder,
        tokenAmount: b.tokenAmount,
        price: b.price,
        usdcDeposited: b.usdcDeposited,
        status: b.status,
        bidDate: b.createdAt,
      })),
    };
  }

  /**
   * Process bid settlement notification
   */
  async notifySettlement(dto: NotifySettlementDto, investorWallet: string) {
    this.logger.log(`Processing settlement notification: ${dto.txHash} for bid index ${dto.bidIndex}`);

    // Find the bid by assetId, bidder, and bidIndex
    const bid = await this.bidModel.findOne({
      assetId: dto.assetId,
      bidder: investorWallet.toLowerCase(),
      bidIndex: dto.bidIndex,
    });

    if (!bid) {
      throw new BadRequestException('Bid not found');
    }

    // Check if already settled
    if (bid.status === BidStatus.SETTLED || bid.status === BidStatus.REFUNDED) {
      this.logger.warn(`Bid ${bid._id} already settled with status: ${bid.status}`);
      throw new ConflictException('Bid already settled');
    }

    this.logger.log('Validating settlement transaction on-chain...');
    // Validate settlement transaction on-chain
    const settlementData = await this.blockchainAdapter.verifyBidSettlement(
      dto.txHash,
      dto.assetId,
      investorWallet,
    );

    if (!settlementData) {
      throw new BadRequestException('Invalid settlement transaction');
    }
    this.logger.log('Settlement validated on-chain', {
      assetId: dto.assetId,
      bidder: investorWallet,
      tokensReceived: settlementData.tokensReceived.value,
      refundAmount: settlementData.refundAmount.value,
    });
    
    // Convert to BigInt for comparison
    const tokensReceivedBigInt = fromCanonical(settlementData.tokensReceived.value, 18);
    const costBigInt = fromCanonical(settlementData.cost.value, 6);

    const pricePerTokenRaw =
      tokensReceivedBigInt > 0n
        ? (costBigInt * 10n ** 18n) / tokensReceivedBigInt
        : 0n;
    
    const pricePerTokenCanonical = toCanonical(pricePerTokenRaw, 6);

    // Update bid status based on whether they won or were refunded
    const newStatus = tokensReceivedBigInt > 0n
      ? BidStatus.SETTLED
      : BidStatus.REFUNDED;

    this.logger.log(`Bid outcome resolved: ${newStatus}`);

    await this.bidModel.updateOne(
      { _id: (bid as any)._id },
      {
        $set: {
          status: newStatus,
          settlementTxHash: dto.txHash,
          settledAt: new Date(),
        },
      },
    );

    this.logger.log(`DB updated for bid ${(bid as any)._id} with status ${newStatus}`);

    // NOTE: listing.sold is updated automatically by the event processor
    // when it processes the BidSettled blockchain event (event.processor.ts)
    // No need to update it here to avoid double counting

    // Send notification to bidder based on settlement outcome
    try {
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      const assetName = asset ? `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}` : dto.assetId;

      if (newStatus === BidStatus.SETTLED && tokensReceivedBigInt > 0n) {
        this.logger.log('Sending auction-won notification');
        // Auction won
        const tokensReceivedFormatted = Number(settlementData.tokensReceived.value).toFixed(2);
        const clearingPriceFormatted = Number(pricePerTokenCanonical.value).toFixed(2);

        await this.notificationService.create({
          userId: investorWallet,
          walletAddress: investorWallet,
          header: 'Congratulations! You Won the Auction',
          detail: `You won the auction for ${assetName} at clearing price $${clearingPriceFormatted}. Your tokens have been allocated.`,
          type: NotificationType.AUCTION_WON,
          severity: NotificationSeverity.SUCCESS,
          action: NotificationAction.VIEW_PORTFOLIO,
          actionMetadata: {
            assetId: dto.assetId,
            bidId: (bid as any)._id.toString(),
            tokensReceived: settlementData.tokensReceived.value,
            clearingPrice: pricePerTokenCanonical.value,
          },
        });
      } else if (newStatus === BidStatus.REFUNDED) {
        this.logger.log('Bid lost; processing refund notification flow');
        // Bid refunded
        const refundAmountFormatted = Number(settlementData.refundAmount.value).toFixed(2);

        await this.notificationService.create({
          userId: investorWallet,
          walletAddress: investorWallet,
          header: 'Auction Ended - Bid Refunded',
          detail: `The auction for ${assetName} ended. Your bid of $${refundAmountFormatted} has been refunded.`,
          type: NotificationType.BID_REFUNDED,
          severity: NotificationSeverity.INFO,
          action: NotificationAction.VIEW_MARKETPLACE,
          actionMetadata: {
            assetId: dto.assetId,
            bidId: (bid as any)._id.toString(),
            refundAmount: settlementData.refundAmount.value,
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to send settlement notification: ${error.message}`);
      // Don't fail the settlement if notification fails
    }

    // Create purchase record if tokens were received
    if (newStatus === BidStatus.SETTLED && tokensReceivedBigInt > 0n) {
      try {
        const asset = await this.assetModel.findOne({ assetId: dto.assetId });
        if (!asset) {
          throw new Error(`Asset ${dto.assetId} not found`);
        }

        if (!asset.token?.address) {
          throw new Error(`Asset ${dto.assetId} has no token address`);
        }

        const tokensReceivedNum = Number(settlementData.tokensReceived.value);
        const totalPaidUSDC = Number(settlementData.cost.value); 
        // pricePerTokenCanonical is already computed above

        this.logger.log(
          `Creating purchase record for ${investorWallet}: ${tokensReceivedNum} tokens at clearing price ${pricePerTokenCanonical.value} USDC`,
        );

        this.logger.log('✅ Settlement confirmed; creating purchase record for portfolio visibility');
        const purchase = await this.purchaseModel.create({
          txHash: dto.txHash,
          assetId: dto.assetId,
          investorWallet: investorWallet.toLowerCase(),
          tokenAddress: asset.token.address,
          amount: settlementData.tokensReceived.value, // Canonical
          price: pricePerTokenCanonical.value, // Canonical
          totalPayment: settlementData.cost.value, // Canonical
          status: 'CONFIRMED',
          source: 'PRIMARY_MARKET',
          network: asset.network || 'mantle',
          metadata: {
            assetName: asset.metadata?.invoiceNumber,
            industry: asset.metadata?.industry,
          },
        });
        this.logger.log('Purchase record persisted; should surface in portfolio queries');

        // Update portfolio
        try {
          await this.userPortfolioService.updateOnPurchase(purchase, asset.network || 'mantle');
        } catch (error: any) {
          this.logger.error(`Failed to update portfolio after auction settlement: ${error.message}`);
        }

        await this.syncListingSold(dto.assetId);

        // Send notification about successful token acquisition
        try {
          const pricePerToken = Number(pricePerTokenCanonical.value);
          await this.notificationService.create({
            userId: investorWallet,
            walletAddress: investorWallet,
            header: 'RWA Tokens Acquired Successfully',
            detail: `You have successfully acquired ${tokensReceivedNum.toFixed(2)} ${asset.metadata?.invoiceNumber || 'RWA'} tokens at $${pricePerToken.toFixed(2)} per token. Your tokens are now available in your portfolio.`,
            type: NotificationType.AUCTION_WON,
            severity: NotificationSeverity.SUCCESS,
            action: NotificationAction.VIEW_PORTFOLIO,
            actionMetadata: {
              assetId: dto.assetId,
              tokensReceived: tokensReceivedNum,
              pricePerToken: pricePerToken,
              totalPaid: totalPaidUSDC,
              txHash: dto.txHash,
            },
          });
          this.logger.log(`Sent token acquisition notification to ${investorWallet}`);
        } catch (notifError: any) {
          this.logger.error(`Failed to send token acquisition notification: ${notifError.message}`);
        }
      } catch (error: any) {
        this.logger.error(`Failed to create purchase record: ${error.message}`);
        // Don't fail the settlement if purchase record creation fails
      }
    } else {
      this.logger.log('No tokens received; no purchase record created (refund path)');
    }

    return {
      success: true,
      bidId: (bid as any)._id,
      assetId: dto.assetId,
      bidIndex: dto.bidIndex,
      status: newStatus,
      tokensReceived: settlementData.tokensReceived.toString(),
      refundAmount: settlementData.refundAmount.toString(),
      txHash: dto.txHash,
    };
  }

  private async syncListingSold(assetId: string) {
    try {
      const purchases = await this.purchaseModel.find({
        assetId,
        status: { $in: ['CONFIRMED', 'CLAIMED'] },
      }).select({ amount: 1 });
      const totalSold = purchases.reduce(
        (acc, p) => acc + BigInt(p.amount || '0'),
        0n,
      );
      await this.assetModel.updateOne(
        { assetId },
        { $set: { 'listing.sold': totalSold.toString() } },
      );
      this.logger.log(
        `listing.sold synced for ${assetId}: ${Number(totalSold) / 1e18} tokens`,
      );
    } catch (error: any) {
      this.logger.error(`Failed to sync listing.sold for ${assetId}: ${error.message}`);
    }
  }
}
