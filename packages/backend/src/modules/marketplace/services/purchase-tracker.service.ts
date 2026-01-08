import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Connection } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../database/schemas/settlement.schema';
import { YieldClaim, YieldClaimDocument } from '../../../database/schemas/yield-claim.schema';
import { LeveragePosition } from '../../../database/schemas/leverage-position.schema';
import { ContractLoaderService } from '../../blockchain/services/contract-loader.service';
import { NotifyPurchaseDto } from '../dto/notify-purchase.dto';
import { NotificationService } from '../../notifications/services/notification.service';
import { NotificationType, NotificationSeverity } from '../../notifications/enums/notification-type.enum';
import { NotificationAction } from '../../notifications/enums/notification-action.enum';
@Injectable()
export class PurchaseTrackerService {
  private readonly logger = new Logger(PurchaseTrackerService.name);
  private publicClient;

  constructor(
    private configService: ConfigService,
    private contractLoader: ContractLoaderService,
    @InjectModel(Purchase.name) private purchaseModel: Model<PurchaseDocument>,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    @InjectModel(YieldClaim.name) private yieldClaimModel: Model<YieldClaimDocument>,
    private notificationService: NotificationService,
    @InjectConnection() private connection: Connection,
  ) {
    this.publicClient = createPublicClient({
      chain: mantleSepolia,
      transport: http(this.configService.get('blockchain.rpcUrl')),
    });
  }

