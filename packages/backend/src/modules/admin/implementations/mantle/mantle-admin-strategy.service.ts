import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../../database/schemas/settlement.schema';
import { BlockchainService } from '../../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../../assets/services/asset-lifecycle.service';
import { NotificationService } from '../../../notifications/services/notification.service';
import { IAdminDomainStrategy } from '../../../registry/interfaces/admin-domain.interface';
import { DeployTokenDto } from '../../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../../blockchain/dto/list-on-marketplace.dto';
import { NetworkRegistryService } from '../../../blockchain/services/network-registry.service';
import { ConfigService } from '@nestjs/config';
import { privateKeyToAccount } from 'viem/accounts';
import { 
  AssetStatus, 
  NotificationType, 
  NotificationSeverity, 
  NotificationAction 
} from '@openassets/types';

@Injectable()
export class MantleAdminStrategy implements IAdminDomainStrategy {
  private readonly logger = new Logger(MantleAdminStrategy.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    private readonly blockchainService: BlockchainService,
    private readonly networkRegistryService: NetworkRegistryService,
    private readonly assetLifecycleService: AssetLifecycleService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) { }

  async registerAsset(assetId: string): Promise<any> {
    const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
    const txHash = await this.blockchainService.registerAsset(payload);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.REGISTERED,
          'registry.transactionHash': txHash,
          'registry.registeredAt': new Date(),
          'checkpoints.registered': true,
        },
      },
    );

    const asset = await this.assetModel.findOne({ assetId });
    if (asset) {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Asset Registered On-Chain',
        detail: `Your asset ${asset.metadata.invoiceNumber} has been successfully registered on the blockchain.`,
        type: NotificationType.ASSET_STATUS,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: { assetId },
      });
    }

    return {
      success: true,
      message: 'Asset successfully registered on-chain and database updated',
      assetId,
      status: AssetStatus.REGISTERED,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async deployToken(dto: DeployTokenDto): Promise<any> {
    const result = await this.blockchainService.deployToken(dto);

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.TOKENIZED,
          'token.address': result.tokenAddress,
          'token.deployedAt': new Date(),
          'token.transactionHash': result.hash,
          'token.supply': dto.totalSupply,
          'checkpoints.tokenized': true,
        },
      },
    );

    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (asset) {
      await this.notificationService.create({
        userId: asset.originator,
        walletAddress: asset.originator,
        header: 'Token Deployment Complete',
        detail: `Your asset ${asset.metadata.invoiceNumber} has been tokenized. Token address: ${result.tokenAddress}`,
        type: NotificationType.TOKEN_DEPLOYED,
        severity: NotificationSeverity.SUCCESS,
        action: NotificationAction.VIEW_ASSET,
        actionMetadata: { assetId: dto.assetId, tokenAddress: result.tokenAddress },
      });
    }

    return {
      success: true,
      message: 'Token deployed successfully and database updated',
      assetId: dto.assetId,
      status: AssetStatus.TOKENIZED,
      tokenAddress: result.tokenAddress,
      complianceAddress: result.complianceAddress,
      transactionHash: result.hash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${result.hash}`,
    };
  }

  async listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const listingType = asset.assetType;
    const price = asset.tokenParams?.pricePerToken;
    const minInvestment = asset.tokenParams?.minInvestment;
    const duration = dto.duration;

    if (listingType === 'AUCTION' && !duration) {
      throw new HttpException('Duration is required for AUCTION listings', HttpStatus.BAD_REQUEST);
    }

    if (!listingType || !price || !minInvestment) {
      throw new HttpException('Required listing parameters missing in database', HttpStatus.BAD_REQUEST);
    }

    const minPrice = listingType === 'AUCTION'
      ? (asset.listing?.priceRange?.min || price)
      : '0';

    const txHash = await this.blockchainService.listOnMarketplace(
      asset.token.address,
      listingType,
      price,
      minInvestment,
      duration,
      minPrice,
    );

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.LISTED,
          'listing.type': listingType,
          'listing.price': price,
          'listing.active': true,
          'listing.listedAt': new Date(),
          'listing.sold': '0',
          'listing.phase': listingType === 'AUCTION' ? 'BIDDING' : undefined,
          'listing.duration': duration,
        },
      },
    );

    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Asset Listed on Marketplace',
      detail: `Your asset ${asset.metadata.invoiceNumber} is now live on the marketplace.`,
      type: NotificationType.MARKETPLACE_LISTING,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_MARKETPLACE,
      actionMetadata: { assetId: dto.assetId, tokenAddress: asset.token.address },
    });

    return {
      success: true,
      message: 'Token listed on marketplace',
      assetId: dto.assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async revokeAsset(assetId: string, reason: string): Promise<any> {
    const txHash = await this.blockchainService.revokeAsset(assetId, reason);
    await this.assetModel.updateOne(
        { assetId },
        { $set: { status: AssetStatus.REVOKED } }
    );
    return {
      success: true,
      message: 'Asset revoked on-chain',
      assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const resultOrStatus: any = await this.networkRegistryService.endAuctionOnMarketplace(asset.token.address, clearingPrice);
    
    if (resultOrStatus.skipped) {
      throw new HttpException(`Auction end skipped: ${resultOrStatus.reason}`, HttpStatus.BAD_REQUEST);
    }

    const txId = resultOrStatus.txId;
    const result = await this.assetLifecycleService.endAuction(assetId, clearingPrice, txId);
    return {
      ...result,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txId}`,
    };
  }

  async approveMarketplace(assetId: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const txHash = await this.blockchainService.approveMarketplace(asset.token.address);

    return {
      success: true,
      message: 'Marketplace approved to spend tokens',
      assetId,
      transactionHash: txHash,
      explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    };
  }

  async supplyYieldSettlement(settlementId: string): Promise<any> {
    const settlement = await this.settlementModel.findById(settlementId).exec();
    if (!settlement) {
      throw new HttpException('Settlement not found', HttpStatus.NOT_FOUND);
    }

    if (!settlement.usdcAmount) {
      throw new HttpException('Settlement USDC amount not confirmed', HttpStatus.BAD_REQUEST);
    }

    const asset = await this.assetModel.findOne({ assetId: settlement.assetId }).exec();
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    const tokenAddress = asset.token.address;
    const platformFeeUsdcWei = Math.floor(settlement.platformFee * 1e6); // Convert USD to USDC wei (6 decimals)
    const netDistributionUsdcWei = Math.floor(settlement.netDistribution * 1e6);

    this.logger.log(`[Mantle] Supplying yield settlement:`);
    this.logger.log(`   Settlement ID: ${settlementId}`);
    this.logger.log(`   Token: ${tokenAddress}`);
    this.logger.log(`   Platform Fee: $${settlement.platformFee.toFixed(2)} (${platformFeeUsdcWei} USDC wei)`);
    this.logger.log(`   Net Distribution: $${settlement.netDistribution.toFixed(2)} (${netDistributionUsdcWei} USDC wei)`);

    // Get admin wallet address for fee transfer
    // Prefer explicit ADMIN_WALLET_ADDRESS config; fall back to deriving from private key
    let adminWalletAddress = this.configService.get<string>('blockchain.adminWallet');
    if (!adminWalletAddress) {
      const pk = this.configService.get<string>('blockchain.adminPrivateKey');
      if (!pk) {
        throw new HttpException('Admin wallet address not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      adminWalletAddress = privateKeyToAccount(pk as `0x${string}`).address;
      this.logger.log(`[Mantle] Derived admin wallet address from private key: ${adminWalletAddress}`);
    }

    // Step 1: Transfer platform fee to admin wallet
    this.logger.log(`[Mantle] Transferring platform fee to admin wallet...`);
    const feeResult = await this.networkRegistryService.transferUSDCForFee(
      adminWalletAddress,
      platformFeeUsdcWei.toString(),
    );

    // Step 2: Deposit net distribution to YieldVault
    this.logger.log(`[Mantle] Depositing net distribution to YieldVault...`);
    const vaultResult = await this.networkRegistryService.depositYieldToVault(
      tokenAddress,
      netDistributionUsdcWei.toString(),
    );

    // Update settlement record with transaction hashes
    await this.settlementModel.findByIdAndUpdate(settlementId, {
      feeTransferTxHash: feeResult.txId,
      vaultDepositTxHash: vaultResult.txId,
    });

    this.logger.log(`[Mantle] Yield settlement supplied successfully`);
    this.logger.log(`   Fee Transfer TX: ${feeResult.txId}`);
    this.logger.log(`   Vault Deposit TX: ${vaultResult.txId}`);

    return {
      success: true,
      feeTransferTxHash: feeResult.txId,
      vaultDepositTxHash: vaultResult.txId,
      feeSkipped: feeResult.skipped,
      vaultSkipped: vaultResult.skipped,
      explorerUrls: {
        feeTransfer: `https://sepolia.mantlescan.xyz/tx/${feeResult.txId}`,
        vaultDeposit: `https://sepolia.mantlescan.xyz/tx/${vaultResult.txId}`,
      },
    };
  }
}
