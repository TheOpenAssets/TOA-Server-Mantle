import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, decodeEventLog, parseAbiItem } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { P2POrder, P2POrderDocument, OrderStatus } from '../../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeDocument } from '../../../database/schemas/p2p-trade.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { NotificationService } from '../../notifications/services/notification.service';
import { SseEmitterService } from '../../notifications/services/sse-emitter.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';

@Injectable()
export class SecondaryMarketIndexer implements OnModuleInit {
  private readonly logger = new Logger(SecondaryMarketIndexer.name);
  private publicClient;
  private isSyncing = false;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectModel(P2POrder.name) private orderModel: Model<P2POrderDocument>,
    @InjectModel(P2PTrade.name) private tradeModel: Model<P2PTradeDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    private notificationService: NotificationService,
    private sseService: SseEmitterService,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  async onModuleInit() {
    // Start syncing loop
    this.syncEvents();
    setInterval(() => this.syncEvents(), 10000);
  }

  async syncEvents() {
    if (this.isSyncing) {
      this.logger.debug('[P2P Indexer] Sync already in progress, skipping');
      return;
    }
    this.isSyncing = true;

    try {
      const contractAddress = this.contractLoader.getContractAddress('SecondaryMarket');
      if (!contractAddress) {
        // this.logger.warn('[P2P Indexer] SecondaryMarket contract not deployed/configured yet');
        return;
      }

      const abi = this.contractLoader.getContractAbi('SecondaryMarket');

      // Get last processed block from DB (by checking latest trade/order)
      const lastOrder = await this.orderModel.findOne().sort({ blockNumber: -1 });
      const lastTrade = await this.tradeModel.findOne().sort({ blockNumber: -1 });

      const lastProcessedBlock = Math.max(
        lastOrder?.blockNumber || 0,
        lastTrade?.blockNumber || 0
      );

      const currentBlock = Number(await this.publicClient.getBlockNumber());
      const fromBlock = lastProcessedBlock === 0 ? BigInt(currentBlock - 10000) : BigInt(lastProcessedBlock + 1);

      if (fromBlock > currentBlock) {
        // this.logger.debug('[P2P Indexer] Already synced to current block');
        return;
      }

      const totalBlocks = Number(currentBlock) - Number(fromBlock);
      // this.logger.log(`[P2P Indexer] Syncing events from block ${fromBlock} to ${currentBlock} (${totalBlocks} blocks)`);

      // CRITICAL FIX: RPC endpoint limits eth_getLogs to 10,000 blocks
      // Break into chunks to avoid 413 error
      const CHUNK_SIZE = 5000; // Use 5k to be safe (limit is 10k)
      let allLogs: any[] = [];
      let processedChunks = 0;

      for (let start = Number(fromBlock); start <= currentBlock; start += CHUNK_SIZE) {
        const end = Math.min(start + CHUNK_SIZE - 1, currentBlock);

        try {
          // this.logger.debug(`[P2P Indexer] Fetching chunk ${processedChunks + 1}: blocks ${start} to ${end}`);

          const chunkLogs = await this.publicClient.getContractEvents({
            address: contractAddress as `0x${string}`,
            abi,
            fromBlock: BigInt(start),
            toBlock: BigInt(end),
          });

          allLogs = allLogs.concat(chunkLogs);
          processedChunks++;

          if (chunkLogs.length > 0) {
            // this.logger.debug(`[P2P Indexer] Chunk ${processedChunks}: Found ${chunkLogs.length} events`);
          }
        } catch (chunkError: any) {
          // this.logger.error(`[P2P Indexer] Error fetching chunk ${start}-${end}: ${chunkError.message}`);
          // Continue with next chunk instead of failing entirely
        }
      }

      // this.logger.log(`[P2P Indexer] Found ${allLogs.length} total events across ${processedChunks} chunks`);

      for (const log of allLogs) {
        await this.processLog(log);
      }

      this.logger.log(`[P2P Indexer] ✅ Sync complete - processed ${allLogs.length} events`);

    } catch (error: any) {
      this.logger.error(`[P2P Indexer] ❌ Error syncing secondary market: ${error.message}`);
    } finally {
      this.isSyncing = false;
    }
  }

