import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';

interface PriceDataPoint {
  date: Date;
  price: number;
}

/**
 * @class StArbPriceService
 * @description Manages stARB price history from real CSV data
 * Loads configurable months of historical data and updates at configurable intervals
 * stARB is liquid staked ARB on Arbitrum, accruing yield from sequencer fees (~8% APY)
 */
@Injectable()
export class StArbPriceService implements OnModuleInit {
  private readonly logger = new Logger(StArbPriceService.name);

  // Historical price data
  private priceHistory: Map<string, number> = new Map();
  private priceDataPoints: PriceDataPoint[] = [];

  // Current price in USD (6 decimals to match USDC)
  private currentPrice: number = 0.8 * 1e6; // Default $0.80 per stARB
  private currentDataIndex: number = 0;
  private testPrice: number | null = null; // Manual override for testing

  // Configuration
  private readonly updateIntervalSeconds: number;
  private readonly historyDays: number;
  private readonly CSV_PATH = path.join(process.cwd(), 'Data', 'starb-usd-max.csv');

  constructor(
    private configService: ConfigService,
    private schedulerRegistry: SchedulerRegistry,
  ) {
    // Load configuration from environment
    this.updateIntervalSeconds = this.configService.get<number>('STARB_PRICE_UPDATE_INTERVAL_SECONDS', 14400);
    this.historyDays = this.configService.get<number>('STARB_PRICE_HISTORY_DAYS', 180);
  }

  async onModuleInit() {
    this.logger.log('Initializing stARB Price Service...');
    this.logger.log(`Configuration: Update interval = ${this.updateIntervalSeconds}s, History window = ${this.historyDays} days`);

    await this.loadHistoricalData();

    this.logger.log(`stARB Price Service initialized with ${this.priceHistory.size} days of historical data`);
    this.logger.log(`Current stARB price: $${this.getCurrentPriceUSD()}`);

    // Set up dynamic cron job based on configuration
    this.setupPriceUpdateSchedule();
  }

  /**
   * Set up dynamic cron job for price updates
   */
  private setupPriceUpdateSchedule(): void {
    // Calculate updates per day
    const updateIntervalHours = this.updateIntervalSeconds / 3600;
    const updatesPerDay = (24 * 3600) / this.updateIntervalSeconds;
    const daysOfCoverage = this.historyDays / updatesPerDay;

    this.logger.log(`Price will update every ${this.updateIntervalSeconds}s (${updatesPerDay.toFixed(1)} times/day)`);
    this.logger.log(`${this.historyDays} days of data will last approximately ${Math.floor(daysOfCoverage)} days of runtime`);

    // Use setInterval for sub-minute intervals, cron for longer intervals
    if (this.updateIntervalSeconds < 60) {
      // Use setInterval for sub-minute intervals
      const intervalMs = this.updateIntervalSeconds * 1000;
      const interval = setInterval(() => {
        this.updatePriceFromHistory();
      }, intervalMs);

      this.schedulerRegistry.addInterval('starb-price-update', interval);
      this.logger.log(`Scheduled price updates with interval: ${this.updateIntervalSeconds}s`);
    } else {
      // Use cron for minute-based or hourly intervals
      let cronExpression: string;

      if (this.updateIntervalSeconds >= 3600) {
        // Hourly updates: "0 */N * * *" where N is hours
        const hours = Math.floor(this.updateIntervalSeconds / 3600);
        cronExpression = `0 */${hours} * * *`;
      } else {
        // Minute updates: "*/M * * * *" where M is minutes
        const minutes = Math.floor(this.updateIntervalSeconds / 60);
        cronExpression = `*/${minutes} * * * *`;
      }

      const job = new CronJob(cronExpression, () => {
        this.updatePriceFromHistory();
      });

      this.schedulerRegistry.addCronJob('starb-price-update', job);
      job.start();

      this.logger.log(`Scheduled price updates with cron expression: ${cronExpression}`);
    }
  }

