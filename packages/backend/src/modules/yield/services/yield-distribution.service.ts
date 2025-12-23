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

    const faceValue = parseFloat(asset.metadata.faceValue);
    const grossYield = dto.settlementAmount - faceValue;
    const platformFee = grossYield * 0.05; // 5% fee
    const netYield = grossYield - platformFee;

    const settlement = await this.settlementModel.create({
      assetId: dto.assetId,
      tokenAddress: asset.token.address,
      settlementAmount: dto.settlementAmount,
      grossYield,
      platformFee,
      netYield,
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

    // 1. Get Holders
    // Example threshold: 1 token (1e18)
    const holders = await this.holderTrackingService.getHoldersAboveThreshold(
      tokenAddress,
      BigInt(1e18), 
    );

    if (holders.length === 0) {
        throw new Error('No holders found for distribution');
    }

    // 2. Get Total Supply (from DB asset or blockchain)
    // Using blockchain for accuracy
    // Note: We need a getTotalSupply method in BlockchainService, adding placeholder logic
    // Or we assume asset.token.supply is accurate enough if we track burns.
    // Ideally, call chain.
    const totalSupply = await this.getTotalSupply(tokenAddress); // Helper below

    // 3. Calculate Amounts
    const usdcTotal = BigInt(settlement.usdcAmount!);
    const distributions = holders.map((holder) => ({
      address: holder.holderAddress,
      amount: (BigInt(holder.balance) * usdcTotal) / totalSupply,
    }));

    this.logger.log(`Starting distribution for ${tokenAddress}. Total holders: ${holders.length}`);

    // 4. Deposit Yield to Vault
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

    return { message: 'Distribution completed' };
  }

  // Helper placeholder - in prod add to BlockchainService
  private async getTotalSupply(tokenAddress: string): Promise<bigint> {
     // TODO: Implement readContract 'totalSupply' on BlockchainService
     // For now, returning a dummy value or fetching from Asset if available
     const asset = await this.assetModel.findOne({'token.address': tokenAddress});
     return asset && asset.token ? BigInt(asset.token.supply) : BigInt(0);
  }
}
