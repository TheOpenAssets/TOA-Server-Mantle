import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SolvencyPosition,
  SolvencyPositionDocument,
  TokenType,
  HealthStatus,
  PositionStatus,
} from '../../../database/schemas/solvency-position.schema';
import { SolvencyBlockchainService } from './solvency-blockchain.service';

@Injectable()
export class SolvencyPositionService {
  private readonly logger = new Logger(SolvencyPositionService.name);

  constructor(
    @InjectModel(SolvencyPosition.name)
    private positionModel: Model<SolvencyPositionDocument>,
    private blockchainService: SolvencyBlockchainService,
  ) {}

  /**
   * Create new position record
   */
  async createPosition(
    positionId: number,
    userAddress: string,
    collateralTokenAddress: string,
    collateralTokenType: TokenType,
    collateralAmount: string,
    tokenValueUSD: string,
    depositTxHash: string,
    depositBlockNumber: number,
    oaidCreditIssued: boolean = false,
  ): Promise<SolvencyPosition> {
    this.logger.log(`Creating position ${positionId} for user ${userAddress}`);

    // Calculate initial LTV based on token type
    const initialLTV = collateralTokenType === TokenType.RWA ? 7000 : 6000;

    const position = new this.positionModel({
      positionId,
      userAddress,
      collateralTokenAddress,
      collateralTokenType,
      collateralAmount,
      tokenValueUSD,
      usdcBorrowed: '0',
      initialLTV,
      currentHealthFactor: 2147483647, // Max int (no debt yet)
      healthStatus: HealthStatus.HEALTHY,
      status: PositionStatus.ACTIVE,
      totalRepaid: '0',
      oaidCreditIssued,
      depositTxHash,
      depositBlockNumber,
    });

    await position.save();
    this.logger.log(`Position ${positionId} created successfully`);

    return position;
  }

  /**
   * Get position by ID
   */
  async getPosition(positionId: number): Promise<SolvencyPositionDocument> {
    const position = await this.positionModel.findOne({ positionId });

    if (!position) {
      throw new NotFoundException(`Position ${positionId} not found`);
    }

    return position;
  }

  /**
   * Get all positions for user
   */
  async getUserPositions(userAddress: string): Promise<SolvencyPosition[]> {
    return this.positionModel
      .find({ userAddress })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get all active positions for user
   */
  async getUserActivePositions(userAddress: string): Promise<SolvencyPosition[]> {
    return this.positionModel
      .find({ userAddress, status: PositionStatus.ACTIVE })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Update position after borrowing
   */
  async recordBorrow(
    positionId: number,
    amountBorrowed: string,
  ): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    const currentBorrowed = BigInt(position.usdcBorrowed);
    const newBorrowed = currentBorrowed + BigInt(amountBorrowed);

    position.usdcBorrowed = newBorrowed.toString();

    // Update health factor
    await this.updateHealthFactor(position);

    await position.save();
    this.logger.log(`Position ${positionId} borrowed ${amountBorrowed}, total: ${newBorrowed}`);

    return position;
  }

  /**
   * Update position after repayment
   */
  async recordRepayment(
    positionId: number,
    amountRepaid: string,
    principal: string,
  ): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    const currentBorrowed = BigInt(position.usdcBorrowed);
    const newBorrowed = currentBorrowed - BigInt(principal);

    position.usdcBorrowed = newBorrowed > 0n ? newBorrowed.toString() : '0';

    const currentRepaid = BigInt(position.totalRepaid);
    position.totalRepaid = (currentRepaid + BigInt(amountRepaid)).toString();
    position.lastRepaymentTime = new Date();

    // Update health factor
    await this.updateHealthFactor(position);

    // If fully repaid, mark as REPAID
    if (newBorrowed === 0n) {
      position.status = PositionStatus.REPAID;
      this.logger.log(`Position ${positionId} fully repaid`);
    }

    await position.save();
    this.logger.log(`Position ${positionId} repaid ${amountRepaid}, remaining debt: ${newBorrowed}`);

    return position;
  }

  /**
   * Update position after withdrawal
   */
  async recordWithdrawal(
    positionId: number,
    amountWithdrawn: string,
  ): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    const currentCollateral = BigInt(position.collateralAmount);
    const newCollateral = currentCollateral - BigInt(amountWithdrawn);

    position.collateralAmount = newCollateral.toString();

    // If all collateral withdrawn, mark as CLOSED
    if (newCollateral === 0n) {
      position.status = PositionStatus.CLOSED;
      this.logger.log(`Position ${positionId} closed - all collateral withdrawn`);
    }