  /**
   * Load historical price data from CSV (ARB/USD data used as stARB approximation)
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      // Check if CSV exists
      if (!fs.existsSync(this.CSV_PATH)) {
        this.logger.warn(`CSV file not found at ${this.CSV_PATH}. Using simulated data.`);
        this.initializeSimulatedData();
        return;
      }

      // Read CSV file
      const csvContent = fs.readFileSync(this.CSV_PATH, 'utf-8');
      const lines = csvContent.split('\n').slice(1); // Skip header

      // Parse all data points
      const allDataPoints: PriceDataPoint[] = [];
      for (const line of lines) {
        if (!line.trim()) continue;

        const [timestamp, priceStr] = line.split(',');
        if (!timestamp || !priceStr) continue;

        const date = new Date(timestamp.replace(' UTC', 'Z'));
        const price = parseFloat(priceStr);

        if (!isNaN(price)) {
          allDataPoints.push({ date, price });
        }
      }

      // Sort by date (oldest first)
      allDataPoints.sort((a, b) => a.date.getTime() - b.date.getTime());

      // Take last N days (configured via historyDays)
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() - this.historyDays);

      this.priceDataPoints = allDataPoints.filter(
        (dp) => dp.date >= targetDate
      );

      // If we don't have enough data, take all available
      if (this.priceDataPoints.length < this.historyDays) {
        this.priceDataPoints = allDataPoints.slice(-this.historyDays);
      }

      // Build price history map
      for (const dataPoint of this.priceDataPoints) {
        const dateKey = this.formatDate(dataPoint.date);
        const priceInUsdcWei = Math.floor(dataPoint.price * 1e6);
        this.priceHistory.set(dateKey, priceInUsdcWei);
      }

      // Set current price to the FIRST (oldest) data point
      // This allows the service to progress forward through historical data
      if (this.priceDataPoints.length > 0) {
        const firstPrice = this.priceDataPoints[0]!.price;
        this.currentPrice = Math.floor(firstPrice * 1e6);
        this.currentDataIndex = 0; // Start at the beginning

        this.logger.log(`Loaded ${this.priceDataPoints.length} days of historical data from CSV`);
        this.logger.log(`Date range: ${this.formatDate(this.priceDataPoints[0]!.date)} to ${this.formatDate(this.priceDataPoints[this.priceDataPoints.length - 1]!.date)}`);
        this.logger.log(`Starting at first data point: $${firstPrice} (${this.formatDate(this.priceDataPoints[0]!.date)})`);
      }
    } catch (error: any) {
      this.logger.error(`Failed to load CSV data: ${error.message}`, error.stack);
      this.initializeSimulatedData();
    }
  }

  /**
   * Fallback: Initialize simulated data if CSV not available
   * Simulates 8% APY yield accrual for stARB
   */
  private initializeSimulatedData(): void {
    const today = new Date();
    const basePrice = 0.75; // Start at $0.75 (historical ARB price range)
    const ANNUAL_YIELD = 0.08; // 8% APY from Arbitrum sequencer fees
    const DAILY_YIELD = ANNUAL_YIELD / 365;

    for (let i = this.historyDays; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);

      const daysElapsed = this.historyDays - i;
      const price = basePrice * Math.pow(1 + DAILY_YIELD, daysElapsed);

      const dateKey = this.formatDate(date);
      const priceInUsdcWei = Math.floor(price * 1e6);
      this.priceHistory.set(dateKey, priceInUsdcWei);

      this.priceDataPoints.push({
        date,
        price,
      });
    }

    // Start at the first (oldest) data point, not the last
    const firstKey = this.formatDate(this.priceDataPoints[0]!.date);
    this.currentPrice = this.priceHistory.get(firstKey) || 0.8 * 1e6;
    this.currentDataIndex = 0;

