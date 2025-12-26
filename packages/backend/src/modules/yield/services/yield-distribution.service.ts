import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Settlement, SettlementDocument, SettlementStatus } from '../../../database/schemas/settlement.schema';
import { DistributionHistory, DistributionHistoryDocument } from '../../../database/schemas/distribution-history.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { TokenHolderTrackingService } from './token-holder-tracking.service';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { RecordSettlementDto } from '../dto/yield-ops.dto';

@Injectable()
export class YieldDistributionService {
  private readonly logger = new Logger(YieldDistributionService.name);

  constructor(
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    @InjectModel(DistributionHistory.name) private historyModel: Model<DistributionHistoryDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private holderTrackingService: TokenHolderTrackingService,
    private blockchainService: BlockchainService,
  ) {}

  async recordSettlement(dto: RecordSettlementDto) {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new NotFoundException('Asset not found or not tokenized');
    }

    // Dynamic Yield Model:
    // - settlementAmount = what debtor paid (₹50L)
    // - amountRaised = what investors paid during primary sale (varies!)
    // - platformFee = 1.5% of settlement
    // - netDistribution = settlementAmount - platformFee
    // - Yield = (netDistribution - amountRaised) / amountRaised (emergent!)

    const settlementAmount = dto.settlementAmount; // ₹50,00,000
    const amountRaised = parseFloat(asset.listing?.amountRaised || '0'); // What investors paid
    const platformFeeRate = 0.015; // 1.5% platform fee
    const platformFee = settlementAmount * platformFeeRate; // ₹75,000
    const netDistribution = settlementAmount - platformFee; // ₹49,25,000

    // Validation: Ensure we don't distribute less than what was raised
    if (netDistribution < amountRaised) {
      this.logger.warn(
        `Settlement distributes less than raised! Raised: ${amountRaised}, Distributing: ${netDistribution}`,
      );
      // This means investors will take a loss - should have risk management here
    }

    // Calculate effective yield for logging/analytics
    const effectiveYield = amountRaised > 0
      ? ((netDistribution - amountRaised) / amountRaised) * 100
      : 0;

    this.logger.log(
      `Settlement recorded: Raised ₹${amountRaised}, Distributing ₹${netDistribution}, Yield: ${effectiveYield.toFixed(2)}%`,
    );

    const settlement = await this.settlementModel.create({
      assetId: dto.assetId,
      tokenAddress: asset.token.address,
      settlementAmount,
      amountRaised,
      platformFeeRate,
      platformFee,
      netDistribution,
      status: SettlementStatus.PENDING_CONVERSION,
      settlementDate: new Date(dto.settlementDate),
    });

    return settlement;
  }

  async confirmUSDCConversion(settlementId: string, usdcAmount: string) {
    return this.settlementModel.findByIdAndUpdate(
      settlementId,
      {
        usdcAmount,
        status: SettlementStatus.READY_FOR_DISTRIBUTION,
        conversionTimestamp: new Date(),
      },
      { new: true },
    );
  }

  async distributeYield(settlementId: string) {
    const settlement = await this.settlementModel.findById(settlementId);
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== SettlementStatus.READY_FOR_DISTRIBUTION) {
      throw new Error('Settlement not ready for distribution');
    }

    const tokenAddress = settlement.tokenAddress;
    const usdcTotal = BigInt(settlement.usdcAmount!);

    // Get asset to determine token deployment date (start of yield calculation period)
    const asset = await this.assetModel.findOne({ 'token.address': tokenAddress });
    if (!asset || !asset.token?.deployedAt) {
      throw new Error('Asset or token deployment date not found');
    }

    // Calculate time-weighted distributions using token-days
    // Period: from token deployment (or last distribution) to now
    const fromDate = asset.token.deployedAt; // TODO: Use last distribution date if available
    const toDate = new Date();

    this.logger.log(
      `Calculating time-weighted yield distribution for ${tokenAddress} ` +
      `from ${fromDate.toISOString()} to ${toDate.toISOString()}`,
    );

    const holderTokenDays = await this.holderTrackingService.calculateTokenDays(
      tokenAddress,
      fromDate,
      toDate,
    );

    if (holderTokenDays.size === 0) {
      throw new Error('No holders with token-days found for distribution');
    }

    // Calculate total token-days across all holders
    const totalTokenDays = Array.from(holderTokenDays.values()).reduce((a, b) => a + b, 0n);

    if (totalTokenDays === 0n) {
      throw new Error('Total token-days is zero - cannot distribute');
    }

    // Calculate proportional distributions based on token-days
    const distributions = Array.from(holderTokenDays.entries())
      .map(([address, tokenDays]) => ({
        address,
        tokenDays,
        amount: (tokenDays * usdcTotal) / totalTokenDays,
      }))
      .filter(d => d.amount > 0n); // Filter out zero amounts

    this.logger.log(
      `Starting time-weighted distribution for ${tokenAddress}. ` +
      `Total holders: ${distributions.length}, ` +
      `Total token-days: ${totalTokenDays}, ` +
      `Distributing: ${settlement.usdcAmount} USDC, ` +
      `Amount originally raised: ${settlement.amountRaised}`,
    );

    // 4. Deposit Full Distribution to Vault
    await this.blockchainService.depositYield(tokenAddress, settlement.usdcAmount!);

    // 5. Distribute in Batches
    const batchSize = 50; // Conservative batch size
    for (let i = 0; i < distributions.length; i += batchSize) {
      const batch = distributions.slice(i, i + batchSize);

      const addresses = batch.map((d) => d.address);
      const amounts = batch.map((d) => d.amount.toString());

      try {
        const txHash = await this.blockchainService.distributeYield(tokenAddress, addresses, amounts);

        // Record History
        const historyRecords = batch.map((d) => ({
          settlementId,
          tokenAddress,
          recipient: d.address,
          amount: d.amount.toString(),
          txHash,
          distributedAt: new Date(),
          status: 'SUCCESS',
        }));

        await this.historyModel.insertMany(historyRecords);
      } catch (e) {
        this.logger.error(`Batch distribution failed`, e);
        // Record failure
         const failedRecords = batch.map((d) => ({
          settlementId,
          tokenAddress,
          recipient: d.address,
          amount: d.amount.toString(),
          distributedAt: new Date(),
          status: 'FAILED',
        }));
        await this.historyModel.insertMany(failedRecords);
      }
    }

    // 6. Update Settlement Status
    settlement.status = SettlementStatus.DISTRIBUTED;
    settlement.distributedAt = new Date();
    await settlement.save();

    return {
      message: 'Time-weighted distribution completed',
      totalDistributed: settlement.usdcAmount,
      holders: distributions.length,
      totalTokenDays: totalTokenDays.toString(),
      effectiveYield: settlement.amountRaised > 0
        ? `${(((settlement.netDistribution - settlement.amountRaised) / settlement.amountRaised) * 100).toFixed(2)}%`
        : 'N/A',
    };
  }

  // Helper placeholder - in prod add to BlockchainService
  private async getTotalSupply(tokenAddress: string): Promise<bigint> {
     // TODO: Implement readContract 'totalSupply' on BlockchainService
     // For now, returning a dummy value or fetching from Asset if available
     const asset = await this.assetModel.findOne({'token.address': tokenAddress});
     return asset && asset.token ? BigInt(asset.token.supply) : BigInt(0);
  }
}
