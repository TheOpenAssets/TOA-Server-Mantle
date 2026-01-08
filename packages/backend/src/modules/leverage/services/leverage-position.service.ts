import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  LeveragePosition,
  PositionStatus,
  PositionHealth,
  HarvestRecord,
} from '../../../database/schemas/leverage-position.schema';

@Injectable()
export class LeveragePositionService {
  private readonly logger = new Logger(LeveragePositionService.name);

  constructor(
    @InjectModel(LeveragePosition.name)
    private leveragePositionModel: Model<LeveragePosition>,
  ) { }

  /**
   * Create a new leverage position
   */
  async createPosition(data: {
    positionId: number;
    userAddress: string;
    assetId: string;
    rwaTokenAddress: string;
    rwaTokenAmount: string;
    mETHCollateral: string;
    usdcBorrowed: string;
    initialLTV: number;
    currentHealthFactor: number;
  }): Promise<LeveragePosition> {
    try {
      // Determine initial health status
      const healthStatus = this.determineHealthStatus(data.currentHealthFactor);

      const position = await this.leveragePositionModel.create({
        ...data,
        userAddress: data.userAddress.toLowerCase(), // Normalize address to lowercase
        healthStatus,
        status: PositionStatus.ACTIVE,
        createdAt: new Date(),
        lastHarvestTime: new Date(),
        totalInterestPaid: '0',
        totalMETHHarvested: '0',
        harvestHistory: [],
      });

      this.logger.log(
        `✅ Leverage position created: ID ${data.positionId} for user ${data.userAddress}`,
      );

      return position;
    } catch (error) {
      this.logger.error(`Failed to create position: ${error}`);
      throw error;
    }
  }

  /**
   * Get position by position ID
   */
  async getPosition(positionId: number): Promise<LeveragePosition | null> {
    return this.leveragePositionModel.findOne({ positionId }).exec();
  }

