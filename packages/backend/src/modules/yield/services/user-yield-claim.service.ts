import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserYieldClaim, YieldClaimStatus } from '../../../database/schemas/user-yield-claim.schema';

@Injectable()
export class UserYieldClaimService {
  private readonly logger = new Logger(UserYieldClaimService.name);

  constructor(
    @InjectModel(UserYieldClaim.name)
    private userYieldClaimModel: Model<UserYieldClaim>,
  ) {}

  /**
   * Record a new yield claim from blockchain event
   */
  async recordClaim(data: {
    userAddress: string;
    tokenAddress: string;
    assetId: string;
    tokensBurned: string;
    usdcReceived: string;
    transactionHash: string;
    blockNumber: number;
    claimTimestamp: Date;
  }): Promise<UserYieldClaim> {
    try {
      // Check if claim already exists (idempotency)
      const existing = await this.userYieldClaimModel.findOne({
        transactionHash: data.transactionHash,
      });

      if (existing) {
        this.logger.log(
          `Yield claim already recorded for tx: ${data.transactionHash}`,
        );
        return existing;
      }

      const claim = await this.userYieldClaimModel.create({
        ...data,
        status: YieldClaimStatus.CONFIRMED,
      });

      this.logger.log(
        `✅ Yield claim recorded: User ${data.userAddress} burned ${parseFloat(data.tokensBurned) / 1e18} tokens, received ${parseFloat(data.usdcReceived) / 1e6} USDC`,
      );

      return claim;
    } catch (error) {
      this.logger.error(`Failed to record yield claim: ${error}`);
      throw error;
    }
  }

  /**
   * Get all claims for a specific user
   */
  async getUserClaims(userAddress: string): Promise<UserYieldClaim[]> {
    return this.userYieldClaimModel
      .find({ userAddress: userAddress.toLowerCase() })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get all claims for a specific asset
   */
  async getAssetClaims(assetId: string): Promise<UserYieldClaim[]> {
    return this.userYieldClaimModel
      .find({ assetId })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get all claims for a specific token
   */
  async getTokenClaims(tokenAddress: string): Promise<UserYieldClaim[]> {
    return this.userYieldClaimModel
      .find({ tokenAddress: tokenAddress.toLowerCase() })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Get total USDC claimed for an asset
   */
  async getTotalClaimedForAsset(assetId: string): Promise<{
    totalUSDC: bigint;
    totalTokensBurned: bigint;
    claimCount: number;
  }> {
    const claims = await this.getAssetClaims(assetId);

    let totalUSDC = BigInt(0);
    let totalTokensBurned = BigInt(0);

    for (const claim of claims) {
      if (claim.status === YieldClaimStatus.CONFIRMED) {
        totalUSDC += BigInt(claim.usdcReceived);
        totalTokensBurned += BigInt(claim.tokensBurned);
      }
    }

    return {
      totalUSDC,
      totalTokensBurned,
      claimCount: claims.length,
    };
  }

  /**
   * Mark notification as sent
   */
  async markNotificationSent(claimId: string): Promise<void> {
    await this.userYieldClaimModel.updateOne(
      { _id: claimId },
      { notificationSent: true },
    );
  }

  /**
   * Get recent claims (for admin dashboard)
   */
  async getRecentClaims(limit = 50): Promise<UserYieldClaim[]> {
    return this.userYieldClaimModel
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }

  /**
   * Check if a user has claimed for a specific token
   */
  async hasUserClaimed(
    userAddress: string,
    tokenAddress: string,
  ): Promise<boolean> {
    const claim = await this.userYieldClaimModel.findOne({
      userAddress: userAddress.toLowerCase(),
      tokenAddress: tokenAddress.toLowerCase(),
      status: YieldClaimStatus.CONFIRMED,
    });

    return !!claim;
  }
}
