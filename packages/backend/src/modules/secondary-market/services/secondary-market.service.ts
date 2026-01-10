import { Injectable, NotFoundException, Logger, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { P2POrder, P2POrderDocument, OrderStatus } from '../../../database/schemas/p2p-order.schema';
import { P2PTrade, P2PTradeDocument } from '../../../database/schemas/p2p-trade.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { TokenBalanceService } from './token-balance.service';

@Injectable()
export class SecondaryMarketService {
  private readonly logger = new Logger(SecondaryMarketService.name);

  constructor(
    @InjectModel(P2POrder.name) private orderModel: Model<P2POrderDocument>,
    @InjectModel(P2PTrade.name) private tradeModel: Model<P2PTradeDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private contractLoader: ContractLoaderService,
    private tokenBalanceService: TokenBalanceService,
  ) { }

  /**
   * Get Orderbook (Bids and Asks) for an Asset
   * Enhanced with complete order details for frontend to fill orders
   */
  async getOrderBook(assetId: string) {
    this.logger.debug(`[P2P Service] Fetching orderbook for assetId: ${assetId}`);

    const orders = await this.orderModel.find({
      assetId,
      status: OrderStatus.OPEN,
      remainingAmount: { $ne: '0' },
    });

    this.logger.debug(`[P2P Service] Found ${orders.length} open orders for asset: ${assetId}`);

    const bids: any[] = [];
    const asks: any[] = [];

    // Enhanced: Group by price AND include order details
    const bidsByPrice = new Map<string, { totalAmount: bigint; orders: any[] }>();
    const asksByPrice = new Map<string, { totalAmount: bigint; orders: any[] }>();

    for (const order of orders) {
      const price = order.pricePerToken;
      const amount = BigInt(order.remainingAmount);

      // Format order details for frontend
      const orderDetail = {
        orderId: order.orderId,
        maker: order.maker,
        amount: order.remainingAmount,
        amountFormatted: (Number(order.remainingAmount) / 1e18).toFixed(4),
        priceFormatted: (Number(price) / 1e6).toFixed(2),
        timestamp: order.blockTimestamp,
        txHash: order.txHash,
      };

      if (order.isBuy) {
        const existing = bidsByPrice.get(price) || { totalAmount: 0n, orders: [] };
        existing.totalAmount += amount;
        existing.orders.push(orderDetail);
        bidsByPrice.set(price, existing);
      } else {
        const existing = asksByPrice.get(price) || { totalAmount: 0n, orders: [] };
        existing.totalAmount += amount;
        existing.orders.push(orderDetail);
        asksByPrice.set(price, existing);
      }
    }

    // Convert to sorted arrays with complete details
    // Bids: High to Low (buyers want highest bids first)
    Array.from(bidsByPrice.entries())
      .sort((a, b) => (BigInt(b[0]) > BigInt(a[0]) ? 1 : -1))
      .forEach(([price, data]) => {
        bids.push({
          price,
          priceFormatted: (Number(price) / 1e6).toFixed(2),
          amount: data.totalAmount.toString(),
          amountFormatted: (Number(data.totalAmount) / 1e18).toFixed(4),
          orderCount: data.orders.length,
          orders: data.orders.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        });
      });

    // Asks: Low to High (sellers want lowest asks first)
    Array.from(asksByPrice.entries())
      .sort((a, b) => (BigInt(a[0]) > BigInt(b[0]) ? 1 : -1))
      .forEach(([price, data]) => {
        asks.push({
          price,
          priceFormatted: (Number(price) / 1e6).toFixed(2),
          amount: data.totalAmount.toString(),
          amountFormatted: (Number(data.totalAmount) / 1e18).toFixed(4),
          orderCount: data.orders.length,
          orders: data.orders.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
        });
      });

    this.logger.log(`[P2P Service] Orderbook built - Bids: ${bids.length} levels (${bids.reduce((sum, b) => sum + b.orderCount, 0)} orders), Asks: ${asks.length} levels (${asks.reduce((sum, a) => sum + a.orderCount, 0)} orders)`);

    // Calculate spread
    const bestBid = bids[0]?.priceFormatted || '0';
    const bestAsk = asks[0]?.priceFormatted || '0';
    const spread = bestAsk && bestBid ? (parseFloat(bestAsk) - parseFloat(bestBid)).toFixed(2) : '0';

    return {
      assetId,
      bids,
      asks,
      summary: {
        totalBidOrders: bids.reduce((sum, b) => sum + b.orderCount, 0),
        totalAskOrders: asks.reduce((sum, a) => sum + a.orderCount, 0),
        totalBidLevels: bids.length,
        totalAskLevels: asks.length,
        bestBid,
        bestAsk,
        spread,
        lastUpdated: new Date().toISOString(),
      }
    };
  }

  /**
   * Get recent trades for an asset
   */
  async getTradeHistory(assetId: string, limit = 50) {
    this.logger.debug(`[P2P Service] Fetching trade history - Asset: ${assetId}, Limit: ${limit}`);
    const trades = await this.tradeModel.find({ assetId })
      .sort({ blockTimestamp: -1 })
      .limit(limit);
    this.logger.log(`[P2P Service] Retrieved ${trades.length} trades for asset: ${assetId}`);
    return trades;
  }

  /**
   * Get User's Active Orders
   */
  async getUserOrders(walletAddress: string) {
    this.logger.debug(`[P2P Service] Fetching active orders for user: ${walletAddress}`);
    const orders = await this.orderModel.find({
      maker: walletAddress.toLowerCase(),
    }).sort({ createdAt: -1 });
    this.logger.log(`[P2P Service] User ${walletAddress} has ${orders.length} active orders`);
    return orders;
  }

  /**
   * Get OHLCV Chart Data - Returns both Order Book (speculative) and Trade (actual) candlesticks
   * 
   * Returns two datasets:
   * 1. orderBookCandles: Based on order creation (shows market sentiment/liquidity intent)
   * 2. tradeCandles: Based on filled trades (shows actual executed prices)
   * 
   * Time intervals: '2m', '5m', '15m', '1h', '4h', '1d'
   */
  async getChartData(assetId: string, interval: string = '2m') {
    this.logger.debug(`[P2P Service] Generating chart data - Asset: ${assetId}, Interval: ${interval}`);

    // Determine time bucket size in milliseconds
    const intervalMs = this.getIntervalMilliseconds(interval);

    // Get order book candles (speculative - based on order creation)
    const orderBookCandles = await this.getOrderBookCandles(assetId, intervalMs);

    // Get trade candles (actual - based on filled trades)
    const tradeCandles = await this.getTradeCandles(assetId, intervalMs);

    this.logger.log(
      `[P2P Service] Chart data generated - ` +
      `OrderBook: ${orderBookCandles.length} candles, ` +
      `Trades: ${tradeCandles.length} candles, ` +
      `Interval: ${interval}`
    );

    return {
      interval,
      intervalMs,
      orderBookCandles,  // Speculative data from orders
      tradeCandles,      // Actual data from trades
      metadata: {
        orderBookDescription: 'Candlesticks based on order creation (market sentiment/liquidity)',
        tradeDescription: 'Candlesticks based on filled trades (actual executed prices)',
        note: 'Order book candles show where traders want to trade, trade candles show where they actually traded'
      }
    };
  }

  /**
   * Convert interval string to milliseconds
   */
  private getIntervalMilliseconds(interval: string): number {
    const intervals: { [key: string]: number } = {
      '2m': 2 * 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    const defaultInterval = 2 * 60 * 1000; // 2 minutes
    return intervals[interval] || defaultInterval;
  }

  /**
   * Generate Order Book Candles (Speculative)
   * Shows where traders WANT to trade based on order creation
   */
  private async getOrderBookCandles(assetId: string, intervalMs: number) {
    // Get all orders (including cancelled ones for historical context)
    const orders = await this.orderModel.find({ assetId })
      .sort({ blockTimestamp: 1 })
      .lean();

    if (orders.length === 0) {
      return [];
    }

    // Group orders into time buckets
    const buckets = new Map<number, any[]>();

    for (const order of orders) {
      const timestamp = new Date(order.blockTimestamp).getTime();
      const bucketTime = Math.floor(timestamp / intervalMs) * intervalMs;

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }
      buckets.get(bucketTime)!.push(order);
    }

    // Convert buckets to OHLCV candles
    const candles = [];
    for (const [bucketTime, bucketOrders] of Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])) {
      if (bucketOrders.length === 0) continue;

      const prices = bucketOrders.map(o => BigInt(o.pricePerToken));
      const volumes = bucketOrders.map(o => BigInt(o.initialAmount));

      const open = Number(BigInt(bucketOrders[0].pricePerToken)) / 1e6;
      const close = Number(BigInt(bucketOrders[bucketOrders.length - 1].pricePerToken)) / 1e6;
      const high = Number(prices.reduce((max, p) => p > max ? p : max)) / 1e6;
      const low = Number(prices.reduce((min, p) => p < min ? p : min)) / 1e6;
      const volume = Number(volumes.reduce((sum, v) => sum + v, 0n)) / 1e18;

      candles.push({
        time: Math.floor(bucketTime / 1000), // Unix timestamp in seconds
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: parseFloat(volume.toFixed(2)),
        orderCount: bucketOrders.length,
        buyOrders: bucketOrders.filter(o => o.isBuy).length,
        sellOrders: bucketOrders.filter(o => !o.isBuy).length,
      });
    }

    return candles;
  }

  /**
   * Generate Trade Candles (Actual)
   * Shows where trades ACTUALLY executed
   */
  private async getTradeCandles(assetId: string, intervalMs: number) {
    // Get all trades
    const trades = await this.tradeModel.find({ assetId })
      .sort({ blockTimestamp: 1 })
      .lean();

    if (trades.length === 0) {
      return [];
    }

    // Group trades into time buckets
    const buckets = new Map<number, any[]>();

    for (const trade of trades) {
      const timestamp = new Date(trade.blockTimestamp).getTime();
      const bucketTime = Math.floor(timestamp / intervalMs) * intervalMs;

      if (!buckets.has(bucketTime)) {
        buckets.set(bucketTime, []);
      }
      buckets.get(bucketTime)!.push(trade);
    }

    // Convert buckets to OHLCV candles
    const candles = [];
    for (const [bucketTime, bucketTrades] of Array.from(buckets.entries()).sort((a, b) => a[0] - b[0])) {
      if (bucketTrades.length === 0) continue;

      const prices = bucketTrades.map(t => BigInt(t.pricePerToken));
      const volumes = bucketTrades.map(t => BigInt(t.amount));
      const values = bucketTrades.map(t => BigInt(t.totalValue));

      const open = Number(BigInt(bucketTrades[0].pricePerToken)) / 1e6;
      const close = Number(BigInt(bucketTrades[bucketTrades.length - 1].pricePerToken)) / 1e6;
      const high = Number(prices.reduce((max, p) => p > max ? p : max)) / 1e6;
      const low = Number(prices.reduce((min, p) => p < min ? p : min)) / 1e6;
      const volume = Number(volumes.reduce((sum, v) => sum + v, 0n)) / 1e18;
      const totalValue = Number(values.reduce((sum, v) => sum + v, 0n)) / 1e6;

      candles.push({
        time: Math.floor(bucketTime / 1000), // Unix timestamp in seconds
        open: parseFloat(open.toFixed(2)),
        high: parseFloat(high.toFixed(2)),
        low: parseFloat(low.toFixed(2)),
        close: parseFloat(close.toFixed(2)),
        volume: parseFloat(volume.toFixed(2)),
        totalValue: parseFloat(totalValue.toFixed(2)),
        tradeCount: bucketTrades.length,
      });
    }

    return candles;
  }
  /**
   * Get transaction data for creating an order on-chain
   * Validates balance before returning tx data
   */
  async getCreateOrderTxData(params: {
    tokenAddress: string;
    amount: string;
    pricePerToken: string;
    isBuy: boolean;
  }, userAddress?: string) {
    this.logger.log(`[P2P Service] Preparing create order tx - Type: ${params.isBuy ? 'BUY' : 'SELL'}, Amount: ${params.amount}, Price: ${params.pricePerToken}`);

    // Find asset and validate trading is allowed
    const asset = await this.assetModel.findOne({ 'token.address': params.tokenAddress });
    if (!asset) {
      this.logger.error(`[P2P Service] Asset not found for token address: ${params.tokenAddress}`);
      throw new BadRequestException('Asset not found for this token address');
    }

    // CRITICAL: Prevent trading of settled assets
    if (asset.status === 'PAYOUT_COMPLETE') {
      this.logger.error(`[P2P Service] Trading blocked - Asset ${asset.assetId} has PAYOUT_COMPLETE status`);
      throw new BadRequestException('Cannot trade tokens from settled assets. This invoice has been paid out.');
    }

    // If selling, validate user has sufficient tradeable balance
    if (!params.isBuy && userAddress) {
      this.logger.debug(`[P2P Service] Validating sell order balance for user: ${userAddress}`);

      const validation = await this.tokenBalanceService.validateSufficientBalance(
        userAddress,
        asset.assetId,
        params.amount,
      );

      if (!validation.valid) {
        this.logger.warn(`[P2P Service] Balance validation failed for ${userAddress}: ${validation.reason}`);
        throw new BadRequestException(validation.reason || 'Insufficient balance');
      }

      this.logger.log(`[P2P Service] ✅ Validated sell order: User ${userAddress} has sufficient balance for ${asset.assetId}`);
    }
    const contractAddress = this.contractLoader.getContractAddress('SecondaryMarket');
    const abi = this.contractLoader.getContractAbi('SecondaryMarket');

    // Find the createOrder function
    const createOrderAbi = abi.find((item: any) => item.name === 'createOrder' && item.type === 'function');

    if (!createOrderAbi) {
      throw new Error('createOrder function not found in SecondaryMarket ABI');
    }

    this.logger.debug(`[P2P Service] Create order tx data prepared for contract: ${contractAddress}`);
    return {
      to: contractAddress,
      abi: [createOrderAbi],
      functionName: 'createOrder',
      args: [
        params.tokenAddress,
        params.amount,
        params.pricePerToken,
        params.isBuy,
      ],
    };
  }

  /**
   * Get transaction data for filling an order on-chain
   */
  async getFillOrderTxData(orderId: string, amountToFill: string) {
    this.logger.log(`[P2P Service] Preparing fill order tx - OrderId: ${orderId}, Amount: ${amountToFill}`);

    const contractAddress = this.contractLoader.getContractAddress('SecondaryMarket');
    const abi = this.contractLoader.getContractAbi('SecondaryMarket');

    const fillOrderAbi = abi.find((item: any) => item.name === 'fillOrder' && item.type === 'function');

    if (!fillOrderAbi) {
      throw new Error('fillOrder function not found in SecondaryMarket ABI');
    }

    this.logger.debug(`[P2P Service] Fill order tx data prepared for orderId: ${orderId}`);
    return {
      to: contractAddress,
      abi: [fillOrderAbi],
      functionName: 'fillOrder',
      args: [orderId, amountToFill],
    };
  }

  /**
   * Get transaction data for canceling an order on-chain
   */
  async getCancelOrderTxData(orderId: string) {
    this.logger.log(`[P2P Service] Preparing cancel order tx - OrderId: ${orderId}`);

    const contractAddress = this.contractLoader.getContractAddress('SecondaryMarket');
    const abi = this.contractLoader.getContractAbi('SecondaryMarket');

    const cancelOrderAbi = abi.find((item: any) => item.name === 'cancelOrder' && item.type === 'function');

    if (!cancelOrderAbi) {
      throw new Error('cancelOrder function not found in SecondaryMarket ABI');
    }

    this.logger.debug(`[P2P Service] Cancel order tx data prepared for orderId: ${orderId}`);
    return {
      to: contractAddress,
      abi: [cancelOrderAbi],
      functionName: 'cancelOrder',
      args: [orderId],
    };
  }

  /**
   * Get order details by orderId
   */
  async getOrderById(orderId: string) {
    this.logger.debug(`[P2P Service] Fetching order by ID: ${orderId}`);
    const order = await this.orderModel.findOne({ orderId });
    if (!order) {
      this.logger.warn(`[P2P Service] Order not found: ${orderId}`);
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    this.logger.debug(`[P2P Service] Order found - Type: ${order.isBuy ? 'BUY' : 'SELL'}, Status: ${order.status}`);
    return order;
  }

  /**
   * Get market statistics for an asset
   */
  async getMarketStats(assetId: string) {
    this.logger.debug(`[P2P Service] Calculating market stats for asset: ${assetId}`);

    // Get last trade
    const lastTrade = await this.tradeModel.findOne({ assetId }).sort({ blockTimestamp: -1 });

    // Get 24h trades
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentTrades = await this.tradeModel.find({
      assetId,
      blockTimestamp: { $gte: twentyFourHoursAgo },
    });

    this.logger.debug(`[P2P Service] Found ${recentTrades.length} trades in last 24h for asset: ${assetId}`);

    let volume24h = BigInt(0);
    let high24h = BigInt(0);
    let low24h = BigInt(Number.MAX_SAFE_INTEGER);
    let firstPrice = BigInt(0);

    if (recentTrades.length > 0 && recentTrades[0]) {
      firstPrice = BigInt(recentTrades[0].pricePerToken || '0');
      for (const trade of recentTrades) {
        volume24h += BigInt(trade.amount || '0');
        const price = BigInt(trade.pricePerToken || '0');
        if (price > high24h) high24h = price;
        if (price < low24h) low24h = price;
      }
    }

    const lastPrice = lastTrade ? BigInt(lastTrade.pricePerToken || '0') : BigInt(0);
    const priceChange24h = firstPrice > BigInt(0) ? lastPrice - firstPrice : BigInt(0);
    const priceChangePercent = firstPrice > BigInt(0)
      ? (Number(priceChange24h) / Number(firstPrice)) * 100
      : 0;

    const stats = {
      lastPrice: lastPrice.toString(),
      lastPriceFormatted: (Number(lastPrice) / 1e6).toFixed(2),
      priceChange24h: priceChange24h.toString(),
      priceChangePercent: priceChangePercent.toFixed(2),
      high24h: high24h === BigInt(0) ? '0' : high24h.toString(),
      low24h: low24h === BigInt(Number.MAX_SAFE_INTEGER) ? '0' : low24h.toString(),
      volume24h: volume24h.toString(),
      volume24hFormatted: (Number(volume24h) / 1e18).toFixed(2),
      trades24h: recentTrades.length,
    };

    this.logger.log(`[P2P Service] Market stats calculated - Last Price: ${stats.lastPriceFormatted}, 24h Volume: ${stats.volume24hFormatted}, 24h Trades: ${stats.trades24h}`);
    return stats;
  }
  /**
   * Get user's tradeable balance for an asset
   */
  async getUserTradeableBalance(userAddress: string, assetId: string) {
    this.logger.debug(`[P2P Service] Fetching tradeable balance - User: ${userAddress}, Asset: ${assetId}`);
    const balance = await this.tokenBalanceService.getTradeableBalance(userAddress, assetId);
    this.logger.log(`[P2P Service] Balance retrieved - Tradeable: ${balance.tradeableBalanceFormatted}, Locked: ${balance.lockedInOrders}`);
    return balance;
  }

  /**
   * Validate if user can create an order
   */
  async validateOrderCreation(params: {
    userAddress: string;
    assetId: string;
    amount: string;
    isBuy: boolean;
  }) {
    this.logger.debug(`[P2P Service] Validating order creation - User: ${params.userAddress}, Asset: ${params.assetId}, Type: ${params.isBuy ? 'BUY' : 'SELL'}`);

    // CRITICAL: Check if asset is settled (PAYOUT_COMPLETE)
    const asset = await this.assetModel.findOne({ assetId: params.assetId });
    if (!asset) {
      this.logger.error(`[P2P Service] Asset not found: ${params.assetId}`);
      return {
        valid: false,
        reason: 'Asset not found',
      };
    }

    if (asset.status === 'PAYOUT_COMPLETE') {
      this.logger.warn(`[P2P Service] Trading blocked - Asset ${params.assetId} has PAYOUT_COMPLETE status`);
      return {
        valid: false,
        reason: 'Cannot trade tokens from settled assets. This invoice has been paid out.',
      };
    }

    if (params.isBuy) {
      // For buy orders, user needs USDC (validated by contract)
      this.logger.debug(`[P2P Service] Buy order - USDC balance will be validated by contract`);
      return {
        valid: true,
        message: 'Buy order validation passed (USDC balance checked by contract)',
      };
    }

    // For sell orders, validate tradeable balance
    const validation = await this.tokenBalanceService.validateSufficientBalance(
      params.userAddress,
      params.assetId,
      params.amount,
    );

    if (!validation.valid) {
      this.logger.warn(`[P2P Service] Validation failed - ${validation.reason}`);
      return {
        valid: false,
        reason: validation.reason,
        balance: validation.balance,
      };
    }

    this.logger.log(`[P2P Service] ✅ Order validation passed for ${params.userAddress}`);
    return {
      valid: true,
      message: 'Sell order validation passed',
      balance: validation.balance,
    };
  }
}