  /**
   * Validate and record a purchase transaction
   */
  async notifyPurchase(dto: NotifyPurchaseDto, investorWallet: string) {
    this.logger.log(`Processing purchase notification: ${dto.txHash}`);

    // Check if already processed
    const existing = await this.purchaseModel.findOne({ txHash: dto.txHash });
    if (existing) {
      this.logger.warn(`Purchase ${dto.txHash} already processed`);
      throw new ConflictException('Purchase already recorded');
    }

    // Validate transaction on-chain
    const purchaseData = await this.validatePurchaseTransaction(
      dto.txHash as Hash,
      dto.assetId,
      investorWallet,
    );

    if (!purchaseData) {
      throw new BadRequestException('Invalid purchase transaction');
    }

    // Get asset details
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // Record purchase in database
    const purchase = await this.purchaseModel.create({
      txHash: dto.txHash,
      assetId: dto.assetId,
      investorWallet: investorWallet.toLowerCase(),
      tokenAddress: asset.token?.address || '',
      amount: purchaseData.amount,
      price: purchaseData.price,
      totalPayment: purchaseData.totalPayment,
      blockNumber: purchaseData.blockNumber,
      blockTimestamp: new Date(purchaseData.timestamp * 1000),
      status: 'CONFIRMED',
      source: 'PRIMARY_MARKET',
      metadata: {
        assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
        industry: asset.metadata?.industry,
        riskTier: asset.metadata?.riskTier,
      },
    });

    this.logger.log(`Purchase recorded: ${purchase._id}`);

    // Update asset.listing.sold with verified amount from transaction
    try {
      const currentSold = BigInt(asset.listing?.sold || '0');
      const purchasedAmount = BigInt(purchaseData.amount);
      const newSoldAmount = currentSold + purchasedAmount;

      const updateResult = await this.assetModel.updateOne(
        { assetId: dto.assetId },
        {
          $set: {
            'listing.sold': newSoldAmount.toString(),
          },
        },
      );

      if (updateResult.modifiedCount > 0) {
        this.logger.log(
          `Asset ${dto.assetId} listing.sold updated: ${Number(purchasedAmount) / 1e18} tokens added, total sold: ${Number(newSoldAmount) / 1e18} tokens`,
        );
      } else {
        this.logger.warn(`Failed to update asset.listing.sold for ${dto.assetId}`);
      }
    } catch (error: any) {
      this.logger.error(`Error updating asset.listing.sold: ${error.message}`);
      // Don't fail the purchase if sold tracking update fails
    }

    // Send notification to investor
    try {
      const tokenAmountFormatted = (Number(purchaseData.amount) / 1e18).toFixed(2);
      const totalPaymentFormatted = (Number(purchaseData.totalPayment) / 1e6).toFixed(2);
      const assetName = `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`;

      await this.notificationService.create({
        userId: investorWallet,
        walletAddress: investorWallet,
        header: 'Token Purchase Successful',
        detail: `You purchased ${tokenAmountFormatted} tokens of ${assetName} for $${totalPaymentFormatted}`,
        type: NotificationType.TOKEN_PURCHASED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId: dto.assetId,
          amount: purchaseData.amount,
          totalPayment: purchaseData.totalPayment,
          tokenAddress: asset.token?.address,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send purchase notification: ${error.message}`);
      // Don't fail the purchase if notification fails
    }

    return {
      success: true,
      purchaseId: purchase._id,
      assetId: dto.assetId,
      amount: purchaseData.amount,
      totalPayment: purchaseData.totalPayment,
      tokenAddress: asset.token?.address,
    };
  }

  /**
   * Validate purchase transaction on-chain
   */
  private async validatePurchaseTransaction(
    txHash: Hash,
    assetId: string,
    expectedBuyer: string,
  ): Promise<{
    amount: string;
    price: string;
    totalPayment: string;
    blockNumber: number;
    timestamp: number;
  } | null> {
    try {
      // Get transaction receipt
      const receipt = await this.publicClient.getTransactionReceipt({ hash: txHash });

      if (!receipt || receipt.status !== 'success') {
        this.logger.error(`Transaction not found or failed: ${txHash}`);
        return null;
      }

      // Get block to extract timestamp
      const block = await this.publicClient.getBlock({ blockNumber: receipt.blockNumber });

      // Decode TokensPurchased event from logs
      const marketplaceAddress = this.contractLoader.getContractAddress('PrimaryMarketplace');
      const abi = this.contractLoader.getContractAbi('PrimaryMarketplace');

      // Convert assetId to bytes32 for comparison
      const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== marketplaceAddress.toLowerCase()) {
          continue;
        }

        try {
          const decoded = decodeEventLog({
            abi,
            data: log.data,
            topics: log.topics,
          }) as { eventName: string; args: any };

          if (decoded.eventName === 'TokensPurchased') {
            const { assetId: eventAssetId, buyer, amount, price, totalPayment } = decoded.args;

            // Validate this is the correct purchase
            if (
              eventAssetId.toLowerCase() === assetIdBytes32.toLowerCase() &&
              buyer.toLowerCase() === expectedBuyer.toLowerCase()
            ) {
              return {
                amount: amount.toString(),
                price: price.toString(),
                totalPayment: totalPayment.toString(),
                blockNumber: Number(receipt.blockNumber),
                timestamp: Number(block.timestamp),
              };
            }
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }

      this.logger.error(`TokensPurchased event not found in transaction ${txHash}`);
      return null;
    } catch (error: any) {
      this.logger.error(`Error validating transaction ${txHash}:`, error.message);
      return null;
    }
  }

  /**
   * Record yield claim when investor burns tokens
   */
  async notifyYieldClaim(dto: any, investorWallet: string) {
    this.logger.log(`Processing yield claim notification: ${dto.txHash}`);

    // Check if already processed
    const existing = await this.yieldClaimModel.findOne({ txHash: dto.txHash });
    if (existing) {
      this.logger.warn(`Yield claim ${dto.txHash} already processed`);
      throw new ConflictException('Yield claim already recorded');
    }

    // Get asset details
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) {
      throw new BadRequestException('Asset not found');
    }

    // Get settlement info for metadata
    const settlement = await this.settlementModel.findOne({ assetId: dto.assetId }).sort({ createdAt: -1 });

    // Save yield claim record
    const yieldClaim = await this.yieldClaimModel.create({
      txHash: dto.txHash,
      assetId: dto.assetId,
      investorWallet: investorWallet.toLowerCase(),
      tokenAddress: asset.token?.address || '',
      tokensBurned: dto.tokensBurned,
      usdcReceived: dto.usdcReceived,
      blockNumber: dto.blockNumber ? parseInt(dto.blockNumber) : undefined,
      status: 'CONFIRMED',
      metadata: {
        assetName: `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`,
        industry: asset.metadata?.industry,
        settlementId: settlement?._id?.toString(),
      },
    });

    this.logger.log(`Yield claim recorded: ${yieldClaim._id}`);

    // Mark all purchases for this asset and investor as CLAIMED
    const updateResult = await this.purchaseModel.updateMany(
      {
        investorWallet: investorWallet.toLowerCase(),
        assetId: dto.assetId,
        status: 'CONFIRMED',
      },
      {
        $set: { status: 'CLAIMED' },
      }
    );

    this.logger.log(`Updated ${updateResult.modifiedCount} purchase records to CLAIMED status`);

    // Send notification to investor
    try {
      const tokensBurnedFormatted = (Number(dto.tokensBurned) / 1e18).toFixed(2);
      const usdcReceivedFormatted = (Number(dto.usdcReceived) / 1e6).toFixed(2);
      const assetName = `${asset.metadata?.invoiceNumber} - ${asset.metadata?.buyerName}`;

      await this.notificationService.create({
        userId: investorWallet,
        walletAddress: investorWallet,
        header: 'Yield Claimed Successfully',
        detail: `You burned ${tokensBurnedFormatted} ${assetName} tokens and received ${usdcReceivedFormatted} USDC.`,
        type: NotificationType.YIELD_DISTRIBUTED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_PORTFOLIO,
        actionMetadata: {
          assetId: dto.assetId,
          tokensBurned: dto.tokensBurned,
          usdcReceived: dto.usdcReceived,
          txHash: dto.txHash,
        },
      });
    } catch (error: any) {
      this.logger.error(`Failed to send yield claim notification: ${error.message}`);
      // Don't fail the claim if notification fails
    }

    return {
      success: true,
      message: 'Yield claim recorded successfully',
      yieldClaimId: yieldClaim._id,
      assetId: dto.assetId,
      tokensBurned: dto.tokensBurned,
      usdcReceived: dto.usdcReceived,
      purchasesUpdated: updateResult.modifiedCount,
    };
  }

  /**
   * Get investor's portfolio (includes both static purchases and leverage positions)
   */
  async getInvestorPortfolio(investorWallet: string) {
    this.logger.log(`Building portfolio for ${investorWallet.toLowerCase()} including CONFIRMED/CLAIMED purchases`);
    const purchases = await this.purchaseModel.find({
      investorWallet: investorWallet.toLowerCase(),
      status: { $in: ['CLAIMED', 'CONFIRMED'] },

    })
      .sort({ createdAt: -1 });

    // Group by asset
    const portfolioMap = new Map<string, any>();

    for (const purchase of purchases) {
      const existing = portfolioMap.get(purchase.assetId);

      // CRITICAL: Calculate net investment and balance correctly
      // - PRIMARY_MARKET/AUCTION: Money OUT (add to investment), tokens IN (add to balance)
      // - SECONDARY_MARKET with positive amount (buyer): Money OUT (add to investment), tokens IN (add to balance)
      // - SECONDARY_MARKET with negative amount (seller): Money IN (subtract from investment), tokens ALREADY ACCOUNTED in P2P_SELL_ORDER (skip for balance)
      // - P2P_SELL_ORDER: No effect on investment (escrow lock), tokens OUT (subtract from balance)
      // - P2P_ORDER_CANCELLED: No effect on investment (escrow unlock), tokens IN (add to balance)

      let investmentDelta = '0';
      let balanceDelta = purchase.amount; // Default: use purchase amount for balance
      const amount = BigInt(purchase.amount);
      const totalPayment = BigInt(purchase.totalPayment);

      if (purchase.source === 'PRIMARY_MARKET' || purchase.source === 'AUCTION') {
        // Initial purchase: money OUT, tokens IN
        investmentDelta = totalPayment.toString();
      } else if (purchase.source === 'SECONDARY_MARKET') {
        if (amount < 0n) {
          // Selling tokens: money IN (capital recovery) - SUBTRACT from investment
          // CRITICAL: Don't subtract from balance - already done in P2P_SELL_ORDER lock
          investmentDelta = (-totalPayment).toString();
          balanceDelta = '0'; // Don't double-count balance change
        } else {
          // Buying tokens: money OUT - ADD to investment, tokens IN
          investmentDelta = totalPayment.toString();
        }
      } else if (purchase.source === 'P2P_SELL_ORDER') {
        // Lock in escrow: no investment change, tokens leave wallet
        investmentDelta = '0';
      } else if (purchase.source === 'P2P_ORDER_CANCELLED') {
        // Unlock from escrow: no investment change, tokens return to wallet
        investmentDelta = '0';
      }

      if (existing) {
        existing.totalAmount = (BigInt(existing.totalAmount) + BigInt(balanceDelta)).toString();
        existing.totalInvested = (BigInt(existing.totalInvested) + BigInt(investmentDelta)).toString();
        existing.purchaseCount += 1;
        existing.transactions.push({
          date: purchase.createdAt,
          type: this.getTransactionType(purchase.source, amount),
          amount: purchase.amount,
          balanceDelta,
          price: purchase.price,
          totalValue: purchase.totalPayment,
          investmentDelta,
          txHash: purchase.txHash,
          source: purchase.source,
        });
      } else {
        portfolioMap.set(purchase.assetId, {
          assetId: purchase.assetId,
          tokenAddress: purchase.tokenAddress,
          totalAmount: purchase.status === 'CLAIMED' ? '0' : balanceDelta,
          totalInvested: investmentDelta,
          status: purchase.status,
          purchaseCount: 1,
          firstPurchase: purchase.createdAt,
          lastPurchase: purchase.createdAt,
          metadata: purchase.metadata,
          transactions: [{
            date: purchase.createdAt,
            type: this.getTransactionType(purchase.source, amount),
            amount: purchase.amount,
            balanceDelta: balanceDelta,
            price: purchase.price,
            totalValue: purchase.totalPayment,
            investmentDelta,
            txHash: purchase.txHash,
            source: purchase.source,
          }],
        });
      }
    }
    // Format transaction history for each asset
    for (const [assetId, item] of portfolioMap) {
      // Sort transactions by date (oldest first for running balance calculation)
      item.transactions.sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // Calculate running balances
      let runningTokens = 0n;
      let runningInvestment = 0n;

      item.transactionHistory = item.transactions.map((tx: any) => {
        runningTokens += BigInt(tx.amount);
        runningInvestment += BigInt(tx.investmentDelta);

        const tokenBalance = Number(runningTokens) / 1e18;
        const investmentBalance = Number(runningInvestment) / 1e6;
        const avgCost = runningTokens > 0n ? Number(runningInvestment) / Number(runningTokens) * 1e12 : 0;

        return {
          date: tx.date,
          type: tx.type,
          amount: tx.amount,
          amountFormatted: `${(Number(tx.amount) / 1e18).toFixed(2)} tokens`,
          price: tx.price,
          priceFormatted: `$${(Number(tx.price) / 1e6).toFixed(2)}`,
          totalValue: tx.totalValue,
          totalValueFormatted: `$${(Number(tx.totalValue) / 1e6).toFixed(2)}`,
          investmentDelta: tx.investmentDelta,
          investmentDeltaFormatted: `$${(Number(tx.investmentDelta) / 1e6).toFixed(2)}`,
          runningTokenBalance: tokenBalance.toFixed(2),
          runningInvestment: investmentBalance.toFixed(2),
          avgCostPerToken: avgCost.toFixed(2),
          txHash: tx.txHash,
          source: tx.source,
        };
      });

      // Remove raw transactions array (keep only formatted history)
      delete item.transactions;
    }

    // Enrich static portfolio with yield data and claim tx
    const staticPortfolio = await Promise.all(
      Array.from(portfolioMap.values()).map(async (item) => {
        try {
          // Check if settlement has been distributed for this asset
          const settlement = await this.settlementModel.findOne({
            assetId: item.assetId
          }).sort({ createdAt: -1 });

          if (settlement && settlement.usdcAmount) {
            // Get asset details for total supply
            const asset = await this.assetModel.findOne({ assetId: item.assetId });

            if (asset && asset.tokenParams?.totalSupply) {
              const userTokenBalance = BigInt(item.totalAmount);
              const settlementUSDC = BigInt(settlement.usdcAmount);
              const totalSupply = BigInt(asset.token?.supply || '0');
              console.log('TOTAL SUPPLY AFTER BURNING UNSOLD TOKENS:', totalSupply.toString());

              // Calculate claimable yield: (userTokens * settlementUSDC) / totalSupply
              const claimableYieldRaw = totalSupply > 0n
                ? (userTokenBalance * settlementUSDC) / totalSupply
                : 0n;

              const yieldInfo: any = {
                settlementDistributed: true,
                claimableYield: claimableYieldRaw.toString(), // in raw USDC (6 decimals)
                claimableYieldFormatted: `${(Number(claimableYieldRaw) / 1e6).toFixed(2)} USDC`,
                settlementDate: settlement.settlementDate,
                settlementId: settlement._id,
              };

              // If status is CLAIMED, fetch yield claim transaction hash
              if (item.status === 'CLAIMED') {
                const yieldClaim = await this.yieldClaimModel.findOne({
                  assetId: item.assetId,
                  investorWallet: investorWallet.toLowerCase(),
                });
                if (yieldClaim) {
                  yieldInfo.yieldClaimTxHash = yieldClaim.txHash;
                }
              }

              return {
                purchaseType: 'STATIC',
                ...item,
                yieldInfo,
              };
            }
          }

          // No settlement yet
          return {
            purchaseType: 'STATIC',
            ...item,
            yieldInfo: {
              settlementDistributed: false,
              claimableYield: '0',
              claimableYieldFormatted: '0.00 USDC',
            },
          };
        } catch (error) {
          this.logger.error(`Error calculating yield for asset ${item.assetId}: ${error}`);
          return {
            purchaseType: 'STATIC',
            ...item,
            yieldInfo: {
              settlementDistributed: false,
              claimableYield: '0',
              claimableYieldFormatted: '0.00 USDC',
            },
          };
        }
      })
    );

    // Fetch leverage positions for this investor
    const leveragePortfolio = await this.getLeveragePositionsForPortfolio(investorWallet);

    // Merge both portfolios
    const portfolio = [...staticPortfolio, ...leveragePortfolio];

    // Sort by date (most recent first)
    portfolio.sort((a, b) => {
      const dateA = a.firstPurchase || a.createdAt;
      const dateB = b.firstPurchase || b.createdAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return {
      success: true,
      investorWallet,
      totalAssets: portfolio.length,
      totalPurchases: purchases.length,
      totalLeveragePositions: leveragePortfolio.length,
      portfolio,
    };
  }

  /**
   * Get leverage positions formatted for portfolio
   */
  private async getLeveragePositionsForPortfolio(investorWallet: string): Promise<any[]> {
    try {
      // Check if LeveragePosition model is registered
      if (!this.connection.models['LeveragePosition']) {
        this.logger.warn('LeveragePosition model not registered, skipping leverage positions');
        return [];
      }

      // Get model through injected connection
      const LeveragePositionModel = this.connection.model<LeveragePosition>('LeveragePosition');

      // Fetch all positions for this user (ACTIVE or SETTLED)
      const positions = await LeveragePositionModel.find({
        userAddress: investorWallet.toLowerCase(),
        status: { $in: ['ACTIVE', 'SETTLED'] },
      }).sort({ createdAt: -1 });

      // Fetch asset details for all positions in parallel
      const assetIds = positions.map(p => p.assetId);
      const assets = await this.assetModel.find({ assetId: { $in: assetIds } });
      const assetMap = new Map(assets.map(a => [a.assetId, a]));

      // Map positions to portfolio format
      return positions.map((position: any) => {
        const isActive = position.status === 'ACTIVE';
        const isSettled = position.status === 'SETTLED';

        // Get asset metadata
        const asset = assetMap.get(position.assetId);
        const assetMetadata = asset ? {
          assetName: `${asset.metadata?.invoiceNumber || 'N/A'} - ${asset.metadata?.buyerName || 'N/A'}`,
          industry: asset.metadata?.industry,
          riskTier: asset.metadata?.riskTier,
          positionType: 'Leveraged Position',
        } : {
          positionType: 'Leveraged Position',
        };

        const baseItem = {
          purchaseType: 'LEVERAGE',
          positionId: position.positionId,
          assetId: position.assetId,
          tokenAddress: position.rwaTokenAddress,
          totalAmount: position.rwaTokenAmount, // RWA tokens held
          status: position.status,
          createdAt: position.createdAt,
          firstPurchase: position.createdAt, // For sorting compatibility
          metadata: assetMetadata,
        };

        // Format harvest history
        const harvestHistory = (position.harvestHistory || []).map((harvest: any) => ({
          timestamp: harvest.timestamp,
          mETHSwapped: harvest.mETHSwapped,
          mETHSwappedFormatted: `${(Number(harvest.mETHSwapped) / 1e18)} mETH`,
          usdcReceived: harvest.usdcReceived,
          usdcReceivedFormatted: `${(Number(harvest.usdcReceived) / 1e6)} USDC`,
          interestPaid: harvest.interestPaid,
          interestPaidFormatted: `${(Number(harvest.interestPaid) / 1e6)} USDC`,
          transactionHash: harvest.transactionHash,
          healthFactorBefore: harvest.healthFactorBefore,
          healthFactorBeforeFormatted: `${(harvest.healthFactorBefore / 100)}%`,
          healthFactorAfter: harvest.healthFactorAfter,
          healthFactorAfterFormatted: `${(harvest.healthFactorAfter / 100)}%`,
        }));

        if (isActive) {
          return {
            ...baseItem,
            mETHCollateral: position.mETHCollateral,
            usdcBorrowed: position.usdcBorrowed,
            healthFactor: position.currentHealthFactor / 100,
            healthStatus: position.healthStatus,
            totalInterestPaid: position.totalInterestPaid,
            lastHarvestTime: position.lastHarvestTime,
            harvestHistory,
            leverageInfo: {
              type: 'ACTIVE',
              mETHCollateralFormatted: `${(Number(position.mETHCollateral) / 1e18).toFixed(4)} mETH`,
              usdcBorrowedFormatted: `${(Number(position.usdcBorrowed) / 1e6).toFixed(2)} USDC`,
              healthFactorFormatted: `${(position.currentHealthFactor / 10000).toFixed(2)}%`,
              healthStatus: position.healthStatus,
              totalInterestPaidFormatted: `${(Number(position.totalInterestPaid) / 1e6).toFixed(2)} USDC`,
              claimableYield: '0', // Active positions haven't settled yet
              claimableYieldFormatted: '0.00 USDC',
              totalHarvests: harvestHistory.length,
            },
          };
        } else if (isSettled) {
          return {
            ...baseItem,
            mETHCollateral: position.mETHCollateral,
            usdcBorrowed: position.usdcBorrowed,
            totalInterestPaid: position.totalInterestPaid,
            settlementTxHash: position.settlementTxHash,
            harvestHistory,
            leverageInfo: {
              type: 'SETTLED',
              mETHCollateralFormatted: `${(Number(position.mETHCollateral) / 1e18).toFixed(4)} mETH`,
              usdcBorrowedFormatted: `${(Number(position.usdcBorrowed) / 1e6).toFixed(2)} USDC`,
              totalInterestPaidFormatted: `${(Number(position.totalInterestPaid) / 1e6).toFixed(2)} USDC`,
              userYield: position.userYieldDistributed || '0',
              userYieldFormatted: `${(Number(position.userYieldDistributed || '0') / 1e6).toFixed(2)} USDC`,
              mETHReturned: position.mETHReturnedToUser || '0',
              mETHReturnedFormatted: `${(Number(position.mETHReturnedToUser || '0') / 1e18).toFixed(4)} mETH`,
              settlementTxHash: position.settlementTxHash,
              settlementDate: position.settlementTimestamp,
              claimableYield: position.userYieldDistributed || '0',
              claimableYieldFormatted: `${(Number(position.userYieldDistributed || '0') / 1e6).toFixed(2)} USDC`,
              totalHarvests: harvestHistory.length,
            },
          };
        }

        return baseItem;
      });
    } catch (error: any) {
      this.logger.error(`Error fetching leverage positions: ${error.message}`);
      // Return empty array if leverage positions can't be fetched
      return [];
    }
  }

  /**
   * Helper to determine transaction type from source and amount
   */
  private getTransactionType(source: string, amount: bigint): string {
    if (source === 'PRIMARY_MARKET') return 'PRIMARY_PURCHASE';
    if (source === 'AUCTION') return 'AUCTION_SETTLEMENT';
    if (source === 'SECONDARY_MARKET') {
      return amount > 0n ? 'SECONDARY_BUY' : 'SECONDARY_SELL';
    }
    if (source === 'P2P_SELL_ORDER') return 'ORDER_LOCK';
    if (source === 'P2P_ORDER_CANCELLED') return 'ORDER_UNLOCK';
    return 'UNKNOWN';
  }

  /**
   * Get purchase history for investor
   */
  async getPurchaseHistory(investorWallet: string, limit = 50) {
    const purchases = await this.purchaseModel
      .find({ investorWallet: investorWallet.toLowerCase() })
      .sort({ createdAt: -1 })
      .limit(limit);

    return {
      success: true,
      count: purchases.length,
      purchases: purchases.map(p => ({
        txHash: p.txHash,
        assetId: p.assetId,
        amount: p.amount,
        totalPayment: p.totalPayment,
        price: p.price,
        purchaseDate: p.createdAt,
        status: p.status,
        metadata: p.metadata,
      })),
    };
  }
}
