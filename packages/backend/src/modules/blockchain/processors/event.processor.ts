import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument, AssetStatus } from '../../../database/schemas/asset.schema';
import { Bid, BidDocument, BidStatus } from '../../../database/schemas/bid.schema';
import { User, UserDocument } from '../../../database/schemas/user.schema';
import { P2POrder, P2POrderDocument, OrderStatus } from '../../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeDocument } from '../../../database/schemas/p2p-trade.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { TokenHolderTrackingService } from '../../yield/services/token-holder-tracking.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { SseEmitterService } from '../../notifications/services/sse-emitter.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { SolvencyPositionService } from '../../solvency/services/solvency-position.service';
import { PositionStatus } from '../../../database/schemas/solvency-position.schema';

@Processor('event-processing')
export class EventProcessor extends WorkerHost {
  private readonly logger = new Logger(EventProcessor.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Bid.name) private bidModel: Model<BidDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(P2POrder.name) private orderModel: Model<P2POrderDocument>,
    @InjectModel(P2PTrade.name) private tradeModel: Model<P2PTradeDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    private tokenHolderTrackingService: TokenHolderTrackingService,
    private notificationService: NotificationService,
    private sseService: SseEmitterService,
    private solvencyPositionService: SolvencyPositionService,
  ) {
    super();
  }

  // Helper to convert bytes32 back to UUID format
  private bytes32ToUuid(bytes32: string): string {
    // Remove 0x prefix and trailing zeros
    const hex = bytes32.replace('0x', '').replace(/0+$/, '');
    // Insert hyphens at UUID positions: 8-4-4-4-12
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  async process(job: Job<any, any, string>): Promise<any> {
    this.logger.log(`Processing event job: ${job.name} [${job.id}]`);

    switch (job.name) {
      case 'process-asset-registered':
        return this.processAssetRegistered(job.data);
      case 'process-token-deployed':
        return this.processTokenDeployed(job.data);
      case 'process-identity-registered':
        return this.processIdentityRegistered(job.data);
      case 'process-transfer':
        return this.processTransfer(job.data);
      case 'process-bid-submitted':
        return this.processBidSubmitted(job.data);
      case 'process-auction-ended':
        return this.processAuctionEnded(job.data);
      case 'process-bid-settled':
        return this.processBidSettled(job.data);
      case 'process-p2p-order-created':
        return this.processP2POrderCreated(job.data);
      case 'process-p2p-order-filled':
        return this.processP2POrderFilled(job.data);
      case 'process-p2p-order-cancelled':
        return this.processP2POrderCancelled(job.data);

      // SolvencyVault events
      case 'process-solvency-borrow':
        return this.processSolvencyBorrow(job.data);
      case 'process-solvency-repayment':
        return this.processSolvencyRepayment(job.data);
      case 'process-solvency-missed-payment':
        return this.processSolvencyMissedPayment(job.data);
      case 'process-solvency-defaulted':
        return this.processSolvencyDefaulted(job.data);
      case 'process-solvency-liquidated':
        return this.processSolvencyLiquidated(job.data);
      case 'process-solvency-liquidation-settled':
        return this.processSolvencyLiquidationSettled(job.data);
      case 'process-solvency-withdrawal':
        return this.processSolvencyWithdrawal(job.data);
      case 'process-solvency-repayment-plan':
        return this.processSolvencyRepaymentPlan(job.data);

      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processBidSubmitted(data: any) {
    const { assetId: assetIdBytes32, bidder, tokenAmount, price, bidIndex, txHash, blockNumber } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing new bid for ${assetId} from ${bidder}`);

    const newBid = new this.bidModel({
      assetId,
      bidder,
      tokenAmount,
      price,
      bidIndex,
      transactionHash: txHash,
      blockNumber,
      status: BidStatus.PENDING,
    });
    await newBid.save();

    // Optionally, update asset with bid stats
    await this.assetModel.updateOne(
      { assetId },
      { $inc: { 'listing.totalBids': 1 } }
    );
  }

  private async processAuctionEnded(data: any) {
    const { assetId: assetIdBytes32, clearingPrice, txHash } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing auction end for ${assetId} with clearing price ${clearingPrice}`);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'listing.active': false,
          'listing.clearingPrice': clearingPrice,
          'listing.phase': 'ENDED',
        },
      }
    );

    // Update status of all bids for this auction
    // IMPORTANT: Cannot use MongoDB $gte/$lt on string fields - must compare as BigInt
    // Only bids STRICTLY GREATER than clearing price win (bids AT clearing price lose)
    const bids = await this.bidModel.find({ assetId }).exec();
    const clearingPriceBigInt = BigInt(clearingPrice);

    for (const bid of bids) {
      const bidPrice = BigInt(bid.price);
      const newStatus = bidPrice > clearingPriceBigInt ? BidStatus.WON : BidStatus.LOST;

      await this.bidModel.updateOne(
        { _id: bid._id },
        { $set: { status: newStatus } }
      );
    }

    this.logger.log(`Updated bid statuses for ${bids.length} bids based on clearing price ${clearingPrice}`);
  }

  private async processBidSettled(data: any) {
    const { assetId: assetIdBytes32, bidder, bidIndex, tokensReceived, cost, refund, txHash } = data;
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Processing settlement for bid ${bidIndex} on ${assetId} by ${bidder}`);

    // Determine status: SETTLED if tokens received, REFUNDED if no tokens (lost bid)
    const tokensBigInt = BigInt(tokensReceived);
    const isWinner = tokensBigInt > BigInt(0);
    const status = isWinner ? BidStatus.SETTLED : BidStatus.REFUNDED;

    // Update bid with settlement details
    await this.bidModel.updateOne(
      { assetId, bidIndex },
      {
        $set: {
          status,
          settlementTxHash: txHash, // Save settlement transaction hash
          settledAt: new Date(),
          tokensReceived,
          cost,
          refund,
        },
      }
    );

    // Update listing.sold if tokens were received
    if (isWinner) {
      const asset = await this.assetModel.findOne({ assetId });
      if (asset) {
        const currentSold = BigInt(asset.listing?.sold || '0');
        const newSold = currentSold + tokensBigInt;

        await this.assetModel.updateOne(
          { assetId },
          { $set: { 'listing.sold': newSold.toString() } }
        );

        this.logger.log(
          `Updated listing.sold for ${assetId}: ${currentSold.toString()} + ${tokensReceived} = ${newSold.toString()} tokens`
        );
      }
    } else {
      this.logger.log(
        `Bid ${bidIndex} refunded for ${assetId}: ${refund} USDC (no tokens allocated)`
      );
    }
  }

  private async processAssetRegistered(data: any) {
    const { assetId: assetIdBytes32, blobId, attestationHash, attestor, txHash, blockNumber, timestamp } = data;

    // Convert bytes32 to UUID format
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Syncing AssetRegistered for ${assetIdBytes32} -> UUID: ${assetId}`);

    const asset = await this.assetModel.findOneAndUpdate(
      { assetId },
      {
        $set: {
          'registry.transactionHash': txHash,
          'registry.blockNumber': blockNumber,
          'registry.registeredAt': new Date(timestamp * 1000),
          status: AssetStatus.REGISTERED,
          'checkpoints.registered': true,
        },
      },
      { new: true }
    );

    if (!asset) {
      this.logger.error(`Asset ${assetId} not found in DB during registration sync`);
      return;
    }

    // TODO: Emit WebSocket to frontend via Gateway
    // this.wsGateway.emit('asset:status-changed', { assetId, status: 'REGISTERED' });

    return { assetId, status: 'REGISTERED' };
  }

  private async processTokenDeployed(data: any) {
    const { assetId: assetIdBytes32, tokenAddress, complianceAddress, totalSupply, txHash, blockNumber, timestamp } = data;

    // Convert bytes32 to UUID format
    const assetId = this.bytes32ToUuid(assetIdBytes32);

    this.logger.log(`Syncing TokenSuiteDeployed for ${assetIdBytes32} -> UUID: ${assetId} -> Token: ${tokenAddress}`);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          'token.address': tokenAddress,
          'token.compliance': complianceAddress,
          'token.supply': totalSupply.toString(),
          'token.deployedAt': new Date(timestamp * 1000),
          'token.transactionHash': txHash,
          status: AssetStatus.TOKENIZED,
          'checkpoints.tokenized': true,
        },
      }
    );

    // TODO: Initialize tokenHolders collection logic if needed
    // TODO: Emit WebSocket
  }

  private async processIdentityRegistered(data: any) {
    const { wallet, txHash, blockNumber, timestamp } = data;

    this.logger.log(`Syncing IdentityRegistered for ${wallet}`);

    await this.userModel.updateOne(
      { walletAddress: wallet.toLowerCase() },
      {
        $set: {
          kyc: true,
          // You might want to add on-chain metadata to User schema later
        },
      }
    );

    // TODO: Emit WebSocket
  }

  private async processTransfer(data: any) {
    const { tokenAddress, from, to, amount, txHash } = data;
    this.logger.log(`Transfer observed for ${tokenAddress}: ${from} -> ${to} [${amount}]`);

    await this.tokenHolderTrackingService.updateHolderFromTransferEvent(tokenAddress, from, to, amount);
  }

  /**
   * Process P2P OrderCreated event - Create order in database
   */
  private async processP2POrderCreated(data: any) {
    const { orderId, maker, tokenAddress, amount, pricePerToken, isBuy, txHash, blockNumber, timestamp } = data;

    this.logger.log(`[P2P Event Processor] Processing OrderCreated: #${orderId} by ${maker}`);

    // Find Asset by token address (case-insensitive)
    const asset = await this.assetModel.findOne({
      'token.address': new RegExp(`^${tokenAddress}$`, 'i')
    });
    const assetId = asset ? asset.assetId : 'UNKNOWN';

    if (!asset) {
      this.logger.error(`[P2P Event Processor] Asset not found for token: ${tokenAddress}`);
      this.logger.error(`[P2P Event Processor] Cannot create order without valid asset - skipping`);
      return; // Don't create order without valid asset
    }

    // Check if order already exists (prevent duplicates)
    const existingOrder = await this.orderModel.findOne({ orderId });
    if (existingOrder) {
      this.logger.warn(`[P2P Event Processor] Order #${orderId} already exists, skipping`);
      return;
    }

    // Create order in database
    await this.orderModel.create({
      orderId,
      maker: maker.toLowerCase(),
      assetId,
      tokenAddress: tokenAddress.toLowerCase(),
      isBuy,
      initialAmount: amount,
      remainingAmount: amount,
      pricePerToken,
      status: OrderStatus.OPEN,
      txHash,
      blockNumber,
      blockTimestamp: new Date(timestamp * 1000),
    });

    const amountFmt = (Number(amount) / 1e18).toFixed(2);
    const priceFmt = (Number(pricePerToken) / 1e6).toFixed(2);
    this.logger.log(`[P2P Event Processor] ✅ Order Created in DB: #${orderId} - ${isBuy ? 'BUY' : 'SELL'} ${amountFmt} @ ${priceFmt} USDC`);

    // CRITICAL: For SELL orders, create negative Purchase record to track tokens going into escrow
    // This ensures portfolio correctly reflects tokens locked in P2P orders
    if (!isBuy && asset) {
      try {
        const lockTxHash = `${txHash}-sell-lock`;

        // Check if Purchase record already exists (idempotency)
        const existingPurchase = await this.purchaseModel.findOne({ txHash: lockTxHash });
        if (existingPurchase) {
          this.logger.debug(`[P2P Event Processor] Purchase record already exists for ${lockTxHash}, skipping`);
        } else {
          const negativeAmount = '-' + amount; // Negative value to reduce portfolio balance
          const estimatedValue = (BigInt(amount) * BigInt(pricePerToken)) / BigInt(10 ** 18);

          await this.purchaseModel.create({
            txHash: lockTxHash,
            assetId,
            investorWallet: maker.toLowerCase(),
            tokenAddress: tokenAddress.toLowerCase(),
            amount: negativeAmount, // NEGATIVE to reduce balance
            price: pricePerToken,
            totalPayment: estimatedValue.toString(),
            blockNumber,
            blockTimestamp: new Date(timestamp * 1000),
            status: 'CONFIRMED',
            source: 'P2P_SELL_ORDER',
            p2pTradeId: `order-${orderId}`, // Reference to order
            metadata: {
              assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
              industry: asset.metadata?.industry,
              riskTier: asset.metadata?.riskTier,
            },
          });

          this.logger.log(`[P2P Event Processor] ✅ Negative Purchase record created for seller (tokens locked): ${maker.substring(0, 8)}... - ${amountFmt} tokens`);
        }
      } catch (error: any) {
        this.logger.error(`[P2P Event Processor] Failed to create negative Purchase record: ${error.message}`);
      }
    }

    // Send notification to order creator
    try {
      await this.notificationService.create({
        userId: maker,
        walletAddress: maker,
        header: 'Order Created Successfully',
        detail: `Your ${isBuy ? 'buy' : 'sell'} order for ${amountFmt} tokens at $${priceFmt} has been created.`,
        type: NotificationType.ORDER_CREATED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId,
          orderId,
          isBuy,
          amount: amountFmt,
          price: priceFmt,
          txHash
        }
      });
      this.logger.log(`[P2P Event Processor] ✅ Notification sent to maker: ${maker.substring(0, 8)}... for ORDER_CREATED`);
    } catch (error: any) {
      this.logger.error(`[P2P Event Processor] ❌ Failed to send ORDER_CREATED notification to ${maker}: ${error.message}`);
    }

    // Emit real-time update
    this.sseService.emitToAll('orderbook_update', { assetId, type: 'create', orderId });
  }

  /**
   * Process P2P OrderFilled event - Update order and create trade record
   */
  private async processP2POrderFilled(data: any) {
    const { orderId, taker, maker, tokenAddress, amountFilled, totalCost, remainingAmount, txHash, blockNumber, timestamp } = data;

    this.logger.log(`[P2P Event Processor] Processing OrderFilled: #${orderId}, amount: ${amountFilled}`);

    // Update order
    const order = await this.orderModel.findOneAndUpdate(
      { orderId },
      {
        remainingAmount,
        status: remainingAmount === '0' ? OrderStatus.FILLED : OrderStatus.OPEN,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (!order) {
      this.logger.error(`[P2P Event Processor] Order #${orderId} not found in database`);
      return;
    }

    // Create trade record
    const tradeId = `${txHash}-${blockNumber}-${orderId}`;
    const existingTrade = await this.tradeModel.findOne({ tradeId });
    if (existingTrade) {
      this.logger.warn(`[P2P Event Processor] Trade ${tradeId} already exists, skipping`);
      return;
    }

    const trade = await this.tradeModel.create({
      tradeId,
      orderId,
      assetId: order.assetId,
      tokenAddress: tokenAddress.toLowerCase(),
      buyer: order.isBuy ? maker.toLowerCase() : taker.toLowerCase(),
      seller: order.isBuy ? taker.toLowerCase() : maker.toLowerCase(),
      amount: amountFilled,
      pricePerToken: order.pricePerToken,
      totalValue: totalCost,
      txHash,
      blockNumber,
      blockTimestamp: new Date(timestamp * 1000),
    });

    const amountFmt = (Number(amountFilled) / 1e18).toFixed(2);
    const costFmt = (Number(totalCost) / 1e6).toFixed(2);
    this.logger.log(`[P2P Event Processor] ✅ Trade Created: ${amountFmt} tokens for ${costFmt} USDC`);

    // Create Purchase record for buyer (receives tokens from escrow)
    try {
      const asset = await this.assetModel.findOne({ assetId: order.assetId });
      const metadata = asset ? {
        assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
        industry: asset.metadata?.industry,
        riskTier: asset.metadata?.riskTier,
      } : undefined;

      // Buyer receives tokens (positive Purchase record)
      await this.purchaseModel.create({
        txHash: `${txHash}-buy`,
        assetId: order.assetId,
        investorWallet: trade.buyer,
        tokenAddress: tokenAddress.toLowerCase(),
        amount: amountFilled,
        price: order.pricePerToken,
        totalPayment: totalCost,
        blockNumber,
        blockTimestamp: new Date(timestamp * 1000),
        status: 'CONFIRMED',
        source: 'SECONDARY_MARKET',
        p2pTradeId: trade.tradeId,
        metadata,
      });

      this.logger.log(`[P2P Event Processor] ✅ Purchase record created for buyer: ${trade.buyer.substring(0, 8)}... (+${amountFmt} tokens)`);

      // CRITICAL: Seller sends tokens (negative Purchase record)
      // For SELL orders: this offsets the initial negative lock
      // For BUY orders: this creates the negative record for the seller (taker)
      const negativeAmount = '-' + amountFilled;
      await this.purchaseModel.create({
        txHash: `${txHash}-sell`,
        assetId: order.assetId,
        investorWallet: trade.seller,
        tokenAddress: tokenAddress.toLowerCase(),
        amount: negativeAmount, // NEGATIVE - tokens leaving seller
        price: order.pricePerToken,
        totalPayment: totalCost,
        blockNumber,
        blockTimestamp: new Date(timestamp * 1000),
        status: 'CONFIRMED',
        source: 'SECONDARY_MARKET',
        p2pTradeId: trade.tradeId,
        metadata,
      });

      this.logger.log(`[P2P Event Processor] ✅ Purchase record created for seller: ${trade.seller.substring(0, 8)}... (-${amountFmt} tokens)`);

    } catch (error: any) {
      this.logger.error(`[P2P Event Processor] Failed to create Purchase records: ${error.message}`);
    }

    // Send notifications
    try {
      await this.notificationService.create({
        userId: maker,
        walletAddress: maker,
        header: 'Order Filled',
        detail: `Your ${order.isBuy ? 'buy' : 'sell'} order for ${amountFmt} tokens was filled at $${(Number(order.pricePerToken) / 1e6).toFixed(2)}.`,
        type: NotificationType.ORDER_FILLED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId: order.assetId,
          orderId,
          amount: amountFmt,
          price: (Number(order.pricePerToken) / 1e6).toFixed(2),
          totalCost: (Number(totalCost) / 1e6).toFixed(2),
          txHash,
          tradeId: trade.tradeId
        }
      });
      this.logger.log(`[P2P Event Processor] ✅ Notification sent to maker: ${maker.substring(0, 8)}... for ORDER_FILLED`);
    } catch (error: any) {
      this.logger.error(`[P2P Event Processor] ❌ Failed to send ORDER_FILLED notification to maker ${maker}: ${error.message}`);
    }

    try {
      await this.notificationService.create({
        userId: taker,
        walletAddress: taker,
        header: 'Trade Executed',
        detail: `You successfully ${order.isBuy ? 'sold' : 'bought'} ${amountFmt} tokens at $${(Number(order.pricePerToken) / 1e6).toFixed(2)}.`,
        type: NotificationType.ORDER_FILLED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId: order.assetId,
          orderId,
          amount: amountFmt,
          price: (Number(order.pricePerToken) / 1e6).toFixed(2),
          totalCost: (Number(totalCost) / 1e6).toFixed(2),
          txHash,
          tradeId: trade.tradeId
        }
      });
      this.logger.log(`[P2P Event Processor] ✅ Notification sent to taker: ${taker.substring(0, 8)}... for ORDER_FILLED`);
    } catch (error: any) {
      this.logger.error(`[P2P Event Processor] ❌ Failed to send ORDER_FILLED notification to taker ${taker}: ${error.message}`);
    }

    // Emit real-time update
    this.sseService.emitToAll('orderbook_update', { assetId: order.assetId, type: 'fill', orderId });
  }

  /**
   * Process P2P OrderCancelled event - Mark order as cancelled
   */
  private async processP2POrderCancelled(data: any) {
    const { orderId, txHash, blockNumber, timestamp } = data;

    this.logger.log(`[P2P Event Processor] Processing OrderCancelled: #${orderId}`);

    const order = await this.orderModel.findOneAndUpdate(
      { orderId },
      {
        status: OrderStatus.CANCELLED,
        updatedAt: new Date(),
      },
      { new: true }
    );

    if (order) {
      const remainingFmt = (Number(order.remainingAmount) / 1e18).toFixed(2);
      this.logger.log(`[P2P Event Processor] ✅ Order Cancelled: #${orderId} - ${remainingFmt} tokens released`);

      // CRITICAL: For cancelled SELL orders, reverse the negative Purchase record
      // This returns the tokens from escrow back to the user's portfolio
      if (!order.isBuy && order.remainingAmount !== '0') {
        try {
          const cancelTxHash = `${txHash}-cancel-return`;

          // Check if Purchase record already exists (idempotency)
          const existingPurchase = await this.purchaseModel.findOne({ txHash: cancelTxHash });
          if (existingPurchase) {
            this.logger.debug(`[P2P Event Processor] Cancel reversal record already exists for ${cancelTxHash}, skipping`);
          } else {
            const asset = await this.assetModel.findOne({ assetId: order.assetId });

            // Create positive Purchase record to offset the negative lock
            await this.purchaseModel.create({
              txHash: cancelTxHash,
              assetId: order.assetId,
              investorWallet: order.maker,
              tokenAddress: order.tokenAddress,
              amount: order.remainingAmount, // POSITIVE to reverse negative lock
              price: order.pricePerToken,
              totalPayment: ((BigInt(order.remainingAmount) * BigInt(order.pricePerToken)) / BigInt(10 ** 18)).toString(),
              blockNumber,
              blockTimestamp: new Date(timestamp * 1000),
              status: 'CONFIRMED',
              source: 'P2P_ORDER_CANCELLED',
              p2pTradeId: `order-${orderId}`, // Reference to order
              metadata: asset ? {
                assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
                industry: asset.metadata?.industry,
                riskTier: asset.metadata?.riskTier,
              } : undefined,
            });

            this.logger.log(`[P2P Event Processor] ✅ Cancel reversal record created: ${order.maker.substring(0, 8)}... - ${remainingFmt} tokens returned`);
          }
        } catch (error: any) {
          this.logger.error(`[P2P Event Processor] Failed to create cancel reversal record: ${error.message}`);
        }
      }

      // Send notification to order creator
      try {
        await this.notificationService.create({
          userId: order.maker,
          walletAddress: order.maker,
          header: 'Order Cancelled',
          detail: `Your ${order.isBuy ? 'buy' : 'sell'} order for ${remainingFmt} tokens has been cancelled${!order.isBuy ? ' and tokens returned to your wallet' : ''}.`,
          type: NotificationType.ORDER_CANCELLED,
          severity: NotificationSeverity.INFO,
          action: NotificationAction.VIEW_PORTFOLIO,
          actionMetadata: {
            assetId: order.assetId,
            orderId,
            amount: remainingFmt,
            price: (Number(order.pricePerToken) / 1e6).toFixed(2),
            txHash
          }
        });
        this.logger.log(`[P2P Event Processor] ✅ Notification sent to maker: ${order.maker.substring(0, 8)}... for ORDER_CANCELLED`);
      } catch (error: any) {
        this.logger.error(`[P2P Event Processor] ❌ Failed to send ORDER_CANCELLED notification to ${order.maker}: ${error.message}`);
      }

      // Emit real-time update
      this.sseService.emitToAll('orderbook_update', { assetId: order.assetId, type: 'cancel', orderId });
    } else {
      this.logger.error(`[P2P Event Processor] Order #${orderId} not found in database`);
    }
  }
  
  // ========================================
  // SolvencyVault Event Processors
  // ========================================

  private async processSolvencyBorrow(data: any) {
    const { positionId, amount, totalDebt, txHash, blockNumber } = data;
    this.logger.log(`Processing SolvencyVault borrow for position ${positionId}: borrowed ${amount}, total debt ${totalDebt}`);

    try {
      // The recordBorrow method doesn't sync repayment plan from blockchain
      // We need to sync the full position after borrow
      await this.solvencyPositionService.syncPositionWithBlockchain(positionId);
      this.logger.log(`✅ Position ${positionId} synced after borrow event`);
    } catch (error: any) {
      this.logger.error(`Failed to sync position ${positionId} after borrow: ${error.message}`);
    }
  }

  private async processSolvencyRepayment(data: any) {
    const { positionId, amountPaid, principal, interest, remainingDebt, txHash, blockNumber } = data;
    this.logger.log(`Processing SolvencyVault repayment for position ${positionId}: paid ${amountPaid}, principal ${principal}, interest ${interest}`);

    try {
      await this.solvencyPositionService.recordRepayment(positionId, amountPaid, principal);
      this.logger.log(`✅ Position ${positionId} updated after repayment`);
    } catch (error: any) {
      this.logger.error(`Failed to process repayment for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyMissedPayment(data: any) {
    const { positionId, missedPayments, txHash, blockNumber } = data;
    this.logger.log(`Processing missed payment for position ${positionId}: total missed = ${missedPayments}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.missedPayments = missedPayments;

      // Update the repayment schedule to mark the current installment as MISSED
      if (position.repaymentSchedule && position.repaymentSchedule.length > 0) {
        const pendingInstallment = position.repaymentSchedule.find((i: any) => i.status === 'PENDING');
        if (pendingInstallment) {
          pendingInstallment.status = 'MISSED';
        }
      }

      // Advance next payment due date
      if (position.nextPaymentDueDate && position.installmentInterval) {
        const intervalMs = position.installmentInterval * 1000;
        position.nextPaymentDueDate = new Date(position.nextPaymentDueDate.getTime() + intervalMs);
      }

      await position.save();
      this.logger.log(`✅ Position ${positionId} marked with ${missedPayments} missed payments`);
    } catch (error: any) {
      this.logger.error(`Failed to process missed payment for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyDefaulted(data: any) {
    const { positionId, txHash, blockNumber } = data;
    this.logger.log(`Processing default for position ${positionId}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.isDefaulted = true;
      position.status = PositionStatus.ACTIVE; // Still active but defaulted (awaiting liquidation)
      await position.save();
      this.logger.log(`✅ Position ${positionId} marked as defaulted`);
    } catch (error: any) {
      this.logger.error(`Failed to process default for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyLiquidated(data: any) {
    const { positionId, marketplaceListingId, txHash, blockNumber } = data;
    this.logger.log(`Processing liquidation for position ${positionId}`);

    try {
      await this.solvencyPositionService.markLiquidated(positionId, marketplaceListingId, txHash);
      this.logger.log(`✅ Position ${positionId} marked as liquidated`);
    } catch (error: any) {
      this.logger.error(`Failed to process liquidation for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyLiquidationSettled(data: any) {
    const { positionId, yieldReceived, debtRepaid, userRefund, txHash, blockNumber } = data;
    this.logger.log(`Processing liquidation settlement for position ${positionId}: yield ${yieldReceived}, debt repaid ${debtRepaid}, refund ${userRefund}`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);
      position.status = PositionStatus.SETTLED;
      position.settledAt = new Date();
      position.debtRecovered = debtRepaid;
      await position.save();
      this.logger.log(`✅ Position ${positionId} marked as settled`);
    } catch (error: any) {
      this.logger.error(`Failed to process liquidation settlement for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyWithdrawal(data: any) {
    const { positionId, amount, remainingCollateral, txHash, blockNumber } = data;
    this.logger.log(`Processing withdrawal for position ${positionId}: withdrew ${amount}, remaining ${remainingCollateral}`);

    try {
      await this.solvencyPositionService.recordWithdrawal(positionId, amount);
      this.logger.log(`✅ Position ${positionId} updated after withdrawal`);
    } catch (error: any) {
      this.logger.error(`Failed to process withdrawal for position ${positionId}: ${error.message}`);
    }
  }

  private async processSolvencyRepaymentPlan(data: any) {
    const { positionId, loanDuration, numberOfInstallments, installmentInterval, txHash, blockNumber } = data;
    this.logger.log(`Processing repayment plan for position ${positionId}: ${numberOfInstallments} installments, interval ${installmentInterval}s`);

    try {
      const position = await this.solvencyPositionService.getPosition(positionId);

      // This event is emitted during borrowUSDC, so the position should already have these details
      // But we'll update them to ensure consistency
      position.loanDuration = loanDuration;
      position.numberOfInstallments = numberOfInstallments;
      position.installmentInterval = installmentInterval;

      // Calculate next payment due date
      const now = new Date();
      position.nextPaymentDueDate = new Date(now.getTime() + (installmentInterval * 1000));

      await position.save();
      this.logger.log(`✅ Position ${positionId} repayment plan updated`);
    } catch (error: any) {
      this.logger.error(`Failed to process repayment plan for position ${positionId}: ${error.message}`);
    }
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} completed`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error) {
    this.logger.error(`Job ${job.id} failed: ${error.message}`);
  }
}