  private async processLog(log: any) {
    const { eventName, args, transactionHash, blockNumber, logIndex } = log;
    // this.logger.debug(`[P2P Indexer] Processing event: ${eventName} at block ${blockNumber}`);

    // Get timestamp
    const block = await this.publicClient.getBlock({ blockNumber });
    const timestamp = new Date(Number(block.timestamp) * 1000);

    if (eventName === 'OrderCreated') {
      await this.handleOrderCreated(args, transactionHash, Number(blockNumber), timestamp, Number(logIndex));
    } else if (eventName === 'OrderFilled') {
      await this.handleOrderFilled(args, transactionHash, Number(blockNumber), timestamp, Number(logIndex));
    } else if (eventName === 'OrderCancelled') {
      await this.handleOrderCancelled(args, transactionHash, Number(blockNumber), timestamp, Number(logIndex));
    }
  }

  private async handleOrderCreated(args: any, txHash: string, blockNumber: number, timestamp: Date, logIndex: number) {
    const { orderId, maker, tokenAddress, amount, pricePerToken, isBuy } = args;

    // Find Asset by token address (case-insensitive)
    const asset = await this.assetModel.findOne({ 'token.address': new RegExp(`^${tokenAddress}$`, 'i') });
    if (!asset) {
      this.logger.error(`[P2P Indexer] ❌ Asset not found for token: ${tokenAddress}. Skipping order creation.`);
      return;
    }
    const assetId = asset.assetId;

    const amountFormatted = (Number(amount) / 1e18).toFixed(2);
    const priceFormatted = (Number(pricePerToken) / 1e6).toFixed(2); // USDC is 6 decimals

    await this.orderModel.create({
      orderId: orderId.toString(),
      maker: maker.toLowerCase(),
      assetId,
      tokenAddress: tokenAddress.toLowerCase(),
      isBuy,
      initialAmount: amount.toString(),
      remainingAmount: amount.toString(),
      pricePerToken: pricePerToken.toString(),
      status: OrderStatus.OPEN,
      txHash,
      blockNumber,
      blockTimestamp: timestamp,
    });

    this.logger.log(`[P2P Indexer] ✅ Order Created: #${orderId} - ${isBuy ? 'BUY' : 'SELL'} ${amountFormatted} tokens @ ${priceFormatted} USDC - Asset: ${assetId}`);

    // CRITICAL: For SELL orders, create negative Purchase record to track tokens going into escrow
    if (!isBuy && asset) {
      try {
        const lockTxHash = `${txHash}-sell-lock`;

        // Check if Purchase record already exists (idempotency)
        const existingPurchase = await this.purchaseModel.findOne({ txHash: lockTxHash });
        if (existingPurchase) {
          this.logger.debug(`[P2P Indexer] Purchase record already exists for ${lockTxHash}, skipping`);
        } else {
          const negativeAmount = '-' + amount.toString();
          const estimatedValue = (BigInt(amount.toString()) * BigInt(pricePerToken.toString())) / BigInt(10 ** 18);

          await this.purchaseModel.create({
            txHash: lockTxHash,
            assetId,
            investorWallet: maker.toLowerCase(),
            tokenAddress: tokenAddress.toLowerCase(),
            amount: negativeAmount, // NEGATIVE to reduce balance
            price: pricePerToken.toString(),
            totalPayment: estimatedValue.toString(),
            blockNumber,
            blockTimestamp: timestamp,
            status: 'CONFIRMED',
            source: 'P2P_SELL_ORDER',
            p2pTradeId: `order-${orderId}`,
            metadata: {
              assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
              industry: asset.metadata?.industry,
              riskTier: asset.metadata?.riskTier,
            },
          });

          this.logger.log(`[P2P Indexer] ✅ Negative Purchase record created for seller (tokens locked): ${maker.substring(0, 8)}... - ${amountFormatted} tokens`);
        }
      } catch (error: any) {
        this.logger.error(`[P2P Indexer] Failed to create negative Purchase record: ${error.message}`);
      }
    }

    // Send notification to order creator
    try {
      await this.notificationService.create({
        userId: maker,
        walletAddress: maker,
        header: 'Order Created Successfully',
        detail: `Your ${isBuy ? 'buy' : 'sell'} order for ${amountFormatted} tokens at $${priceFormatted} has been created.`,
        type: NotificationType.ORDER_CREATED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId,
          orderId: orderId.toString(),
          isBuy,
          amount: amountFormatted,
          price: priceFormatted,
          txHash
        }
      });
      this.logger.log(`[P2P Indexer] ✅ Notification sent to maker: ${maker.substring(0, 8)}... for ORDER_CREATED`);
    } catch (error: any) {
      this.logger.error(`[P2P Indexer] ❌ Failed to send ORDER_CREATED notification to ${maker}: ${error.message}`);
    }