  /**
   * Get all positions for a user
   */
  async getUserPositions(userAddress: string): Promise<LeveragePosition[]> {
    return this.leveragePositionModel
      .find({ userAddress: userAddress.toLowerCase() })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get active positions for a user
   */
  async getActiveUserPositions(userAddress: string): Promise<LeveragePosition[]> {
    return this.leveragePositionModel
      .find({
        userAddress: userAddress.toLowerCase(),
        status: PositionStatus.ACTIVE,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get all active positions (for harvest keeper)
   */
  async getActivePositions(): Promise<LeveragePosition[]> {
    return this.leveragePositionModel
      .find({ status: PositionStatus.ACTIVE })
      .exec();
  }

  /**
   * Get positions that need settlement (both ACTIVE and LIQUIDATED)
   * Used during yield distribution to settle all outstanding positions
   */
  async getSettlementPendingPositions(): Promise<LeveragePosition[]> {
    return this.leveragePositionModel
      .find({ 
        status: { $in: [PositionStatus.ACTIVE, PositionStatus.LIQUIDATED] }
      })
      .exec();
  }

  /**
   * Get liquidatable positions (health factor < 110%)
   */
  async getLiquidatablePositions(): Promise<LeveragePosition[]> {
    return this.leveragePositionModel
      .find({
        status: PositionStatus.ACTIVE,
        healthStatus: PositionHealth.LIQUIDATABLE,
      })
      .exec();
  }

  /**
   * Update position health
   */
  async updateHealth(
    positionId: number,
    healthFactor: number,
  ): Promise<void> {
    const healthStatus = this.determineHealthStatus(healthFactor);

    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          currentHealthFactor: healthFactor,
          healthStatus,
        },
      },
    );

    this.logger.log(
      `📊 Position ${positionId} health updated: ${healthFactor / 100}% (${healthStatus})`,
    );
  }

  /**
   * Record a harvest
   */
  async recordHarvest(
    positionId: number,
    harvest: {
      mETHSwapped: string;
      usdcReceived: string;
      interestPaid: string;
      interestAccrued: string;
      mETHPrice: string;
      transactionHash: string;
      healthFactorBefore: number;
      healthFactorAfter: number;
    },
  ): Promise<void> {
    const position = await this.getPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    const harvestRecord: HarvestRecord = {
      timestamp: new Date(),
      mETHSwapped: harvest.mETHSwapped,
      usdcReceived: harvest.usdcReceived,
      interestPaid: harvest.interestPaid,
      interestAccrued: harvest.interestAccrued,
      mETHPrice: harvest.mETHPrice,
      transactionHash: harvest.transactionHash,
      healthFactorBefore: harvest.healthFactorBefore,
      healthFactorAfter: harvest.healthFactorAfter,
    };

    // Update totals
    const totalInterestPaid = (
      BigInt(position.totalInterestPaid) + BigInt(harvest.interestPaid)
    ).toString();
    const totalMETHHarvested = (
      BigInt(position.totalMETHHarvested) + BigInt(harvest.mETHSwapped)
    ).toString();
    const newMETHCollateral = (
      BigInt(position.mETHCollateral) - BigInt(harvest.mETHSwapped)
    ).toString();

    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          lastHarvestTime: new Date(),
          totalInterestPaid,
          totalMETHHarvested,
          mETHCollateral: newMETHCollateral,
          currentHealthFactor: harvest.healthFactorAfter,
          healthStatus: this.determineHealthStatus(harvest.healthFactorAfter),
        },
        $push: { harvestHistory: harvestRecord as any },
      },
    );

    this.logger.log(
      `🌾 Harvest recorded for position ${positionId}: ${parseFloat(harvest.usdcReceived) / 1e6} USDC interest paid`,
    );
  }

  /**
   * Mark position as liquidated
   */
  async markLiquidated(
    positionId: number,
    details: {
      mETHSold: string;
      usdcRecovered: string;
      shortfall: string;
      txHash: string;
    },
  ): Promise<void> {
    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          status: PositionStatus.LIQUIDATED,
          healthStatus: PositionHealth.LIQUIDATABLE,
          liquidationTimestamp: new Date(),
          liquidationTxHash: details.txHash,
          mETHSoldInLiquidation: details.mETHSold,
          usdcRecoveredInLiquidation: details.usdcRecovered,
          liquidationShortfall: details.shortfall,
          mETHCollateral: '0', // All collateral sold
        },
      },
    );

    this.logger.log(`⚠️ Position ${positionId} liquidated`);
  }

  /**
   * Record yield claim from burning RWA tokens
   */
  async recordYieldClaim(
    positionId: number,
    claim: {
      tokensBurned: string;
      usdcReceived: string;
      transactionHash: string;
    },
  ): Promise<void> {
    const position = await this.getPosition(positionId);
    if (!position) {
      throw new Error(`Position ${positionId} not found`);
    }

    // Update RWA token amount
    const newRWATokenAmount = (
      BigInt(position.rwaTokenAmount) - BigInt(claim.tokensBurned)
    ).toString();

    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          rwaTokenAmount: newRWATokenAmount,
          yieldClaimTimestamp: new Date(),
          yieldClaimTxHash: claim.transactionHash,
          yieldClaimedUSDC: claim.usdcReceived,
          tokensBurnedForYield: claim.tokensBurned,
        },
      },
    );

    this.logger.log(
      `🔥 Yield claim recorded for position ${positionId}: ${parseFloat(claim.usdcReceived) / 1e6} USDC claimed`,
    );
  }

  /**
   * Record settlement waterfall
   */
  async recordSettlement(
    positionId: number,
    settlement: {
      settlementUSDC: string;
      seniorRepayment: string;
      interestRepayment: string;
      userYield: string;
      mETHReturned: string;
      transactionHash: string;
    },
  ): Promise<void> {
    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          status: PositionStatus.SETTLED,
          settlementTimestamp: new Date(),
          settlementTxHash: settlement.transactionHash,
          settlementUSDCReceived: settlement.settlementUSDC,
          seniorRepayment: settlement.seniorRepayment,
          interestRepayment: settlement.interestRepayment,
          userYieldDistributed: settlement.userYield,
          mETHReturnedToUser: settlement.mETHReturned,
        },
      },
    );

    this.logger.log(
      `✅ Settlement recorded for position ${positionId}: ${parseFloat(settlement.userYield) / 1e6} USDC pushed to user, ${parseFloat(settlement.mETHReturned) / 1e18} mETH returned`,
    );
  }

  /**
   * Record liquidation settlement (for positions that were liquidated)
   */
  async updateLiquidationSettlement(
    positionId: number,
    settlement: {
      yieldReceived: string;
      debtRepaid: string;
      liquidationFee: string;
      userRefund: string;
      transactionHash: string;
    },
  ): Promise<void> {
    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          status: PositionStatus.SETTLED,
          settlementTimestamp: new Date(),
          settlementTxHash: settlement.transactionHash,
          settlementUSDCReceived: settlement.yieldReceived,
          seniorRepayment: settlement.debtRepaid,
          userYieldDistributed: settlement.userRefund,
        },
      },
    );

    this.logger.log(
      `💰 Liquidation settlement recorded for position ${positionId}: ${parseFloat(settlement.userRefund) / 1e6} USDC refunded to user (${parseFloat(settlement.liquidationFee) / 1e6} USDC liquidation fee)`,
    );
  }

  /**
   * Mark position as settled (legacy method)
   */
  async markSettled(
    positionId: number,
    details: {
      settlementUSDC: string;
      seniorRepayment: string;
      interestRepayment: string;
      userYield: string;
      mETHReturned: string;
      txHash: string;
    },
  ): Promise<void> {
    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          status: PositionStatus.SETTLED,
          settlementTimestamp: new Date(),
          settlementTxHash: details.txHash,
          settlementUSDCReceived: details.settlementUSDC,
          seniorRepayment: details.seniorRepayment,
          interestRepayment: details.interestRepayment,
          userYieldDistributed: details.userYield,
          mETHReturnedToUser: details.mETHReturned,
        },
      },
    );

    this.logger.log(
      `✅ Position ${positionId} settled: ${parseFloat(details.userYield) / 1e6} USDC to user`,
    );
  }

  /**
   * Update notification tracking
   */
  async updateNotificationTracking(
    positionId: number,
    type: 'warning' | 'critical',
  ): Promise<void> {
    const update: any = {
      lastNotificationTime: new Date(),
    };

    if (type === 'warning') {
      update.warningNotificationSent = true;
    } else if (type === 'critical') {
      update.criticalNotificationSent = true;
    }

    await this.leveragePositionModel.updateOne({ positionId }, { $set: update });
  }

  /**
   * Reset notification flags when health improves
   */
  async resetNotificationFlags(positionId: number): Promise<void> {
    await this.leveragePositionModel.updateOne(
      { positionId },
      {
        $set: {
          warningNotificationSent: false,
          criticalNotificationSent: false,
        },
      },
    );
  }

  /**
   * Get positions requiring health check notifications
   */
  async getPositionsNeedingNotification(): Promise<LeveragePosition[]> {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    return this.leveragePositionModel
      .find({
        status: PositionStatus.ACTIVE,
        $or: [
          // Critical notifications (every 4 hours)
          {
            healthStatus: PositionHealth.CRITICAL,
            $or: [
              { lastNotificationTime: { $lt: fourHoursAgo } },
              { lastNotificationTime: { $exists: false } },
            ],
          },
          // Warning notifications (one-time)
          {
            healthStatus: PositionHealth.WARNING,
            warningNotificationSent: false,
          },
        ],
      })
      .exec();
  }

  /**
   * Get total statistics
   */
  async getTotalStats(): Promise<{
    totalPositions: number;
    activePositions: number;
    totalMETHCollateral: bigint;
    totalUSDCBorrowed: bigint;
    totalInterestPaid: bigint;
  }> {
    const positions = await this.leveragePositionModel.find().exec();

    let totalMETHCollateral = BigInt(0);
    let totalUSDCBorrowed = BigInt(0);
    let totalInterestPaid = BigInt(0);
    let activePositions = 0;

    for (const position of positions) {
      if (position.status === PositionStatus.ACTIVE) {
        activePositions++;
        totalMETHCollateral += BigInt(position.mETHCollateral);
        totalUSDCBorrowed += BigInt(position.usdcBorrowed);
      }
      totalInterestPaid += BigInt(position.totalInterestPaid);
    }

    return {
      totalPositions: positions.length,
      activePositions,
      totalMETHCollateral,
      totalUSDCBorrowed,
      totalInterestPaid,
    };
  }

  /**
   * Get latest position for a user & asset (most recent by createdAt)
   */
  async getLatestPositionForUserAsset(
    userAddress: string,
    assetId: string,
  ): Promise<LeveragePosition | null> {
    return this.leveragePositionModel
      .findOne({ userAddress: userAddress.toLowerCase(), assetId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Determine health status from health factor
   */
  private determineHealthStatus(healthFactor: number): PositionHealth {
    if (healthFactor < 11000) {
      // < 110%
      return PositionHealth.LIQUIDATABLE;
    } else if (healthFactor < 12500) {
      // 110-125%
      return PositionHealth.CRITICAL;
    } else if (healthFactor < 14000) {
      // 125-140%
      return PositionHealth.WARNING;
    } else {
      // >= 140%
      return PositionHealth.HEALTHY;
    }
  }
}