    this.logger.log(`Initialized ${this.priceHistory.size} days of simulated price history`);
    this.logger.log(`Starting at first data point: $${this.currentPrice / 1e6}`);
  }

  /**
   * Update price from historical data
   * Called by dynamic cron job
   */
  async updatePriceFromHistory(): Promise<void> {
    this.logger.log('Running scheduled price update...');

    // Move to next data point (simulates time passing)
    if (this.currentDataIndex < this.priceDataPoints.length - 1) {
      this.currentDataIndex++;
    } else {
      // If we've reached the end, loop back or stay at current
      this.logger.warn('Reached end of historical data. Staying at current price.');
      return;
    }

    const nextDataPoint = this.priceDataPoints[this.currentDataIndex]!;
    const newPrice = Math.floor(nextDataPoint.price * 1e6);

    this.logger.log(
      `Price updated: $${this.currentPrice / 1e6} → $${newPrice / 1e6} (${this.formatDate(nextDataPoint.date)})`
    );

    this.currentPrice = newPrice;

    // Update today's price in history
    const today = new Date();
    const dateKey = this.formatDate(today);
    this.priceHistory.set(dateKey, newPrice);
  }

  /**
   * Get current stARB price in USDC (6 decimals)
   * @returns Current price in USDC wei (e.g., 800000 = $0.80)
   */
  getCurrentPrice(): number {
    // Return test price if set (for testing liquidations)
    if (this.testPrice !== null) {
      return this.testPrice;
    }

    return this.currentPrice;
  }

  /**
   * Get current stARB price in USD (human-readable)
   * @returns Price in USD (e.g., 0.80)
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
   * Calculate USDC equivalent for stARB amount
   * @param starbAmount Amount of stARB in wei (18 decimals)
   * @returns USDC amount in wei (6 decimals)
   */
  starbToUsdc(starbAmount: bigint): bigint {
    // starbAmount (18 decimals) * price (6 decimals) / 1e18 = USDC (6 decimals)
    const priceBI = BigInt(this.currentPrice);
    return (starbAmount * priceBI) / BigInt(1e18);
  }

  /**
   * Calculate stARB equivalent for USDC amount
   * @param usdcAmount Amount of USDC in wei (6 decimals)
   * @returns stARB amount in wei (18 decimals)
   */
  usdcToStarb(usdcAmount: bigint): bigint {
    // usdcAmount (6 decimals) * 1e18 / price (6 decimals) = stARB (18 decimals)
    const priceBI = BigInt(this.currentPrice);
    return (usdcAmount * BigInt(1e18)) / priceBI;
  }

  /**
   * Get exchange rate for DEX swap
   * @returns Exchange rate (USDC per stARB, 6 decimals)
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

    // Get last N data points
    const startIndex = Math.max(0, this.priceDataPoints.length - days);
    const dataPoints = this.priceDataPoints.slice(startIndex);

    for (const dp of dataPoints) {
      result.push({
        date: this.formatDate(dp.date),
        price: dp.price,
      });
    }

    return result;
  }

  /**
   * Manually update price (for demo scenarios)
   * @param newPrice New price in USD (e.g., 0.85)
   */
  updatePrice(newPrice: number): void {
    this.currentPrice = Math.floor(newPrice * 1e6);

    // Update today's price in history
    const today = new Date();
    const dateKey = this.formatDate(today);
    this.priceHistory.set(dateKey, this.currentPrice);

    this.logger.log(`stARB price manually updated to $${newPrice}`);
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
      const current = this.getCurrentPrice() / 1e6;
      return { current, min: current, max: current, avg: current, changePercent: 0 };
    }

    const min = Math.min(...prices) / 1e6;
    const max = Math.max(...prices) / 1e6;
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length / 1e6;
    const first = prices[0]! / 1e6;
    const current = this.getCurrentPrice() / 1e6;
    const changePercent = ((current - first) / first) * 100;

    return {
      current,
      min,
      max,
      avg,
      changePercent,
    };
  }

  /**
   * Set test price for manual testing (admin only)
   * @param priceInUSDC Price in USDC wei (6 decimals)
   */
  setTestPrice(priceInUSDC: number): void {
    this.testPrice = priceInUSDC;
    this.logger.warn(`⚠️ Test price set to: $${priceInUSDC / 1e6} (${priceInUSDC} USDC)`);
  }

  /**
   * Reset to automatic price updates
   */
  resetTestPrice(): void {
    this.testPrice = null;
    this.logger.log('Test price cleared, resuming automatic updates');
  }

  /**
   * Check if using test price
   */
  isUsingTestPrice(): boolean {
    return this.testPrice !== null;
  }
}