    // Real-time update
    this.sseService.emitToAll('orderbook_update', { assetId, type: 'create' });
  }

  private async handleOrderFilled(args: any, txHash: string, blockNumber: number, timestamp: Date, logIndex: number) {
    const { orderId, taker, maker, tokenAddress, amountFilled, totalCost, remainingAmount } = args;

    const amountFmt = (Number(amountFilled) / 1e18).toFixed(2);
    const costFmt = (Number(totalCost) / 1e6).toFixed(2);

    // this.logger.debug(`[P2P Indexer] Processing OrderFilled event: Order #${orderId}, Amount: ${amountFmt}, Cost: ${costFmt} USDC`);

    // Update Order
    const order = await this.orderModel.findOneAndUpdate(
      { orderId: orderId.toString() },
      {
        remainingAmount: remainingAmount.toString(),
        status: remainingAmount === 0n ? OrderStatus.FILLED : OrderStatus.OPEN,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!order) {
      // this.logger.warn(`[P2P Indexer] Order #${orderId} not found in database`);
      return;
    }

    // Create Trade Record
    const tradeId = `${txHash}-${logIndex}`; // Ensure uniqueness

    const trade = await this.tradeModel.create({
      tradeId,
      orderId: orderId.toString(),
      assetId: order.assetId,
      tokenAddress: tokenAddress.toLowerCase(),
      buyer: order.isBuy ? maker.toLowerCase() : taker.toLowerCase(),
      seller: order.isBuy ? taker.toLowerCase() : maker.toLowerCase(),
      amount: amountFilled.toString(),
      pricePerToken: order.pricePerToken,
      totalValue: totalCost.toString(),
      txHash,
      blockNumber,
      blockTimestamp: timestamp,
    });

    // this.logger.log(`[P2P Indexer] ✅ Order Filled: #${orderId} - ${amountFmt} tokens for ${costFmt} USDC - Buyer: ${trade.buyer.substring(0, 8)}..., Seller: ${trade.seller.substring(0, 8)}...`);

    // Track ownership change in Purchase records
    await this.trackOwnershipTransfer({
      buyer: trade.buyer,
      seller: trade.seller,
      assetId: order.assetId,
      tokenAddress: tokenAddress.toLowerCase(),
      amount: amountFilled.toString(),
      price: order.pricePerToken,
      totalPayment: totalCost.toString(),
      txHash,
      blockNumber,
      timestamp,
      tradeId: trade.tradeId,
    });

    // Notifications
    // Notify Maker
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
          orderId: orderId.toString(),
          amount: amountFmt,
          price: (Number(order.pricePerToken) / 1e6).toFixed(2),
          totalCost: costFmt,
          txHash,
          tradeId: trade.tradeId
        }
      });
      this.logger.log(`[P2P Indexer] ✅ Notification sent to maker: ${maker.substring(0, 8)}... for ORDER_FILLED`);
    } catch (error: any) {
      this.logger.error(`[P2P Indexer] ❌ Failed to send ORDER_FILLED notification to maker ${maker}: ${error.message}`);
    }

    // Notify Taker
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
          orderId: orderId.toString(),
          amount: amountFmt,
          price: (Number(order.pricePerToken) / 1e6).toFixed(2),
          totalCost: costFmt,
          txHash,
          tradeId: trade.tradeId
        }
      });
      this.logger.log(`[P2P Indexer] ✅ Notification sent to taker: ${taker.substring(0, 8)}... for ORDER_FILLED`);
    } catch (error: any) {
      this.logger.error(`[P2P Indexer] ❌ Failed to send ORDER_FILLED notification to taker ${taker}: ${error.message}`);
    }

    // Real-time update
    this.sseService.emitToAll('orderbook_update', { assetId: order.assetId, type: 'fill' });
  }

  private async handleOrderCancelled(args: any, txHash: string, blockNumber: number, timestamp: Date, logIndex: number) {
    const { orderId } = args;

    this.logger.debug(`[P2P Indexer] Processing OrderCancelled event: Order #${orderId}`);

    const order = await this.orderModel.findOneAndUpdate(
      { orderId: orderId.toString() },
      {
        status: OrderStatus.CANCELLED,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (order) {
      const remainingFmt = (Number(order.remainingAmount) / 1e18).toFixed(2);
      this.logger.log(`[P2P Indexer] ✅ Order Cancelled: #${orderId} - ${order.isBuy ? 'BUY' : 'SELL'} order, ${remainingFmt} tokens remaining, Asset: ${order.assetId}`);

      // CRITICAL: For cancelled SELL orders, reverse the negative Purchase record
      if (!order.isBuy && order.remainingAmount !== '0') {
        try {
          const cancelTxHash = `${txHash}-cancel-return`;

          // Check if Purchase record already exists (idempotency)
          const existingPurchase = await this.purchaseModel.findOne({ txHash: cancelTxHash });
          if (existingPurchase) {
            this.logger.debug(`[P2P Indexer] Cancel reversal record already exists for ${cancelTxHash}, skipping`);
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
              blockTimestamp: timestamp,
              status: 'CONFIRMED',
              source: 'P2P_ORDER_CANCELLED',
              p2pTradeId: `order-${orderId}`,
              metadata: asset ? {
                assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
                industry: asset.metadata?.industry,
                riskTier: asset.metadata?.riskTier,
              } : undefined,
            });

            this.logger.log(`[P2P Indexer] ✅ Cancel reversal record created: ${order.maker.substring(0, 8)}... - ${remainingFmt} tokens returned`);
          }
        } catch (error: any) {
          this.logger.error(`[P2P Indexer] Failed to create cancel reversal record: ${error.message}`);
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
            orderId: orderId.toString(),
            amount: remainingFmt,
            price: (Number(order.pricePerToken) / 1e6).toFixed(2),
            txHash
          }
        });
        this.logger.log(`[P2P Indexer] ✅ Notification sent to maker: ${order.maker.substring(0, 8)}... for ORDER_CANCELLED`);
      } catch (error: any) {
        this.logger.error(`[P2P Indexer] ❌ Failed to send ORDER_CANCELLED notification to ${order.maker}: ${error.message}`);
      }

      this.sseService.emitToAll('orderbook_update', { assetId: order.assetId, type: 'cancel' });
    } else {
      this.logger.warn(`[P2P Indexer] Order #${orderId} not found in database for cancellation`);
    }
  }

  /**
   * Track ownership transfer in Purchase records when P2P trade happens
   * Creates BOTH positive Purchase for buyer and negative Purchase for seller
   */
  private async trackOwnershipTransfer(params: {
    buyer: string;
    seller: string;
    assetId: string;
    tokenAddress: string;
    amount: string;
    price: string;
    totalPayment: string;
    txHash: string;
    blockNumber: number;
    timestamp: Date;
    tradeId: string;
  }) {
    try {
      this.logger.debug(`[P2P Indexer] Tracking ownership transfer - Seller: ${params.seller.substring(0, 8)}... -> Buyer: ${params.buyer.substring(0, 8)}...`);

      // Get asset metadata
      const asset = await this.assetModel.findOne({ assetId: params.assetId });
      const metadata = asset ? {
        assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
        industry: asset.metadata?.industry,
        riskTier: asset.metadata?.riskTier,
      } : undefined;

      const amountFmt = (Number(params.amount) / 1e18).toFixed(2);

      // Create positive Purchase for buyer (receives tokens)
      await this.purchaseModel.create({
        txHash: `${params.txHash}-buy`,
        assetId: params.assetId,
        investorWallet: params.buyer,
        tokenAddress: params.tokenAddress,
        amount: params.amount,
        price: params.price,
        totalPayment: params.totalPayment,
        blockNumber: params.blockNumber,
        blockTimestamp: params.timestamp,
        status: 'CONFIRMED',
        source: 'SECONDARY_MARKET',
        p2pTradeId: params.tradeId,
        metadata,
      });

      this.logger.log(`[P2P Indexer] ✅ Purchase record created for buyer: ${params.buyer.substring(0, 8)}... (+${amountFmt} tokens)`);

      // CRITICAL: Create negative Purchase for seller (sends tokens)
      // For SELL orders: this offsets the initial negative lock
      // For BUY orders: this creates the negative record for the seller (taker)
      const negativeAmount = '-' + params.amount;
      await this.purchaseModel.create({
        txHash: `${params.txHash}-sell`,
        assetId: params.assetId,
        investorWallet: params.seller,
        tokenAddress: params.tokenAddress,
        amount: negativeAmount, // NEGATIVE - tokens leaving seller
        price: params.price,
        totalPayment: params.totalPayment,
        blockNumber: params.blockNumber,
        blockTimestamp: params.timestamp,
        status: 'CONFIRMED',
        source: 'SECONDARY_MARKET',
        p2pTradeId: params.tradeId,
        metadata,
      });

      this.logger.log(`[P2P Indexer] ✅ Purchase record created for seller: ${params.seller.substring(0, 8)}... (-${amountFmt} tokens)`);

    } catch (error: any) {
      this.logger.error(`[P2P Indexer] ❌ Error tracking ownership transfer: ${error.message}`);
      // Don't fail the whole trade indexing if this fails
    }
  }
}
