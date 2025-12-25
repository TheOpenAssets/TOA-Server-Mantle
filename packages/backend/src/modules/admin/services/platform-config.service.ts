import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { PlatformConfig, PlatformConfigDocument } from '../../../database/schemas/platform-config.schema';

@Injectable()
export class PlatformConfigService {
  private readonly logger = new Logger(PlatformConfigService.name);
  private configCache: PlatformConfig | null = null;

  constructor(
    @InjectModel(PlatformConfig.name) private configModel: Model<PlatformConfigDocument>,
  ) {
    this.initializeDefaultConfig();
  }

  /**
   * Initialize default configuration on startup if it doesn't exist
   */
  private async initializeDefaultConfig() {
    const existing = await this.configModel.findOne({ configKey: 'default' });
    if (!existing) {
      const defaultConfig = await this.configModel.create({
        configKey: 'default',
        minRaiseThresholdPercent: 0.30, // 30% minimum
        maxRaiseThresholdPercent: 0.985, // 98.5% maximum (leaves 1.5% for platform)
        platformFeeRate: 0.015, // 1.5% platform fee
        defaultListingDurationDays: 7,
        minInvestmentTokens: 1000,
        enforceMinRaiseThreshold: true,
        enforceMaxRaiseThreshold: true,
        distributeFullSettlement: true,
      });
      this.logger.log('Default platform configuration created');
      this.configCache = defaultConfig;
    } else {
      this.configCache = existing;
    }
  }

  /**
   * Get current platform configuration (cached)
   */
  async getConfig(): Promise<PlatformConfig> {
    if (!this.configCache) {
      const config = await this.configModel.findOne({ configKey: 'default' });
      if (!config) {
        throw new Error('Platform configuration not found');
      }
      this.configCache = config;
    }
    return this.configCache;
  }

  /**
   * Update platform configuration
   */
  async updateConfig(updates: Partial<PlatformConfig>, admin: string, reason?: string) {
    const updated = await this.configModel.findOneAndUpdate(
      { configKey: 'default' },
      {
        ...updates,
        updatedBy: {
          admin,
          timestamp: new Date(),
          reason,
        },
      },
      { new: true },
    );

    if (!updated) {
      throw new Error('Failed to update platform configuration');
    }

    // Invalidate cache
    this.configCache = updated;
    this.logger.log(`Platform configuration updated by ${admin}: ${reason || 'No reason provided'}`);

    return updated;
  }

  /**
   * Calculate raise thresholds for a specific invoice
   */
  async calculateRaiseThresholds(invoiceFaceValue: number): Promise<{
    minRaise: number;
    maxRaise: number;
    netDistribution: number;
    platformFee: number;
  }> {
    const config = await this.getConfig();

    // netDistribution = settlement - platform fee
    const platformFee = invoiceFaceValue * config.platformFeeRate;
    const netDistribution = invoiceFaceValue - platformFee;

    // Min raise = X% of netDistribution
    const minRaise = netDistribution * config.minRaiseThresholdPercent;

    // Max raise = 98.5% of invoice value (ensures platform gets 1.5% fee)
    const maxRaise = invoiceFaceValue * config.maxRaiseThresholdPercent;

    return {
      minRaise,
      maxRaise,
      netDistribution,
      platformFee,
    };
  }

  /**
   * Validate a purchase against raise thresholds
   */
  async validatePurchase(
    invoiceFaceValue: number,
    currentRaised: number,
    purchaseAmount: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    const config = await this.getConfig();
    const thresholds = await this.calculateRaiseThresholds(invoiceFaceValue);

    // Check if purchase would exceed max raise
    if (config.enforceMaxRaiseThreshold) {
      const newTotal = currentRaised + purchaseAmount;
      if (newTotal > thresholds.maxRaise) {
        const available = Math.max(0, thresholds.maxRaise - currentRaised);
        return {
          valid: false,
          reason: `Purchase would exceed maximum raise threshold. Max: ${thresholds.maxRaise}, Currently raised: ${currentRaised}, Available: ${available}`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if minimum raise threshold was met
   */
  async checkMinimumRaiseMet(
    invoiceFaceValue: number,
    amountRaised: number,
  ): Promise<{ met: boolean; required: number; shortfall?: number }> {
    const config = await this.getConfig();
    const thresholds = await this.calculateRaiseThresholds(invoiceFaceValue);

    if (!config.enforceMinRaiseThreshold) {
      return { met: true, required: 0 };
    }

    const met = amountRaised >= thresholds.minRaise;
    const shortfall = met ? 0 : thresholds.minRaise - amountRaised;

    return {
      met,
      required: thresholds.minRaise,
      shortfall,
    };
  }

  /**
   * Get projected yield based on current raise amount
   */
  async getProjectedYield(
    invoiceFaceValue: number,
    currentRaised: number,
  ): Promise<{
    netDistribution: number;
    projectedYield: number;
    yieldPercent: number;
    raiseProgress: number;
  }> {
    const thresholds = await this.calculateRaiseThresholds(invoiceFaceValue);

    const projectedYield = thresholds.netDistribution - currentRaised;
    const yieldPercent = currentRaised > 0 ? (projectedYield / currentRaised) * 100 : 0;
    const raiseProgress = (currentRaised / thresholds.maxRaise) * 100;

    return {
      netDistribution: thresholds.netDistribution,
      projectedYield,
      yieldPercent,
      raiseProgress,
    };
  }
}
