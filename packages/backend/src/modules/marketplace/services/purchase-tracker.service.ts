import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { createPublicClient, http, Hash, decodeEventLog } from 'viem';
import { mantleSepolia } from '../../../config/mantle-chain';
import { Purchase, PurchaseDocument } from '../../../database/schemas/purchase.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
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

    return {
      success: true,
      investorWallet,
      totalAssets: portfolioMap.size,
      totalPurchases: purchases.length,
      portfolio: Array.from(portfolioMap.values()),
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
