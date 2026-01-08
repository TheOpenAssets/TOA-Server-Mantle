import { Controller, Get, Post, Body, Param, Query, UseGuards, Req, Logger } from '@nestjs/common';
import { SecondaryMarketService } from '../services/secondary-market.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreateOrderDto } from '../dto/create-order.dto';
import { FillOrderDto } from '../dto/fill-order.dto';
import { CancelOrderDto } from '../dto/cancel-order.dto';

@Controller('marketplace/secondary')
export class SecondaryMarketController {
  private readonly logger = new Logger(SecondaryMarketController.name);

  constructor(private readonly secondaryMarketService: SecondaryMarketService) { }

  @Get(':assetId/orderbook')
  async getOrderBook(@Param('assetId') assetId: string) {
    this.logger.log(`[P2P] Fetching orderbook for asset: ${assetId}`);
    const result = await this.secondaryMarketService.getOrderBook(assetId);
    this.logger.debug(`[P2P] Orderbook fetched - Bids: ${result.bids.length}, Asks: ${result.asks.length}`);
    return result;
  }

  @Get(':assetId/trades')
  async getTradeHistory(
    @Param('assetId') assetId: string,
    @Query('limit') limit?: string,
  ) {
    const limitValue = limit ? parseInt(limit) : 50;
    this.logger.log(`[P2P] Fetching trade history for asset: ${assetId}, limit: ${limitValue}`);
    const trades = await this.secondaryMarketService.getTradeHistory(assetId, limitValue);
    this.logger.debug(`[P2P] Retrieved ${trades.length} trades for asset: ${assetId}`);
    return trades;
  }

  @Get(':assetId/chart')
  async getChartData(
    @Param('assetId') assetId: string,
    @Query('interval') interval: string = '1h',
  ) {
    this.logger.log(`[P2P] Fetching chart data for asset: ${assetId}, interval: ${interval}`);
    const chartData = await this.secondaryMarketService.getChartData(assetId, interval);
    this.logger.debug(`[P2P] Chart data retrieved - ${chartData.length} data points`);
    return chartData;
  }

  @Get(':assetId/stats')
  async getMarketStats(@Param('assetId') assetId: string) {
    this.logger.log(`[P2P] Fetching market stats for asset: ${assetId}`);
    const stats = await this.secondaryMarketService.getMarketStats(assetId);
    this.logger.debug(`[P2P] Market stats - Price: ${stats.lastPriceFormatted}, Volume24h: ${stats.volume24hFormatted}`);
    return stats;
  }

  @Get('orders/user')
  @UseGuards(JwtAuthGuard)
  async getUserOrders(@Req() req: any) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Fetching user orders for: ${walletAddress}`);
    const orders = await this.secondaryMarketService.getUserOrders(walletAddress);
    this.logger.debug(`[P2P] User ${walletAddress} has ${orders.length} active orders`);
    return orders;
  }

  @Get('orders/:orderId')
  async getOrderById(@Param('orderId') orderId: string) {
    this.logger.log(`[P2P] Fetching order details for orderId: ${orderId}`);
    const order = await this.secondaryMarketService.getOrderById(orderId);
    this.logger.debug(`[P2P] Order ${orderId} - Type: ${order.isBuy ? 'BUY' : 'SELL'}, Remaining: ${order.remainingAmount}`);
    return order;
  }

  @Post('tx/create-order')
  @UseGuards(JwtAuthGuard)
  async getCreateOrderTxData(@Body() dto: CreateOrderDto, @Req() req: any) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Creating order transaction - User: ${walletAddress}, Type: ${dto.isBuy ? 'BUY' : 'SELL'}, Amount: ${dto.amount}`);
    const txData = await this.secondaryMarketService.getCreateOrderTxData(dto, walletAddress);
    this.logger.debug(`[P2P] Order transaction prepared for ${walletAddress}`);
    return txData;
  }

  @Post('tx/fill-order')
  @UseGuards(JwtAuthGuard)
  async getFillOrderTxData(@Body() dto: FillOrderDto, @Req() req: any) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Filling order - User: ${walletAddress}, OrderId: ${dto.orderId}, Amount: ${dto.amountToFill}`);
    const txData = await this.secondaryMarketService.getFillOrderTxData(dto.orderId, dto.amountToFill);
    this.logger.debug(`[P2P] Fill order transaction prepared for orderId: ${dto.orderId}`);
    return txData;
  }

  @Post('tx/cancel-order')
  @UseGuards(JwtAuthGuard)
  async getCancelOrderTxData(@Body() dto: CancelOrderDto, @Req() req: any) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Cancelling order - User: ${walletAddress}, OrderId: ${dto.orderId}`);
    const txData = await this.secondaryMarketService.getCancelOrderTxData(dto.orderId);
    this.logger.debug(`[P2P] Cancel order transaction prepared for orderId: ${dto.orderId}`);
    return txData;
  }

  @Get(':assetId/my-balance')
  @UseGuards(JwtAuthGuard)
  async getMyBalance(@Param('assetId') assetId: string, @Req() req: any) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Fetching balance for user: ${walletAddress}, asset: ${assetId}`);
    const balance = await this.secondaryMarketService.getUserTradeableBalance(walletAddress, assetId);
    this.logger.debug(`[P2P] Balance - Wallet: ${balance.walletBalanceFormatted}, Tradeable: ${balance.tradeableBalanceFormatted}`);
    return balance;
  }

  @Post('validate-order')
  @UseGuards(JwtAuthGuard)
  async validateOrder(
    @Body() dto: { assetId: string; amount: string; isBuy: boolean },
    @Req() req: any,
  ) {
    const walletAddress = req.user.walletAddress;
    this.logger.log(`[P2P] Validating order - User: ${walletAddress}, Asset: ${dto.assetId}, Type: ${dto.isBuy ? 'BUY' : 'SELL'}, Amount: ${dto.amount}`);
    const validation = await this.secondaryMarketService.validateOrderCreation({
      userAddress: walletAddress,
      assetId: dto.assetId,
      amount: dto.amount,
      isBuy: dto.isBuy,
    });
    this.logger.debug(`[P2P] Validation result - Valid: ${validation.valid}${validation.valid ? '' : ', Reason: ' + validation.reason}`);
    return validation;
  }
}
