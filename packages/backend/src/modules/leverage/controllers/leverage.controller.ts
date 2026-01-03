import { Controller, Post, Get, Body, Param, UseGuards, Request, Logger } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LeveragePositionService } from '../services/leverage-position.service';
import { FluxionDEXService } from '../services/fluxion-dex.service';
import { LeverageBlockchainService } from '../services/leverage-blockchain.service';
import { InitiateLeveragePurchaseDto, GetSwapQuoteDto, UnwindPositionDto } from '../dto/leverage.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@Controller('leverage')
@UseGuards(JwtAuthGuard)
export class LeverageController {
  private readonly logger = new Logger(LeverageController.name);

  constructor(
    private readonly positionService: LeveragePositionService,
    private readonly dexService: FluxionDEXService,
    private readonly blockchainService: LeverageBlockchainService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) {}

  /**
   * POST /leverage/initiate
   * Create a new leveraged position
   */
  @Post('initiate')
  async initiateLeveragePurchase(@Request() req: any, @Body() dto: InitiateLeveragePurchaseDto) {
    const userAddress = req.user.walletAddress;

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
      this.logger.log(`Price Per Token: ${dto.pricePerToken}`);
      this.logger.log(`mETH Collateral: ${dto.mETHCollateral}`);
      this.logger.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Calculate total USDC needed
      const tokenAmountBigInt = BigInt(dto.tokenAmount);
      const pricePerTokenBigInt = BigInt(dto.pricePerToken);
      const totalUSDCNeeded = (tokenAmountBigInt * pricePerTokenBigInt) / BigInt(10 ** 18);

      this.logger.log(`💰 Total USDC needed: ${totalUSDCNeeded.toString()} (${Number(totalUSDCNeeded) / 1e6} USDC)`);

      // Validate mETH collateral meets 150% LTV requirement
      const mETHCollateralBigInt = BigInt(dto.mETHCollateral);
      this.logger.log(`🔍 Calculating mETH collateral value...`);
      const mETHValueUSD = await this.dexService.calculateMETHValueUSD(mETHCollateralBigInt);
      const requiredCollateral = (totalUSDCNeeded * BigInt(150)) / BigInt(100);

      this.logger.log(`📈 mETH Collateral Value: ${mETHValueUSD.toString()} USDC wei (${Number(mETHValueUSD) / 1e6} USDC)`);
      this.logger.log(`📊 Required Collateral (150% LTV): ${requiredCollateral.toString()} USDC wei (${Number(requiredCollateral) / 1e6} USDC)`);

      if (mETHValueUSD < requiredCollateral) {
        this.logger.error(`❌ Insufficient collateral!`);
        this.logger.error(`   Required: ${Number(requiredCollateral) / 1e6} USDC worth`);
        this.logger.error(`   Provided: ${Number(mETHValueUSD) / 1e6} USDC worth`);
        throw new Error(
          `Insufficient collateral. Required: ${requiredCollateral.toString()} USDC worth of mETH, ` +
          `Provided: ${mETHValueUSD.toString()} USDC worth`,
        );
      }

      this.logger.log(`✅ Collateral validation passed`);

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
        mETHCollateral: dto.mETHCollateral,
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
        const newSold = (currentSold + tokenAmountBigInt).toString();
        
        await this.assetModel.updateOne(
          { assetId: dto.assetId },
          { $set: { 'listing.sold': newSold } }
        );
        
        const addedTokens = Number(tokenAmountBigInt) / 1e18;
        const totalTokens = Number(newSold) / 1e18;
        this.logger.log(`✅ Asset listing updated: +${addedTokens} tokens sold (New Total: ${totalTokens} tokens)`);
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
    } catch (error) {
      this.logger.error(`❌ Leverage purchase failed: ${error}`);
      this.logger.error(`Stack trace:`, error);
      this.logger.error(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      throw error;
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
