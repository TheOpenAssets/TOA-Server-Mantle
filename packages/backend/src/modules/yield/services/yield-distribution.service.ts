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

    // Period: from token deployment (or last distribution) to now
    const fromDate = asset.token.deployedAt; // TODO: Use last distribution date if available
    const toDate = new Date();

    this.logger.log(
      `Calculating yield distribution for ${tokenAddress} ` +
      `from ${fromDate.toISOString()} to ${toDate.toISOString()}`,
    );

    // Try time-weighted distribution first
    let holderTokenDays = await this.holderTrackingService.calculateTokenDays(
      tokenAddress,
      fromDate,
      toDate,
    );

    let distributions: Array<{ address: string; tokenDays: bigint; amount: bigint }>;
    let totalTokenDays = 0n;
    let isTimeWeighted = true;

    // FALLBACK: If no transfer events available, use current holder balances
    if (holderTokenDays.size === 0) {
      this.logger.warn(
        `⚠️  No transfer events found for time-weighted distribution. ` +
        `Falling back to current holder balances (pro-rata distribution).`,
      );
      isTimeWeighted = false;

      // Try getting holders from database first
      let currentHolders: Array<{ holderAddress: string; balance: string }> = (
        await this.holderTrackingService.getHoldersAboveThreshold(tokenAddress, 0n)
      ).map(h => ({
        holderAddress: h.holderAddress,
        balance: h.balance,
      }));

      // FALLBACK LEVEL 2: If database is also empty, query blockchain directly
      if (currentHolders.length === 0) {
        this.logger.warn(
          `⚠️  No holders in database. Querying blockchain for current token holders...`,
        );
        currentHolders = await this.getHoldersFromBlockchain(tokenAddress);
      }

      if (currentHolders.length === 0) {
        throw new Error('No current holders found for distribution (checked DB and blockchain)');
      }

      this.logger.log(`Found ${currentHolders.length} current holders for pro-rata distribution`);

      // Calculate total balance across all holders
      const totalBalance = currentHolders.reduce(
        (sum, holder) => sum + BigInt(holder.balance),
        0n,
      );

      if (totalBalance === 0n) {
        throw new Error('Total holder balance is zero - cannot distribute');
      }

      // CRITICAL VALIDATION: Verify total balance matches token supply
      const expectedTotalSupply = BigInt(asset.tokenParams?.totalSupply || asset.token?.supply || '0');

      if (totalBalance !== expectedTotalSupply) {
        const percentageTracked = expectedTotalSupply > 0n
          ? Number((totalBalance * 10000n) / expectedTotalSupply) / 100
          : 0;

        this.logger.error(
          `❌ CRITICAL: Holder balances don't match total supply!\n` +
          `Total Supply: ${expectedTotalSupply.toString()}\n` +
          `Tracked Holders: ${totalBalance.toString()}\n` +
          `Percentage Tracked: ${percentageTracked}%\n` +
          `Holders Found: ${currentHolders.length}\n` +
          `This will result in incorrect yield distribution!`,
        );

        throw new Error(
          `Holder tracking incomplete: Only ${percentageTracked}% of tokens are tracked. ` +
          `Expected ${expectedTotalSupply} total supply but found ${totalBalance} in holder balances. ` +
          `Please run transfer event backfill before distributing yield.`,
        );
      }

      this.logger.log(
        `✓ Validation passed: Total holder balances (${totalBalance}) match total supply (${expectedTotalSupply})`,
      );

      // Create distributions based on current balance (pro-rata)
      distributions = currentHolders
        .map(holder => ({
          address: holder.holderAddress,
          tokenDays: BigInt(holder.balance), // Use balance instead of token-days
          amount: (BigInt(holder.balance) * usdcTotal) / totalBalance,
        }))
        .filter(d => d.amount > 0n);

      totalTokenDays = totalBalance; // For logging consistency
    } else {
      // Time-weighted distribution using token-days
      totalTokenDays = Array.from(holderTokenDays.values()).reduce((a, b) => a + b, 0n);

      if (totalTokenDays === 0n) {
        throw new Error('Total token-days is zero - cannot distribute');
      }

      // VALIDATION: Check if we have a reasonable number of holders
      const expectedTotalSupply = BigInt(asset.tokenParams?.totalSupply || asset.token?.supply || '0');
      const holderCount = holderTokenDays.size;

      this.logger.log(
        `Time-weighted distribution: ${holderCount} unique holders found\n` +
        `Total token-days: ${totalTokenDays}\n` +
        `Expected supply: ${expectedTotalSupply}`,
      );

      // Warning if holder count seems suspiciously low
      if (holderCount === 1 && expectedTotalSupply > 0n) {
        this.logger.warn(
          `⚠️  WARNING: Only 1 holder found for time-weighted distribution. ` +
          `This holder will receive 100% of the yield. ` +
          `Ensure this is correct before proceeding.`,
        );
      }

      distributions = Array.from(holderTokenDays.entries())
        .map(([address, tokenDays]) => ({
          address,
          tokenDays,
          amount: (tokenDays * usdcTotal) / totalTokenDays,
        }))
        .filter(d => d.amount > 0n);
    }

    this.logger.log(
      `Starting ${isTimeWeighted ? 'time-weighted' : 'pro-rata'} distribution for ${tokenAddress}. ` +
      `Total holders: ${distributions.length}, ` +
      `Total ${isTimeWeighted ? 'token-days' : 'balance'}: ${totalTokenDays}, ` +
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

        // Send notifications to each investor
        for (const distribution of batch) {
          try {
            const amountFormatted = (Number(distribution.amount) / 1e6).toFixed(2);
            await this.notificationService.create({
              userId: distribution.address,
              walletAddress: distribution.address,
              header: 'Yield Distributed',
              detail: `You have received ${amountFormatted} USDC as yield distribution for your investment.`,
              type: NotificationType.YIELD_DISTRIBUTED,
              severity: NotificationSeverity.SUCCESS,
              action: NotificationAction.VIEW_PORTFOLIO,
              actionMetadata: {
                assetId: settlement.assetId,
                tokenAddress,
                amount: distribution.amount.toString(),
                transactionHash: txHash,
                settlementId,
              },
            });
          } catch (notifError) {
            this.logger.error(`Failed to send yield notification to ${distribution.address}: ${notifError}`);
            // Don't throw - notification failure shouldn't fail the distribution
          }
        }
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
      message: `${isTimeWeighted ? 'Time-weighted' : 'Pro-rata'} distribution completed`,
      totalDistributed: settlement.usdcAmount,
      holders: distributions.length,
      totalTokenDays: totalTokenDays.toString(),
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
