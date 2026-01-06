import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';
import { MethPriceService } from '../../blockchain/services/meth-price.service';

@Controller('admin/leverage')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class LeverageAdminController {
  private readonly logger = new Logger(LeverageAdminController.name);

  constructor(private methPriceService: MethPriceService) {}

  /**
   * Manually update mETH price (for testing liquidation scenarios)
   */
  @Post('update-meth-price')
  @HttpCode(HttpStatus.OK)
  async updateMethPrice(@Body('price') price: string) {
    if (!price) {
      throw new Error('Price is required');
    }

    const priceNumber = parseFloat(price);
    if (isNaN(priceNumber) || priceNumber <= 0) {
      throw new Error('Invalid price value');
    }

    this.logger.warn(`⚠️ Manual mETH price update requested: $${price}`);
    
    // Convert to 6 decimals (USDC format)
    const priceInUSDC = Math.floor(priceNumber * 1e6);
    
    // Update price in service
    this.methPriceService.setTestPrice(priceInUSDC);

    this.logger.log(`✅ mETH price manually set to: $${price} (${priceInUSDC} USDC)`);
    this.logger.warn('⚠️ This price will be used for liquidations and health checks');
    this.logger.warn('⚠️ Remember: The DEX still uses its own price for actual swaps!');

    return {
      success: true,
      price: price,
      priceInUSDC: priceInUSDC.toString(),
      message: 'mETH price updated successfully',
      warning: 'DEX may use different price for actual swaps',
    };
  }

  /**
   * Get current mETH price
   */
  @Post('get-meth-price')
  @HttpCode(HttpStatus.OK)
  async getMethPrice() {
    const currentPrice = this.methPriceService.getCurrentPrice();
    const priceInUSD = currentPrice / 1e6;

    return {
      success: true,
      price: priceInUSD.toString(),
      priceInUSDC: currentPrice.toString(),
      formatted: `$${priceInUSD.toFixed(2)}`,
    };
  }

  /**
   * Reset mETH price to automatic updates
   */
  @Post('reset-meth-price')
  @HttpCode(HttpStatus.OK)
  async resetMethPrice() {
    this.logger.warn('⚠️ Resetting mETH price to automatic CSV updates');
    
    this.methPriceService.resetTestPrice();

    this.logger.log('✅ mETH price reset to automatic mode');

    return {
      success: true,
      message: 'mETH price reset to automatic updates',
    };
  }
}
