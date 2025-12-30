import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, type Address } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Settlement, SettlementDocument, SettlementStatus } from '../../../database/schemas/settlement.schema';
import { DistributionHistory, DistributionHistoryDocument } from '../../../database/schemas/distribution-history.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { TokenHolderTrackingService } from './token-holder-tracking.service';
import { TransferEventBackfillService } from './transfer-event-backfill.service';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
import { RecordSettlementDto } from '../dto/yield-ops.dto';

@Injectable()
export class YieldDistributionService {
  private readonly logger = new Logger(YieldDistributionService.name);

  constructor(
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    @InjectModel(DistributionHistory.name) private historyModel: Model<DistributionHistoryDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    private holderTrackingService: TokenHolderTrackingService,
    private backfillService: TransferEventBackfillService,
    private blockchainService: BlockchainService,
    private notificationService: NotificationService,
    private configService: ConfigService,
  ) {}

  async recordSettlement(dto: RecordSettlementDto) {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new NotFoundException('Asset not found or not tokenized');
    }

    // Simple Burn-to-Claim Model:
    // - settlementAmount = what debtor paid (e.g., $100)
    // - amountRaised = what investors paid (stored in USDC WEI, 6 decimals)
    // - platformFee = 1.5% of settlement
    // - netDistribution = settlementAmount - platformFee
    // - Investors burn tokens to claim their pro-rata share

    const settlementAmount = dto.settlementAmount; // e.g., $100 USD

    // FIX: amountRaised is stored in USDC WEI (6 decimals), convert to USD
    const amountRaisedWei = parseFloat(asset.listing?.amountRaised || '0');
    const amountRaised = amountRaisedWei / 1e6; // Convert USDC WEI to USD

    const platformFeeRate = 0.015; // 1.5% platform fee
    const platformFee = settlementAmount * platformFeeRate; // e.g., $1.5
    const netDistribution = settlementAmount - platformFee; // e.g., $98.5

    // Validation: Ensure we don't distribute less than what was raised
    if (netDistribution < amountRaised) {
      this.logger.warn(
        `Settlement distributes less than raised! Raised: $${amountRaised.toFixed(2)}, Distributing: $${netDistribution.toFixed(2)}`,
      );
      // This means investors will take a loss - should have risk management here
    }

    // Calculate effective yield for logging/analytics
    const effectiveYield = amountRaised > 0
      ? ((netDistribution - amountRaised) / amountRaised) * 100
      : 0;

    this.logger.log(
      `Settlement recorded: Raised $${amountRaised.toFixed(2)}, Distributing $${netDistribution.toFixed(2)}, Yield: ${effectiveYield.toFixed(2)}%`,
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

    // Get asset info
    const asset = await this.assetModel.findOne({ 'token.address': tokenAddress });
    if (!asset) {
      throw new Error('Asset not found');
    }

    this.logger.log(
      `🔥 NEW BURN-TO-CLAIM MODEL: Depositing settlement to YieldVault\n` +
      `Token Address: ${tokenAddress}\n` +
      `Total Settlement: ${Number(usdcTotal) / 1e6} USDC\n` +
      `Investors will burn their tokens to claim their pro-rata share`,
    );

    // Simply deposit the settlement to YieldVault
    // Investors will claim directly by burning tokens (no backend distribution needed!)
    await this.blockchainService.depositYield(tokenAddress, settlement.usdcAmount!);

    // Update Settlement Status
    settlement.status = SettlementStatus.DISTRIBUTED;
    settlement.distributedAt = new Date();
    await settlement.save();

    // Send notification to all token holders (informational only)
    try {
      const usdcFormatted = (Number(usdcTotal) / 1e6).toFixed(2);

      // Get current token holders for notifications
      const holders = await this.holderTrackingService.getHoldersAboveThreshold(tokenAddress, 0n);

      for (const holder of holders) {
        try {
          await this.notificationService.create({
            userId: holder.holderAddress,
            walletAddress: holder.holderAddress,
            header: 'Settlement Ready - Claim Your Yield!',
            detail: `The invoice has been settled! Total: ${usdcFormatted} USDC. Burn your RWA tokens to claim your share.`,
            type: NotificationType.YIELD_DISTRIBUTED,
            severity: NotificationSeverity.SUCCESS,
            action: NotificationAction.VIEW_PORTFOLIO,
            actionMetadata: {
              assetId: settlement.assetId,
              tokenAddress,
              totalSettlement: usdcTotal.toString(),
              settlementId,
            },
          });
        } catch (notifError) {
          this.logger.error(`Failed to send notification to ${holder.holderAddress}: ${notifError}`);
        }
      }
    } catch (notifError) {
      this.logger.error(`Failed to send notifications: ${notifError}`);
      // Don't throw - notification failure shouldn't fail the distribution
    }

    this.logger.log(
      `✅ Settlement deposited successfully!\n` +
      `Investors can now burn their tokens to claim USDC.\n` +
      `Effective Yield: ${settlement.amountRaised > 0
        ? `${(((settlement.netDistribution - settlement.amountRaised) / settlement.amountRaised) * 100).toFixed(2)}%`
        : 'N/A'
      }`,
    );

    return {
      message: 'Settlement deposited to YieldVault - investors can now burn tokens to claim',
      totalDeposited: settlement.usdcAmount,
      tokenAddress,
      effectiveYield: settlement.amountRaised > 0
        ? `${(((settlement.netDistribution - settlement.amountRaised) / settlement.amountRaised) * 100).toFixed(2)}%`
        : 'N/A',
    };
  }

