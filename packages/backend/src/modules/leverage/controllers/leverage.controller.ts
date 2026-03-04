import { Controller, Post, Get, Body, Param, UseGuards, Request, Logger, Inject, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LeveragePositionService } from '../services/leverage-position.service';
import { LeverageBlockchainService } from '../services/leverage-blockchain.service';
import { InitiateLeveragePurchaseDto } from '../dto/leverage.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { DEX_SERVICE, PRICE_SERVICE } from '../leverage.constants';
import { fromCanonical } from '../../blockchain/utils/numeric-conversion';

@Controller('leverage')
@UseGuards(JwtAuthGuard)
export class LeverageController {
  private readonly logger = new Logger(LeverageController.name);
  private readonly pendingPurchases = new Set<string>();

  constructor(
    private readonly positionService: LeveragePositionService,
    @Inject(DEX_SERVICE) private readonly dexService: { calculateMETHValueUSD: (amount: bigint) => Promise<bigint>; getMETHPrice: () => Promise<bigint>; getQuote: (amount: bigint) => Promise<bigint> },
    @Inject(PRICE_SERVICE) private readonly priceService: { getCurrentPriceUSD: () => number; getPriceChartData: (days?: number) => { date: string; price: number }[]; getStats: () => { current: number; min: number; max: number; avg: number; changePercent: number } },
    private readonly blockchainService: LeverageBlockchainService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) { }

