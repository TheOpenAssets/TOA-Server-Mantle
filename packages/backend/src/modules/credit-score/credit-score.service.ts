import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SolvencyPosition,
  SolvencyPositionDocument,
} from '@/src/database/schemas/solvency-position.schema';
import { CreditcoinSubstrateService } from '@/src/modules/blockchain/services/creditcoin-substrate.service';

export interface BorrowTerms {
  compositeScore: number;
  layer1Score: number;
  layer2Score: number;
  tier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  effectiveLtv: number;
  standardLtv: number;
  hasBoost: boolean;
}

@Injectable()
export class CreditScoreService {
  private readonly logger = new Logger(CreditScoreService.name);

  constructor(
    @InjectModel(SolvencyPosition.name)
    private readonly solvencyPositionModel: Model<SolvencyPositionDocument>,
    private readonly substrateService: CreditcoinSubstrateService,
  ) {}

  async getLayer1Score(walletAddress: string): Promise<number> {
    try {
      const positions = await this.solvencyPositionModel.find({
        userAddress: walletAddress.toLowerCase(),
      });

      if (!positions || positions.length === 0) {
        return 500;
      }

      let score = 500;

      for (const position of positions) {
        if (position.repaymentSchedule && position.repaymentSchedule.length > 0) {
          for (const installment of position.repaymentSchedule) {
            if (installment.status === 'PAID') {
              score += 15;
            } else if (installment.status === 'MISSED') {
              score -= 30;
            }
          }
        }

        if (position.isDefaulted === true) {
          score -= 250;
        }

        if (position.healthStatus === 'HEALTHY') {
          score += 20;
        }
      }

      return Math.max(0, Math.min(1000, score));
    } catch (error) {
      this.logger.error(`getLayer1Score failed for ${walletAddress}`, error);
      return 500;
    }
  }

  async getCompositeScore(
    walletAddress: string,
  ): Promise<{ layer1: number; layer2: number; composite: number }> {
    const [layer1, layer2] = await Promise.all([
      this.getLayer1Score(walletAddress),
      this.substrateService.getProtocolScore(walletAddress),
    ]);

    let composite: number;
    if (layer2 === 0) {
      composite = layer1;
    } else {
      composite = Math.round(layer1 * 0.6 + layer2 * 0.4);
    }

    return { layer1, layer2, composite };
  }

  async getBorrowTerms(walletAddress: string): Promise<BorrowTerms> {
    const { layer1, layer2, composite } = await this.getCompositeScore(walletAddress);

    let tier: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    let effectiveLtv: number;

    if (composite >= 800) {
      tier = 'EXCELLENT';
      effectiveLtv = 7500;
    } else if (composite >= 600) {
      tier = 'GOOD';
      effectiveLtv = 7000;
    } else if (composite >= 400) {
      tier = 'FAIR';
      effectiveLtv = 6500;
    } else {
      tier = 'POOR';
      effectiveLtv = 5500;
    }

    const standardLtv = 7000;

    return {
      compositeScore: composite,
      layer1Score: layer1,
      layer2Score: layer2,
      tier,
      effectiveLtv,
      standardLtv,
      hasBoost: effectiveLtv > standardLtv,
    };
  }

  async getEffectiveLtv(walletAddress: string): Promise<number> {
    try {
      const result = await this.getBorrowTerms(walletAddress);
      return result.effectiveLtv;
    } catch (error) {
      this.logger.error(`getEffectiveLtv failed for ${walletAddress}`, error);
      return 7000;
    }
  }
}