  /**
   * Query blockchain directly to get current token holders and their balances
   * This is a fallback when database tracking is not available
   */
  private async getHoldersFromBlockchain(tokenAddress: string): Promise<Array<{ holderAddress: string; balance: string }>> {
    const publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });

    // ERC20 Transfer event ABI
    const transferEventAbi = {
      type: 'event',
      name: 'Transfer',
      inputs: [
        { name: 'from', type: 'address', indexed: true },
        { name: 'to', type: 'address', indexed: true },
        { name: 'value', type: 'uint256', indexed: false },
      ],
    } as const;

    // ERC20 balanceOf function
    const erc20Abi = [
      {
        type: 'function',
        name: 'balanceOf',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ type: 'uint256' }],
      },
    ] as const;

    try {
      this.logger.log(`Querying blockchain for Transfer events to find holders...`);

      // Get asset to find deployment block
      const asset = await this.assetModel.findOne({ 'token.address': tokenAddress });
      const deploymentBlock = asset?.registry?.blockNumber;

      const currentBlock = await publicClient.getBlockNumber();
      const startBlock = deploymentBlock ? BigInt(deploymentBlock) : currentBlock - 10000n;

      this.logger.log(`Querying from block ${startBlock} to ${currentBlock} (${currentBlock - startBlock} blocks)`);

      // Query in chunks to avoid RPC 10k block limit
      const CHUNK_SIZE = 10000n;
      const allLogs: any[] = [];

      for (let from = startBlock; from <= currentBlock; from += CHUNK_SIZE) {
        const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;

        this.logger.log(`Querying chunk: blocks ${from} to ${to}`);

        const chunkLogs = await publicClient.getLogs({
          address: tokenAddress as Address,
          event: transferEventAbi,
          fromBlock: from,
          toBlock: to,
        });

        allLogs.push(...chunkLogs);
        this.logger.log(`Found ${chunkLogs.length} events in this chunk (total: ${allLogs.length})`);
      }

      this.logger.log(`Found ${allLogs.length} Transfer events total`);

      // Extract unique addresses that have received tokens
      const uniqueAddresses = new Set<string>();
      const zeroAddress = '0x0000000000000000000000000000000000000000';

      for (const log of allLogs) {
        if (log.args.to && log.args.to.toLowerCase() !== zeroAddress) {
          uniqueAddresses.add(log.args.to.toLowerCase());
        }
        if (log.args.from && log.args.from.toLowerCase() !== zeroAddress) {
          uniqueAddresses.add(log.args.from.toLowerCase());
        }
      }

      this.logger.log(`Found ${uniqueAddresses.size} unique addresses, querying balances...`);

      // Query current balance for each unique address
      const holders: Array<{ holderAddress: string; balance: string }> = [];

      for (const address of uniqueAddresses) {
        const balance = await publicClient.readContract({
          address: tokenAddress as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address as Address],
        }) as bigint;

        if (balance > 0n) {
          holders.push({
            holderAddress: address,
            balance: balance.toString(),
          });
        }
      }

      this.logger.log(`Found ${holders.length} holders with non-zero balances on-chain`);
      return holders;
    } catch (error: any) {
      this.logger.error(`Failed to query blockchain for holders: ${error?.message || error}`);
      throw new Error(`Could not fetch holders from blockchain: ${error?.message || error}`);
    }
  }

  // Helper placeholder - in prod add to BlockchainService
  private async getTotalSupply(tokenAddress: string): Promise<bigint> {
     // TODO: Implement readContract 'totalSupply' on BlockchainService
     // For now, returning a dummy value or fetching from Asset if available
     const asset = await this.assetModel.findOne({'token.address': tokenAddress});
     return asset && asset.token ? BigInt(asset.token.supply) : BigInt(0);
  }
}
