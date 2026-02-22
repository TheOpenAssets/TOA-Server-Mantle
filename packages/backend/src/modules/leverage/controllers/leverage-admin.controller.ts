import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Inject,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { PRICE_SERVICE } from '../leverage.constants';
import { LeverageBlockchainService } from '../services/leverage-blockchain.service';
import { LeveragePositionService } from '../services/leverage-position.service';

@Controller('admin/leverage')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class LeverageAdminController {
  private readonly logger = new Logger(LeverageAdminController.name);

  constructor(
    @Inject(PRICE_SERVICE) private priceService: { 
      setTestPrice: (price: number) => void; 
      getCurrentPrice: () => Promise<bigint>; 
      resetTestPrice: () => void;
    },
    private leverageBlockchainService: LeverageBlockchainService,
    private leveragePositionService: LeveragePositionService,
  ) {}

  /**
   * Manually update mETH price (for testing liquidation scenarios)
   */
  @Post('update-collateral-price')
  @HttpCode(HttpStatus.OK)
  async updateCollateralPrice(@Body('price') price: string) {
    if (!price) {
      throw new Error('Price is required');
    }

    const priceNumber = parseFloat(price);
    if (isNaN(priceNumber) || priceNumber <= 0) {
      throw new Error('Invalid price value');
    }

    this.logger.warn(`⚠️ Manual collateral price update requested: $${price}`);
    
    // Convert to 6 decimals (USDC format)
    const priceInUSDC = Math.floor(priceNumber * 1e6);
    
    // Update price in service (works for both mETH and stARB)
    this.priceService.setTestPrice(priceInUSDC);

    this.logger.log(`✅ Collateral price manually set to: $${price} (${priceInUSDC} USDC)`);
    this.logger.warn('⚠️ This price will be used for liquidations and health checks');
    this.logger.warn('⚠️ Remember: The DEX still uses its own price for actual swaps!');

    return {
      success: true,
      price: price,
      priceInUSDC: priceInUSDC.toString(),
      message: 'Collateral price updated successfully',
      warning: 'DEX may use different price for actual swaps',
    };
  }

  /**
   * Get current collateral price (mETH or stARB depending on network)
   */
  @Post('get-collateral-price')
  @HttpCode(HttpStatus.OK)
  async getCollateralPrice() {
    const currentPrice = await this.priceService.getCurrentPrice();
    const priceInUSD = Number(currentPrice) / 1e6;

    return {
      success: true,
      price: priceInUSD.toString(),
      priceInUSDC: currentPrice.toString(),
      formatted: `$${priceInUSD.toFixed(2)}`,
    };
  }

  /**
   * Reset collateral price to automatic updates
   */
  @Post('reset-collateral-price')
  @HttpCode(HttpStatus.OK)
  async resetCollateralPrice() {
    this.logger.warn('⚠️ Resetting collateral price to automatic CSV updates');
    
    this.priceService.resetTestPrice();

    this.logger.log('✅ Collateral price reset to automatic mode');

    return {
      success: true,
      message: 'Collateral price reset to automatic updates',
    };
  }

  /**
   * Manually settle a liquidated position
   * Burns RWA tokens, repays debt, takes 10% liquidation fee
   */
  @Post('settle-liquidation/:positionId')
  @HttpCode(HttpStatus.OK)
  async settleLiquidation(@Param('positionId') positionIdStr: string) {
    const positionId = parseInt(positionIdStr, 10);
    
    if (isNaN(positionId)) {
      throw new Error('Invalid position ID');
    }

    this.logger.warn(`⚠️ Manual liquidation settlement requested for position ${positionId}`);

    // Check position exists and is liquidated
    const position = await this.leveragePositionService.getPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    if (position.status !== 'LIQUIDATED') {
      throw new Error(`Position ${positionId} is not in LIQUIDATED status (current: ${position.status})`);
    }

    this.logger.log(`🔥 Settling liquidation for position ${positionId}...`);

    try {
      // Call blockchain service to settle
      const result = await this.leverageBlockchainService.settleLiquidation(positionId);

      this.logger.log(`✅ Liquidation settled successfully:`);
      this.logger.log(`   💰 Yield from RWA: ${Number(result.yieldReceived) / 1e6} USDC`);
      this.logger.log(`   💳 Debt Repaid: ${Number(result.debtRepaid) / 1e6} USDC`);
      this.logger.log(`   ⚠️ Liquidation Fee (10%): ${Number(result.liquidationFee) / 1e6} USDC → Admin`);
      this.logger.log(`   💵 User Refund: ${Number(result.userRefund) / 1e6} USDC`);
      this.logger.log(`   TX: ${result.hash}`);

      // Update database
      await this.leveragePositionService.updateLiquidationSettlement(positionId, {
        yieldReceived: result.yieldReceived.toString(),
        debtRepaid: result.debtRepaid.toString(),
        liquidationFee: result.liquidationFee.toString(),
        userRefund: result.userRefund.toString(),
        transactionHash: result.hash,
      });

      return {
        success: true,
        positionId,
        yieldReceived: result.yieldReceived.toString(),
        debtRepaid: result.debtRepaid.toString(),
        liquidationFee: result.liquidationFee.toString(),
        userRefund: result.userRefund.toString(),
        transactionHash: result.hash,
        message: 'Liquidation settled successfully',
      };
    } catch (error: any) {
      this.logger.error(`❌ Failed to settle liquidation: ${error.message}`);
      throw error;
    }
  }
}
