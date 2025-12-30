import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { LeveragePositionService } from '../services/leverage-position.service';
import { FluxionDEXService } from '../services/fluxion-dex.service';
import { LeverageBlockchainService } from '../services/leverage-blockchain.service';
import { InitiateLeveragePurchaseDto, GetSwapQuoteDto, UnwindPositionDto } from '../dto/leverage.dto';

@Controller('leverage')
@UseGuards(JwtAuthGuard)
export class LeverageController {
  constructor(
    private readonly positionService: LeveragePositionService,
    private readonly dexService: FluxionDEXService,
    private readonly blockchainService: LeverageBlockchainService,
  ) {}

  /**
   * POST /leverage/initiate
   * Create a new leveraged position
   */
  @Post('initiate')
  async initiateLeveragePurchase(@Request() req: any, @Body() dto: InitiateLeveragePurchaseDto) {
    const userAddress = req.user.wallet;

    // Calculate total USDC needed
    const tokenAmountBigInt = BigInt(dto.tokenAmount);
    const pricePerTokenBigInt = BigInt(dto.pricePerToken);
    const totalUSDCNeeded = (tokenAmountBigInt * pricePerTokenBigInt) / BigInt(10 ** 18);

    // Validate mETH collateral meets 150% LTV requirement
    const mETHCollateralBigInt = BigInt(dto.mETHCollateral);
    const mETHValueUSD = await this.dexService.calculateMETHValueUSD(mETHCollateralBigInt);
    const requiredCollateral = (totalUSDCNeeded * BigInt(150)) / BigInt(100);

    if (mETHValueUSD < requiredCollateral) {
      throw new Error(
        `Insufficient collateral. Required: ${requiredCollateral.toString()} USDC worth of mETH, ` +
        `Provided: ${mETHValueUSD.toString()} USDC worth`,
      );
    }

    // Create leverage position on-chain
    const result = await this.blockchainService.createPosition({
      user: userAddress,
      mETHAmount: mETHCollateralBigInt,
      usdcToBorrow: totalUSDCNeeded,
      rwaToken: dto.tokenAddress,
      rwaTokenAmount: tokenAmountBigInt,
      assetId: dto.assetId,
    });

    // Wait for transaction and get position ID
    if (!result.positionId) {
      throw new Error('Failed to extract position ID from transaction');
    }

    // Calculate initial LTV and health factor
    const initialLTV = Number((totalUSDCNeeded * BigInt(10000)) / mETHValueUSD);
    const healthFactor = Number((mETHValueUSD * BigInt(10000)) / totalUSDCNeeded);

    // Create position record in database
    const position = await this.positionService.createPosition({
      positionId: result.positionId,
      userAddress,
      assetId: dto.assetId,
      rwaTokenAddress: dto.tokenAddress,
      rwaTokenAmount: dto.tokenAmount,
      mETHCollateral: dto.mETHCollateral,
      usdcBorrowed: totalUSDCNeeded.toString(),
      initialLTV,
      currentHealthFactor: healthFactor,
    });

    return {
      success: true,
      positionId: result.positionId,
      transactionHash: result.hash,
      position,
      message: 'Leveraged position created successfully',
    };
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
    const userAddress = req.user.wallet;
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
    const userAddress = req.user.wallet;
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
