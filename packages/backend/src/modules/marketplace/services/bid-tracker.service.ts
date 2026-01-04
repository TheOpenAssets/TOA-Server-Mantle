import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Bid, BidDocument, BidStatus } from '../../../database/schemas/bid.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { NotifyBidDto } from '../dto/notify-bid.dto';
import { NotifySettlementDto } from '../dto/notify-settlement.dto';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

@Injectable()
export class BidTrackerService {
  private readonly logger = new Logger(BidTrackerService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    private notificationService: NotificationService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

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
    const bidData = await this.validateBidTransaction(
      dto.txHash as Hash,
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
    const tokenAmountBigInt = BigInt(bidData.tokenAmount);
    const priceBigInt = BigInt(bidData.price);
    const usdcDeposited = (priceBigInt * tokenAmountBigInt) / BigInt(10 ** 18);

    // Record bid in database
    const bid = await this.bidModel.create({
      assetId: dto.assetId,
      bidder: investorWallet.toLowerCase(),
      tokenAmount: bidData.tokenAmount,
      price: bidData.price,
      usdcDeposited: usdcDeposited.toString(),
      bidIndex: bidData.bidIndex,
      status: BidStatus.PLACED,
      transactionHash: dto.txHash,
      // blockNumber: bidData.blockNumber,
    });

    this.logger.log(`Bid recorded: ${bid._id}`);

    // Send notification to bidder
    try {
      const usdcDepositedFormatted = (Number(usdcDeposited) / 1e6).toFixed(2);
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
          bidId: bid._id.toString(),
          tokenAmount: bidData.tokenAmount,
          price: bidData.price,
          usdcDeposited: usdcDeposited.toString(),
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send bid notification: ${error.message}`);
      // Don't fail the bid if notification fails
    }

    return {
      success: true,
      bidId: bid._id,
      assetId: dto.assetId,
      tokenAmount: bidData.tokenAmount,
      price: bidData.price,
      usdcDeposited: usdcDeposited.toString(),
      bidIndex: bidData.bidIndex,
    };
  }

  /**
   * Validate bid transaction on-chain
   */
  private async validateBidTransaction(
    txHash: Hash,
    assetId: string,
    expectedBidder: string,
  ): Promise<{
    tokenAmount: string;
    price: string;
    bidIndex: number;
    // blockNumber: number;
  } | null> {
    try {
      // Get transaction receipt
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Decode BidSubmitted event from logs
      const marketplaceAddress = this.contractLoader.getContractAddress('PrimaryMarketplace');
      const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: any };

          if (decoded.eventName === 'BidSubmitted') {
            const { assetId: eventAssetId, bidder, tokenAmount, price, bidIndex } = decoded.args;

            // Validate this is the correct bid
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              bidder.toLowerCase() === expectedBidder.toLowerCase()
            ) {
              return {
                tokenAmount: tokenAmount.toString(),
                price: price.toString(),
                bidIndex: Number(bidIndex),
                // blockNumber: Number(receipt.blockNumber),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`BidSubmitted event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating transaction ${txHash}:`, error.message);
      return null;
    }
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
        bidId: b._id,
        assetId: b.assetId,
        tokenAmount: b.tokenAmount,
        price: b.price,
        usdcDeposited: b.usdcDeposited,
        bidIndex: b.bidIndex,
        status: b.status,
        txHash: b.transactionHash,
        bidDate: b.createdAt,
        settlementTxHash: b.settlementTxHash,
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
    const settlementData = await this.validateSettlementTransaction(
      dto.txHash as Hash,
      dto.assetId,
      dto.bidIndex,
      investorWallet,
    );

    if (!settlementData) {
      throw new BadRequestException('Invalid settlement transaction');
    }
    this.logger.log('Settlement validated on-chain', {
      assetId: dto.assetId,
      bidder: investorWallet,
      tokensReceived: settlementData.tokensReceived.toString(),
      refundAmount: settlementData.refundAmount.toString(),
    });

    // Update bid status based on whether they won or were refunded
    const newStatus = settlementData.tokensReceived > 0n
      ? BidStatus.SETTLED
      : BidStatus.REFUNDED;

    this.logger.log(`Bid outcome resolved: ${newStatus}`);

    await this.bidModel.updateOne(
      { _id: bid._id },
      {
        $set: {
          status: newStatus,
          settlementTxHash: dto.txHash,
          settledAt: new Date(),
        },
      },
    );

    this.logger.log(`DB updated for bid ${bid._id} with status ${newStatus}`);

    // NOTE: listing.sold is updated automatically by the event processor
    // when it processes the BidSettled blockchain event (event.processor.ts)
    // No need to update it here to avoid double counting

    // Send notification to bidder based on settlement outcome
    try {
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      const assetName = asset ? `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}` : dto.assetId;

      if (newStatus === BidStatus.SETTLED && settlementData.tokensReceived > 0n) {
        this.logger.log('Sending auction-won notification');
        // Auction won
        const tokensReceivedFormatted = (Number(settlementData.tokensReceived) / 1e18).toFixed(2);
        const clearingPriceFormatted = (Number(bid.price) / 1e6).toFixed(2);

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
            bidId: bid._id.toString(),
            tokensReceived: settlementData.tokensReceived.toString(),
            clearingPrice: bid.price,
          },
        });
      } else if (newStatus === BidStatus.REFUNDED) {
        this.logger.log('Bid lost; processing refund notification flow');
        // Bid refunded
        const refundAmountFormatted = (Number(settlementData.refundAmount) / 1e6).toFixed(2);

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
            bidId: bid._id.toString(),
            refundAmount: settlementData.refundAmount.toString(),
          },
        });
      }
    } catch (error: any) {
      this.logger.error(`Failed to send settlement notification: ${error.message}`);
      // Don't fail the settlement if notification fails
    }

    // Create purchase record if tokens were received
    if (newStatus === BidStatus.SETTLED && settlementData.tokensReceived > 0n) {
      try {
        const asset = await this.assetModel.findOne({ assetId: dto.assetId });
        if (!asset) {
          throw new Error(`Asset ${dto.assetId} not found`);
        }

        if (!asset.token?.address) {
          throw new Error(`Asset ${dto.assetId} has no token address`);
        }

        const tokensReceivedNum = Number(settlementData.tokensReceived) / 1e18;
        const totalPaidUSDC = (Number(bid.price) / 1e6) * tokensReceivedNum; // price per token * quantity
        const totalPaidWei = BigInt(Math.floor(totalPaidUSDC * 1e6)); // Convert back to wei

        this.logger.log(`Creating purchase record for ${investorWallet}: ${tokensReceivedNum} tokens at $${Number(bid.price) / 1e6} per token`);

        this.logger.log('✅ Settlement confirmed; creating purchase record for portfolio visibility');
        await this.purchaseModel.create({
          txHash: dto.txHash,
          assetId: dto.assetId,
          investorWallet: investorWallet.toLowerCase(),
          tokenAddress: asset.token.address,
          amount: settlementData.tokensReceived.toString(), // Token amount in wei
          price: bid.price.toString(), // Price per token in USDC wei
          totalPayment: totalPaidWei.toString(), // Total USDC paid in wei
          status: 'CONFIRMED',
          metadata: {
            assetName: asset.metadata?.invoiceNumber,
            industry: asset.metadata?.industry,
          },
        });
        this.logger.log('Purchase record persisted; should surface in portfolio queries');

        // Send notification about successful token acquisition
        try {
          const pricePerToken = Number(bid.price) / 1e6;
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
      bidId: bid._id,
      assetId: dto.assetId,
      bidIndex: dto.bidIndex,
      status: newStatus,
      tokensReceived: settlementData.tokensReceived.toString(),
      refundAmount: settlementData.refundAmount.toString(),
      txHash: dto.txHash,
    };
  }

  /**
   * Validate settlement transaction on-chain
   */
  private async validateSettlementTransaction(
    txHash: Hash,
    assetId: string,
    bidIndex: number,
    expectedBidder: string,
  ): Promise<{
    tokensReceived: bigint;
    refundAmount: bigint;
  } | null> {
    try {
      // Get transaction receipt
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Decode BidSettled event from logs
      const marketplaceAddress = this.contractLoader.getContractAddress('PrimaryMarketplace');
      const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: any };
          if (decoded.eventName === 'BidSettled') {
            const {
              assetId: eventAssetId,
              bidder,
              tokensReceived,
              cost,
              refund,
            } = decoded.args;
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              bidder.toLowerCase() === expectedBidder.toLowerCase()
            ) {
              this.logger.log('Decoded BidSettled event', {
                assetId: assetId,
                bidder,
                tokensReceived: tokensReceived.toString(),
                refundAmount: refund.toString(),
              });
              return {
                tokensReceived: BigInt(tokensReceived),
                refundAmount: BigInt(refund),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`BidSettled event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating settlement transaction ${txHash}:`, error.message);
      return null;
    }
  }
}
