import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../database/schemas/settlement.schema';
import { YieldClaim, YieldClaimDocument } from '../../../database/schemas/yield-claim.schema';
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
   * Get investor's portfolio
   */
  async getInvestorPortfolio(investorWallet: string) {
    const purchases = await this.purchaseModel
      .find({
        investorWallet: investorWallet.toLowerCase(),
        status: 'CONFIRMED'
      })
      .sort({ createdAt: -1 });

    // Group by asset
    const portfolioMap = new Map<string, any>();

    for (const purchase of purchases) {
      const existing = portfolioMap.get(purchase.assetId);

      if (existing) {
        existing.totalAmount = (BigInt(existing.totalAmount) + BigInt(purchase.amount)).toString();
        existing.totalInvested = (BigInt(existing.totalInvested) + BigInt(purchase.totalPayment)).toString();
        existing.purchaseCount += 1;
      } else {
        portfolioMap.set(purchase.assetId, {
          assetId: purchase.assetId,
          tokenAddress: purchase.tokenAddress,
          totalAmount: purchase.amount,
          totalInvested: purchase.totalPayment,
          purchaseCount: 1,
          firstPurchase: purchase.createdAt,
          lastPurchase: purchase.createdAt,
          metadata: purchase.metadata,
        });
      }
    }

    // Enrich portfolio with yield data
    const portfolio = await Promise.all(
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
              const totalSupply = BigInt(asset.tokenParams.totalSupply);

              // Calculate claimable yield: (userTokens * settlementUSDC) / totalSupply
              const claimableYieldRaw = totalSupply > 0n
                ? (userTokenBalance * settlementUSDC) / totalSupply
                : 0n;

              return {
                ...item,
                yieldInfo: {
                  settlementDistributed: true,
                  claimableYield: claimableYieldRaw.toString(), // in raw USDC (6 decimals)
                  claimableYieldFormatted: `${(Number(claimableYieldRaw) / 1e6).toFixed(2)} USDC`,
                  settlementDate: settlement.settlementDate,
                  settlementId: settlement._id,
                },
              };
            }
          }

          // No settlement yet
          return {
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

    return {
      success: true,
      investorWallet,
      totalAssets: portfolioMap.size,
      totalPurchases: purchases.length,
      portfolio,
    };
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
