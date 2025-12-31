import { Injectable, Logger } from '@nestjs/common';

/**
 * @class MethPriceService
 * @description Manages mETH price history for demo purposes
 * Stores 3 months of historical data to avoid blockchain RPC calls
 */
@Injectable()
export class MethPriceService {
  private readonly logger = new Logger(MethPriceService.name);

  // Historical price data (90 days)
  private priceHistory: Map<string, number> = new Map();

  // Current price in USD (6 decimals to match USDC)
  private currentPrice: number = 3000 * 1e6; // $3000 per mETH

  // Price appreciation rate (annual %)
  private readonly ANNUAL_YIELD = 0.05; // 5% APY
  private readonly DAILY_YIELD = this.ANNUAL_YIELD / 365;

  constructor() {
    this.initializePriceHistory();
    this.logger.log('mETH Price Service initialized with 3-month historical data');
  }

  /**
   * Initialize 90 days of historical price data
   * Simulates gradual price appreciation
   */
  private initializePriceHistory(): void {
    const today = new Date();
    const basePrice = 2850 * 1e6; // Start at $2850 (3 months ago)

    for (let i = 90; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      // Calculate price with compound daily yield
      const daysElapsed = 90 - i;
      const price = basePrice * Math.pow(1 + this.DAILY_YIELD, daysElapsed);

      const dateKey = this.formatDate(date);
      this.priceHistory.set(dateKey, Math.floor(price));
    }

    // Set current price to today's price
    const todayKey = this.formatDate(today);
    this.currentPrice = this.priceHistory.get(todayKey) || 3000 * 1e6;

    this.logger.log(`Initialized ${this.priceHistory.size} days of price history`);
    this.logger.log(`Current mETH price: $${this.currentPrice / 1e6}`);
  }

  /**
   * Get current mETH price in USDC (6 decimals)
   * @returns Current price in USDC wei (e.g., 3000000000 = $3000)
   */
  getCurrentPrice(): number {
    return this.currentPrice;
  }

  /**
   * Get current mETH price in USD (human-readable)
   * @returns Price in USD (e.g., 3000.00)
   */
  getCurrentPriceUSD(): number {
    return this.currentPrice / 1e6;
  }

  /**
   * Get price for a specific date
   * @param date Date to get price for
   * @returns Price in USDC wei, or current price if date not found
   */
  getPriceForDate(date: Date): number {
    const dateKey = this.formatDate(date);
    return this.priceHistory.get(dateKey) || this.currentPrice;
  }

  /**
   * Calculate USDC equivalent for mETH amount
   * @param methAmount Amount of mETH in wei (18 decimals)
   * @returns USDC amount in wei (6 decimals)
   */
  methToUsdc(methAmount: bigint): bigint {
    // methAmount (18 decimals) * price (6 decimals) / 1e18 = USDC (6 decimals)
    const priceBI = BigInt(this.currentPrice);
    return (methAmount * priceBI) / BigInt(1e18);
  }

  /**
   * Calculate mETH equivalent for USDC amount
   * @param usdcAmount Amount of USDC in wei (6 decimals)
   * @returns mETH amount in wei (18 decimals)
   */
  usdcToMeth(usdcAmount: bigint): bigint {
    // usdcAmount (6 decimals) * 1e18 / price (6 decimals) = mETH (18 decimals)
    const priceBI = BigInt(this.currentPrice);
    return (usdcAmount * BigInt(1e18)) / priceBI;
  }

  /**
   * Get exchange rate for DEX swap
   * @returns Exchange rate (USDC per mETH, 6 decimals)
   */
  getExchangeRate(): number {
    return this.currentPrice;
  }

  /**
   * Get full price history
   * @returns Map of date strings to prices
   */
  getPriceHistory(): Map<string, number> {
    return new Map(this.priceHistory);
  }

  /**
   * Get price chart data for last N days
   * @param days Number of days (default 30)
   * @returns Array of {date, price} objects
   */
  getPriceChartData(days: number = 30): { date: string; price: number }[] {
    const result: { date: string; price: number }[] = [];
    const today = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateKey = this.formatDate(date);
      const price = this.priceHistory.get(dateKey);

      if (price) {
        result.push({
          date: dateKey,
          price: price / 1e6, // Convert to USD
        });
      }
    }

    return result;
  }

  /**
   * Simulate price update (for demo scenarios)
   * @param newPrice New price in USD (e.g., 3100)
   */
  updatePrice(newPrice: number): void {
    this.currentPrice = Math.floor(newPrice * 1e6);

    // Update today's price in history
    const today = new Date();
    const dateKey = this.formatDate(today);
    this.priceHistory.set(dateKey, this.currentPrice);

    this.logger.log(`mETH price updated to $${newPrice}`);
  }

  /**
   * Format date as YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Get price statistics
   * @returns Price statistics object
   */
  getStats(): {
    current: number;
    min: number;
    max: number;
    avg: number;
    changePercent: number;
  } {
    const prices = Array.from(this.priceHistory.values());

    if (prices.length === 0) {
      const current = this.currentPrice / 1e6;
      return { current, min: current, max: current, avg: current, changePercent: 0 };
    }

    const min = Math.min(...prices) / 1e6;
    const max = Math.max(...prices) / 1e6;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length / 1e6;
    const first = prices[0]! / 1e6; // Safe: checked length above
    const current = this.currentPrice / 1e6;
    const changePercent = ((current - first) / first) * 100;

    return {
      current,
      min,
      max,
      avg,
      changePercent,
    };
  }
}