    await position.save();
    this.logger.log(`Position ${positionId} withdrew ${amountWithdrawn}, remaining: ${newCollateral}`);

    return position;
  }

  /**
   * Mark position as liquidated
   */
  async markLiquidated(
    positionId: number,
    marketplaceListingId: string,
    liquidationTxHash: string,
  ): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    position.status = PositionStatus.LIQUIDATED;
    position.liquidationTimestamp = new Date();
    position.liquidationTxHash = liquidationTxHash;
    position.marketplaceListingId = marketplaceListingId;
    position.healthStatus = HealthStatus.LIQUIDATABLE;

    await position.save();
    this.logger.log(`Position ${positionId} marked as liquidated`);

    return position;
  }

  /**
   * Record liquidation settlement proceeds
   */
  async recordLiquidationSettlement(
    positionId: number,
    debtRecovered: string,
  ): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    position.debtRecovered = debtRecovered;

    await position.save();
    this.logger.log(`Position ${positionId} liquidation recovered ${debtRecovered} USDC`);

    return position;
  }

  /**
   * Update health factor for position
   */
  async updateHealthFactor(position: SolvencyPosition): Promise<void> {
    try {
      const healthFactor = await this.blockchainService.getHealthFactor(position.positionId);
      position.currentHealthFactor = healthFactor;

      // Update health status based on health factor
      if (healthFactor < 11000) {
        // < 110%
        position.healthStatus = HealthStatus.LIQUIDATABLE;
      } else if (healthFactor < 12500) {
        // 110% - 125%
        position.healthStatus = HealthStatus.WARNING;
      } else {
        // > 125%
        position.healthStatus = HealthStatus.HEALTHY;
      }
    } catch (error: any) {
      this.logger.error(`Failed to update health factor for position ${position.positionId}: ${error.message}`);
    }
  }

  /**
   * Get all liquidatable positions (health < 110%)
   */
  async getLiquidatablePositions(): Promise<SolvencyPosition[]> {
    const activePositions = await this.positionModel
      .find({ status: PositionStatus.ACTIVE })
      .exec();

    const liquidatable: SolvencyPosition[] = [];

    for (const position of activePositions) {
      await this.updateHealthFactor(position);
      await position.save();

      if (position.healthStatus === HealthStatus.LIQUIDATABLE) {
        liquidatable.push(position);
      }
    }

    return liquidatable;
  }

  /**
   * Get positions with warning status
   */
  async getWarningPositions(): Promise<SolvencyPosition[]> {
    return this.positionModel
      .find({
        status: PositionStatus.ACTIVE,
        healthStatus: HealthStatus.WARNING,
      })
      .sort({ currentHealthFactor: 1 }) // Lowest health first
      .exec();
  }

  /**
   * Sync position with blockchain data
   */
  async syncPositionWithBlockchain(positionId: number): Promise<SolvencyPosition> {
    const position = await this.getPosition(positionId);

    try {
      const onChainPosition = await this.blockchainService.getPosition(positionId);
      const outstandingDebt = await this.blockchainService.getOutstandingDebt(positionId);

      position.collateralAmount = onChainPosition.collateralAmount;
      position.usdcBorrowed = outstandingDebt;

      await this.updateHealthFactor(position);
      await position.save();

      this.logger.log(`Position ${positionId} synced with blockchain`);
    } catch (error: any) {
      this.logger.error(`Failed to sync position ${positionId}: ${error.message}`);
    }

    return position;
  }

  /**
   * Get position statistics
   */
  async getPositionStats(positionId: number): Promise<{
    position: SolvencyPosition;
    outstandingDebt: string;
    healthFactor: number;
    maxBorrow: string;
  }> {
    const position = await this.getPosition(positionId);
    const outstandingDebt = await this.blockchainService.getOutstandingDebt(positionId);
    const healthFactor = await this.blockchainService.getHealthFactor(positionId);
    const maxBorrow = await this.blockchainService.getMaxBorrow(positionId);

    return {
      position,
      outstandingDebt,
      healthFactor,
      maxBorrow,
    };
  }

  /**
   * Get all positions (admin)
   */
  async getAllPositions(
    status?: PositionStatus,
    healthStatus?: HealthStatus,
  ): Promise<SolvencyPosition[]> {
    const query: any = {};

    if (status) {
      query.status = status;
    }

    if (healthStatus) {
      query.healthStatus = healthStatus;
    }

    return this.positionModel.find(query).sort({ createdAt: -1 }).exec();
  }
}