  /**
   * POST /leverage/initiate
   * Create a new leveraged position
   */
  @Post('initiate')
  async initiateLeveragePurchase(@Request() req: any, @Body() dto: InitiateLeveragePurchaseDto) {
    const userAddress = req.user.walletAddress;
    const lockKey = `${userAddress}:${dto.assetId}:${dto.tokenAmount}:${dto.pricePerToken}:${dto.collateral}`;

    if (this.pendingPurchases.has(lockKey)) {
      this.logger.warn(`Duplicate leverage initiate blocked for ${lockKey}`);
      throw new Error('Leverage purchase already in progress for this request payload');
    }

    this.pendingPurchases.add(lockKey);
    this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    this.logger.log(`📊 Leverage Purchase Request Received`);
    this.logger.log(`User: ${userAddress}`);
    this.logger.log(`Asset ID: ${dto.assetId}`);
    

    try {
      // Fetch Asset to get correct token address
      const asset = await this.assetModel.findOne({ assetId: dto.assetId });
      if (!asset) {
        throw new Error(`Asset ${dto.assetId} not found`);
      }
      if (!asset.token?.address) {
        throw new Error(`Asset ${dto.assetId} has no token address registered`);
      }

      const rwaTokenAddress = asset.token.address;
      this.logger.log(`Token Address (DB): ${rwaTokenAddress}`);
      if (dto.tokenAddress && dto.tokenAddress.toLowerCase() !== rwaTokenAddress.toLowerCase()) {
        this.logger.warn(`⚠️ Request token address ${dto.tokenAddress} mismatch with DB ${rwaTokenAddress}. Using DB value.`);
      }

      this.logger.log(`Token Amount: ${dto.tokenAmount}`);
      this.logger.log(`Price Per Token (request): ${dto.pricePerToken}`);
      this.logger.log(`mETH Collateral: ${dto.collateral}`);
      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Get actual on-chain listing price (single source of truth)
      this.logger.log(`🔍 Reading actual price from on-chain listing...`);
      const onChainListing = await this.blockchainService.getOnChainListing(dto.assetId);
      const actualPricePerToken = onChainListing.staticPrice;

      this.logger.log(`💰 On-chain price per token: ${actualPricePerToken} USDC wei (${Number(actualPricePerToken) / 1e6} USDC)`);

      if (dto.pricePerToken && fromCanonical(dto.pricePerToken, 6) !== actualPricePerToken) {
        this.logger.warn(`⚠️  Price mismatch! Request: ${dto.pricePerToken}, On-chain: ${actualPricePerToken}. Using on-chain value.`);
      }

      // Calculate total USDC needed using ACTUAL on-chain price
      // tokenAmount is human-readable (e.g. "100.0000"), convert to wei (18 decimals)
      const tokenAmountBigInt = fromCanonical(dto.tokenAmount, 18);
      const pricePerTokenBigInt = actualPricePerToken;
      const totalUSDCNeeded = (tokenAmountBigInt * pricePerTokenBigInt) / BigInt(10 ** 18);

      this.logger.log(`💰 Total USDC needed: ${totalUSDCNeeded.toString()} (${Number(totalUSDCNeeded) / 1e6} USDC)`);

      // Collateral: if user provides 0, auto-calculate minimum 150% LTV from position size.
      // On Arbitrum the platform wallet provides stARB from its reserves, not the user.
      const requiredCollateralUSDC = (totalUSDCNeeded * BigInt(150)) / BigInt(100);
      let mETHCollateralBigInt = fromCanonical(dto.collateral, 18);

      if (mETHCollateralBigInt === 0n) {
        // Convert required USDC (6 decimals) to stARB (18 decimals) using current price.
        // Use ceiling division so the contract's own LTV check (stARB * price / 1e30 >= required)
        // never fails due to rounding: ceil(a/b) = (a + b - 1) / b
        // Also use 10n**18n instead of BigInt(1e18) — 1e18 > MAX_SAFE_INTEGER so BigInt() is unsafe.
        const collateralPriceUSDC = BigInt(Math.floor(this.priceService.getCurrentPriceUSD() * 1e6));
        const numerator = requiredCollateralUSDC * (10n ** 18n);
        mETHCollateralBigInt = (numerator + collateralPriceUSDC - 1n) / collateralPriceUSDC; // ceiling
        this.logger.log(
          `ℹ️  No collateral provided — auto-calculated ${Number(mETHCollateralBigInt) / 1e18} stARB ` +
          `($${Number(requiredCollateralUSDC) / 1e6} @ $${Number(collateralPriceUSDC) / 1e6}/stARB)`,
        );
      }

      this.logger.log(`🔍 Calculating collateral value...`);
      const mETHValueUSD = await this.dexService.calculateMETHValueUSD(mETHCollateralBigInt);

      this.logger.log(`📈 Collateral Value: ${mETHValueUSD.toString()} USDC wei (${Number(mETHValueUSD) / 1e6} USDC)`);
      this.logger.log(`📊 Required Collateral (150% LTV): ${requiredCollateralUSDC.toString()} USDC wei (${Number(requiredCollateralUSDC) / 1e6} USDC)`);

      this.logger.log(`✅ Collateral set`);

      // Get current mETH price for contract (6 decimals USDC wei format)
      const mETHPriceUSD = await this.dexService.getMETHPrice();
      this.logger.log(`💵 Current mETH price: $${Number(mETHPriceUSD) / 1e6}`);

      // Create leverage position on-chain
      this.logger.log(`🔗 Creating position on blockchain...`);
      const result = await this.blockchainService.createPosition({
        user: userAddress,
        mETHAmount: mETHCollateralBigInt,
        usdcToBorrow: totalUSDCNeeded,
        rwaToken: rwaTokenAddress, // Use DB value
        rwaTokenAmount: tokenAmountBigInt,
        assetId: dto.assetId,
        mETHPriceUSD, // Pass mETH price from backend
      });

      this.logger.log(`✅ Blockchain transaction submitted: ${result.hash}`);

      // Wait for transaction and get position ID
      if (!result.positionId) {
        this.logger.error(`❌ Failed to extract position ID from transaction`);
        throw new Error('Failed to extract position ID from transaction');
      }

      this.logger.log(`🆔 Position ID: ${result.positionId}`);

      // Calculate initial LTV and health factor
      const initialLTV = Number((totalUSDCNeeded * BigInt(10000)) / mETHValueUSD);
      const healthFactor = Number((mETHValueUSD * BigInt(10000)) / totalUSDCNeeded);

      this.logger.log(`📊 Initial LTV: ${(initialLTV / 100).toFixed(2)}%`);
      this.logger.log(`💚 Initial Health Factor: ${(healthFactor / 100).toFixed(2)}%`);

      // Create position record in database
      this.logger.log(`💾 Saving position to database...`);
      const position = await this.positionService.createPosition({
        positionId: result.positionId,
        userAddress,
        assetId: dto.assetId,
        rwaTokenAddress: rwaTokenAddress, // Use DB value
        rwaTokenAmount: dto.tokenAmount,
        mETHCollateral: dto.collateral,
        usdcBorrowed: totalUSDCNeeded.toString(),
        initialLTV,
        currentHealthFactor: healthFactor,
      });

      this.logger.log(`✅ Position created successfully!`);

      // Update asset listing sold count
      this.logger.log(`📊 Updating asset listing sold count...`);

      // We already fetched asset above
      if (asset && asset.listing) {
        const currentSold = BigInt(asset.listing.sold || '0');
        this.logger.log(`Current sold: ${currentSold.toString()}`);
        const newSold = (currentSold + tokenAmountBigInt).toString();

        await this.assetModel.updateOne(
          { assetId: dto.assetId },
          { $set: { 'listing.sold': newSold } }
        );

        const addedTokens = Number(tokenAmountBigInt) / 1e18;
        const totalTokens = Number(newSold) / 1e18;

        const asset2 = await this.assetModel.findOne({ assetId: dto.assetId });
        const updatedSold = asset2?.listing?.sold ?? newSold;
        this.logger.log(`Added tokens sold: ${addedTokens}, Total sold: ${totalTokens}, newSold DB Value: ${newSold}`);
        if (asset2?.listing) {
          this.logger.log(`✅ Asset listing updated: +${addedTokens} tokens sold (New Total: ${updatedSold} tokens)`);
        } else {
          this.logger.warn(`⚠️ Unable to verify updated listing sold count for asset ${dto.assetId}; listing missing after update`);
        }
      } else {
        this.logger.warn(`⚠️ Asset ${dto.assetId} has no listing, skipping sold count update`);
      }

      this.logger.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      return {
        success: true,
        positionId: result.positionId,
        transactionHash: result.hash,
        position,
        message: 'Leveraged position created successfully',
      };
    } catch (error: any) {
      // Gracefully handle slow finality / missing receipt while tx is actually broadcasted
      if (typeof error?.message === 'string' && error.message.includes('TransactionReceiptNotFoundError')) {
        const txMatch = error.message.match(/hash "([^"]+)"/);
        const txHash = txMatch ? txMatch[1] : undefined;
        this.logger.warn(`⚠️ Receipt not found yet. Checking DB before returning pending for tx ${txHash || 'unknown'}`);

        // Small wait and DB check for a recently created position (in case the tx confirmed but receipt lagged)
        await new Promise(resolve => setTimeout(resolve, 3000));
        const latest = await this.positionService.getLatestPositionForUserAsset(userAddress, dto.assetId);

        if (latest) {
          this.logger.log(`✅ Found recently indexed position ${latest.positionId} for user ${userAddress}, returning success.`);
          return {
            success: true,
            positionId: latest.positionId,
            transactionHash: latest.settlementTxHash || txHash,
            position: latest,
            message: 'Position created (confirmed after delayed receipt).',
          };
        }

        return {
          success: true,
          pending: true,
          positionCreated: false,
          transactionHash: txHash,
          message: 'Transaction broadcasted; confirmation pending. If this tx later reverts, no position will be created and you should retry.',
        };
      }

      this.logger.error(`❌ Leverage purchase failed: ${error}`);
      this.logger.error(`Stack trace:`, error);
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      throw error;
    } finally {
      this.pendingPurchases.delete(lockKey);
    }
  }

  /**
   * GET /leverage/position/:id
   * Get position details by ID
   */
  @Get('position/:id')
  async getPosition(@Param('id') positionId: string) {
    const position = await this.positionService.getPosition(parseInt(positionId));

    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Get current health factor from blockchain
    const healthFactor = await this.blockchainService.getHealthFactor(parseInt(positionId));
    const outstandingDebt = await this.blockchainService.getOutstandingDebt(parseInt(positionId));

    return {
      position,
      currentHealthFactor: healthFactor,
      outstandingDebt: outstandingDebt.toString(),
    };
  }

  /**
   * GET /leverage/positions/my
   * Get authenticated user's positions
   */
  @Get('positions/my')
  async getMyPositions(@Request() req: any) {
    const userAddress = req.user.walletAddress;
    const positions = await this.positionService.getUserPositions(userAddress);

    return {
      positions,
      count: positions.length,
    };
  }

  /**
   * GET /leverage/positions/user/:address
   * Get positions for a specific user (admin/public)
   */
  @Get('positions/user/:address')
  async getUserPositions(@Param('address') userAddress: string) {
    const positions = await this.positionService.getUserPositions(userAddress);

    return {
      userAddress,
      positions,
      count: positions.length,
    };
  }

  /**
   * GET /leverage/quote/:mETHAmount
   * Get swap quote for mETH amount
   */
  @Get('quote/:mETHAmount')
  async getSwapQuote(@Param('mETHAmount') mETHAmount: string) {
    const mETHBigInt = BigInt(mETHAmount);
    const usdcOut = await this.dexService.getQuote(mETHBigInt);

    return {
      mETHAmount,
      expectedUSDC: usdcOut.toString(),
      expectedUSDCFormatted: `${Number(usdcOut) / 1e6} USDC`,
    };
  }

  /**
   * GET /leverage/meth-price
   * Get current mETH price in USD
   */
  @Get('meth-price')
  async getMETHPrice() {
    const price = await this.dexService.getMETHPrice();

    return {
      price: price.toString(),
      priceFormatted: `$${Number(price)}`,
    };
  }

  /**
   * GET /leverage/stARB-price
   * Get current stARB price, chart data, and stats
   */
  @Get('stARB-price')
  async getStARBPrice(@Query('days') days?: string) {
    const chartDays = days ? parseInt(days, 10) : 30;
    const priceUSD = this.priceService.getCurrentPriceUSD();
    const chartData = this.priceService.getPriceChartData(chartDays);
    const stats = this.priceService.getStats();

    return {
      price: Math.floor(priceUSD * 1e6).toString(),
      priceUSD,
      priceFormatted: `$${priceUSD.toFixed(4)}`,
      chartData,
      stats,
    };
  }

  /**
   * POST /leverage/unwind/:id
   * Manually unwind/close a position (future feature)
   */
  @Post('unwind/:id')
  async unwindPosition(@Request() req: any, @Param('id') positionId: string) {
    const userAddress = req.user.walletAddress;
    const position = await this.positionService.getPosition(parseInt(positionId));

    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    if (position.userAddress !== userAddress) {
      throw new Error('Unauthorized: You do not own this position');
    }

    // TODO: Implement manual unwind logic
    // This would involve:
    // 1. Selling RWA tokens (if possible)
    // 2. Swapping mETH to USDC
    // 3. Repaying loan
    // 4. Returning remaining collateral to user

    throw new Error('Manual position unwind not yet implemented');
  }
}
