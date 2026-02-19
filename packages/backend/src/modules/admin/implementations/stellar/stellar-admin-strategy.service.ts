import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../../database/schemas/settlement.schema';
import { AssetLifecycleService } from '../../../assets/services/asset-lifecycle.service';
import { NotificationService } from '../../../notifications/services/notification.service';
import { NetworkRegistryService } from '../../../blockchain/services/network-registry.service';
import { IAdminDomainStrategy } from '../../../registry/interfaces/admin-domain.interface';
import { DeployTokenDto } from '../../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../../blockchain/dto/list-on-marketplace.dto';
import { toCanonical } from '../../../blockchain/utils/numeric-conversion';
import { ConfigService } from '@nestjs/config';
import { 
  AssetStatus, 
  NotificationType, 
  NotificationSeverity, 
  NotificationAction,
  ListingType
} from '@openassets/types';

@Injectable()
export class StellarAdminStrategy implements IAdminDomainStrategy {
  private readonly logger = new Logger(StellarAdminStrategy.name);

  constructor(
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
    @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
    private readonly networkRegistryService: NetworkRegistryService,
    private readonly assetLifecycleService: AssetLifecycleService,
    private readonly notificationService: NotificationService,
    private readonly configService: ConfigService,
  ) { }

  async registerAsset(assetId: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);

    const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
    
    this.logger.log(`Registering asset ${assetId} on Stellar AttestationRegistry...`);
    const result: any = await this.networkRegistryService.registerAssetOnChain(payload);

    await this.assetModel.updateOne(
      { assetId },
      {
        $set: {
          status: AssetStatus.REGISTERED,
          'registry.transactionHash': result.txId,
          'registry.registeredAt': new Date(),
          'checkpoints.registered': true,
        },
      } as any,
    );

    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Asset Registered On-Chain',
      detail: `Your asset ${asset.metadata.invoiceNumber} has been successfully registered on Stellar.`,
      type: NotificationType.ASSET_STATUS,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_ASSET,
      actionMetadata: { assetId },
    });

    return {
      success: true,
      message: 'Asset successfully registered on Stellar and database updated',
      assetId,
      status: AssetStatus.REGISTERED,
      transactionHash: result.txId,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.txId}`,
    };
  }

  async deployToken(dto: DeployTokenDto): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);

    this.logger.log(`Deploying Stellar native asset for ${dto.assetId}...`);
    
    const totalSupply = dto.totalSupply || asset.tokenParams?.totalSupply || '0';

    // Convert UUID to bytes32 format (same format used in AttestationRegistry)
    const assetIdBytes32 = '0x' + dto.assetId.replace(/-/g, '').padEnd(64, '0');

    // Derive asset code from invoice number if no symbol explicitly provided
    const invoiceNumber = (asset.metadata as any)?.invoiceNumber as string | undefined;
    const derivedSymbol = dto.symbol ||
      (invoiceNumber
        ? invoiceNumber.replace(/[^A-Z0-9]/gi, '').toUpperCase().substring(0, 12)
        : undefined);

    // Stellar deployment involves AssetRegistry registration which needs attestation data
    const result: any = await this.networkRegistryService.deployAssetToken(
      assetIdBytes32,
      totalSupply,
      {
        attestationHash: asset.attestation?.hash || '0x' + '0'.repeat(64),
        blobId: (asset.attestation as any)?.blobId || asset.attestation?.hash || '0x' + '0'.repeat(64),
        symbol: derivedSymbol
      }
    );

    const [assetCode] = result.primaryIdentifier.split(':');

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.TOKENIZED,
          'token.address': result.primaryIdentifier, // assetCode:issuerPubKey
          'token.deployedAt': new Date(),
          'token.transactionHash': result.txId,
          'token.supply': dto.totalSupply,
          'registry.assetCode': assetCode,
          'checkpoints.tokenized': true,
        },
      } as any,
    );

    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Token Deployment Complete',
      detail: `Your asset ${asset.metadata.invoiceNumber} has been tokenized on Stellar. Asset Code: ${assetCode}`,
      type: NotificationType.TOKEN_DEPLOYED,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_ASSET,
      actionMetadata: { assetId: dto.assetId, tokenAddress: result.primaryIdentifier },
    });

    return {
      success: true,
      message: 'Token deployed successfully on Stellar and database updated',
      assetId: dto.assetId,
      status: AssetStatus.TOKENIZED,
      tokenAddress: result.primaryIdentifier,
      transactionHash: result.txId,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.txId}`,
    };
  }

  async listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId: dto.assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    // Use asset.listing.type if available, otherwise fall back to assetType
    const listingType = (asset.listing?.type as unknown as ListingType) || (asset.assetType as unknown as ListingType);

    // Convert raw integer values from DB to canonical 4-decimal format
    // For Stellar, all values use 7-decimal stroops (tokens and USDC)
    const rawPrice = asset.tokenParams?.pricePerToken || '0';
    const priceCanonical = toCanonical(rawPrice, 7).value;

    const minInvestmentRaw = asset.tokenParams?.minInvestment || '0';
    const minInvestmentCanonical = toCanonical(minInvestmentRaw, 7).value;

    const duration = dto.duration ? parseInt(dto.duration) : (asset.listing?.duration || 0);

    const totalSupplyRaw = asset.token?.supply || asset.tokenParams?.totalSupply || '0';
    const totalSupplyCanonical = toCanonical(totalSupplyRaw, 7).value;

    if (listingType === ListingType.AUCTION && !duration) {
      throw new HttpException('Duration is required for AUCTION listings', HttpStatus.BAD_REQUEST);
    }

    const rawMinPrice = listingType === ListingType.AUCTION
      ? (asset.listing?.priceRange?.min || rawPrice)
      : '0';
    const minPriceCanonical = toCanonical(rawMinPrice, 7).value;

    this.logger.log(`Listing asset ${dto.assetId} on Stellar PrimaryMarket using canonical prices...`);
    const result: any = await this.networkRegistryService.listAssetOnMarketplace(
      asset.token.address,
      listingType,
      priceCanonical,
      minInvestmentCanonical,
      duration,
      totalSupplyCanonical,
      minPriceCanonical
    );

    await this.assetModel.updateOne(
      { assetId: dto.assetId },
      {
        $set: {
          status: AssetStatus.LISTED,
          'listing.type': listingType,
          'listing.price': priceCanonical,
          'listing.active': true,
          'listing.listedAt': new Date(),
          'listing.sold': '0',
          'listing.phase': listingType === ListingType.AUCTION ? 'BIDDING' : undefined,
          'listing.duration': duration,
          'listing.transactionHash': result.txId,
        },
      } as any,
    );

    await this.notificationService.create({
      userId: asset.originator,
      walletAddress: asset.originator,
      header: 'Asset Listed on Marketplace',
      detail: `Your asset ${asset.metadata.invoiceNumber} is now live on the Stellar marketplace.`,
      type: NotificationType.MARKETPLACE_LISTING,
      severity: NotificationSeverity.SUCCESS,
      action: NotificationAction.VIEW_MARKETPLACE,
      actionMetadata: { assetId: dto.assetId, tokenAddress: asset.token.address },
    });

    return {
      success: true,
      message: 'Token listed on Stellar marketplace',
      assetId: dto.assetId,
      transactionHash: result.txId,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.txId}`,
    };
  }

  async revokeAsset(assetId: string, _reason: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset) throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);

    this.logger.log(`Revoking asset ${assetId} on Stellar...`);
    
    // 1. Revoke in AttestationRegistry
    const result: any = await this.networkRegistryService.revokeAssetOnChain(assetId);

    // 2. If already tokenized, we should also revoke in AssetRegistry and deactivate listing
    if (asset.status === AssetStatus.TOKENIZED || asset.status === AssetStatus.LISTED) {
       // In a full implementation, the adapter's revokeAsset would handle this or we call them here
       // For now, our StellarBlockchainAdapter.revokeAsset only calls AttestationRegistry
       // but we could extend it.
    }

    await this.assetModel.updateOne(
        { assetId },
        { $set: { status: AssetStatus.REVOKED } }
    );

    return {
      success: true,
      message: 'Asset revoked on Stellar',
      assetId,
      transactionHash: result.txId,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.txId}`,
    };
  }

  async endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any> {
    const asset = await this.assetModel.findOne({ assetId });
    if (!asset || !asset.token?.address) {
      throw new HttpException('Asset or token not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`Ending auction for ${assetId} on Stellar...`);
    
    // 1. Deactivate listing on-chain
    const result: any = await this.networkRegistryService.endAuctionOnMarketplace(asset.token.address, clearingPrice);

    // 2. Delegate to shared lifecycle service for DB settlement
    const settlementResult = await this.assetLifecycleService.endAuction(assetId, clearingPrice, result.txId);

    return {
      ...settlementResult,
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${result.txId}`,
    };
  }

  async approveMarketplace(assetId: string): Promise<any> {
    this.logger.log(`approveMarketplace called for ${assetId} (No-op on Stellar)`);
    return {
      success: true,
      message: 'Operation not applicable for Stellar (no-op)',
      assetId,
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

    // For Stellar, token.address stores "ASSETCODE:ISSUER_PUBLIC_KEY"
    const tokenIdentifier = asset.token.address;
    
    // Convert USD to USDC stroops (7 decimals on Stellar)
    const platformFeeUsdcStroops = Math.floor(settlement.platformFee * 1e7);
    const netDistributionUsdcStroops = Math.floor(settlement.netDistribution * 1e7);

    this.logger.log(`[Stellar] Supplying yield settlement:`);
    this.logger.log(`   Settlement ID: ${settlementId}`);
    this.logger.log(`   Token: ${tokenIdentifier}`);
    this.logger.log(`   Platform Fee: $${settlement.platformFee.toFixed(2)} (${platformFeeUsdcStroops} stroops)`);
    this.logger.log(`   Net Distribution: $${settlement.netDistribution.toFixed(2)} (${netDistributionUsdcStroops} stroops)`);

    // Get admin wallet address for fee transfer
    const adminPublicKey = this.configService.get<string>('network.stellar.adminPublic');
    if (!adminPublicKey) {
      throw new HttpException('Stellar admin public key not configured', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // Step 1: Transfer platform fee to admin wallet
    this.logger.log(`[Stellar] Transferring platform fee to admin wallet...`);
    const feeResult = await this.networkRegistryService.transferUSDCForFee(
      adminPublicKey,
      platformFeeUsdcStroops.toString(),
    );

    // Step 2: Deposit net distribution to YieldVault
    this.logger.log(`[Stellar] Depositing net distribution to YieldVault...`);
    const vaultResult = await this.networkRegistryService.depositYieldToVault(
      tokenIdentifier,
      netDistributionUsdcStroops.toString(),
    );

    // Update settlement record with transaction hashes
    await this.settlementModel.findByIdAndUpdate(settlementId, {
      feeTransferTxHash: feeResult.txId,
      vaultDepositTxHash: vaultResult.txId,
    });

    this.logger.log(`[Stellar] Yield settlement supplied successfully`);
    this.logger.log(`   Fee Transfer TX: ${feeResult.txId}`);
    this.logger.log(`   Vault Deposit TX: ${vaultResult.txId}`);

    return {
      success: true,
      feeTransferTxHash: feeResult.txId,
      vaultDepositTxHash: vaultResult.txId,
      feeSkipped: feeResult.skipped,
      vaultSkipped: vaultResult.skipped,
      explorerUrls: {
        feeTransfer: `https://stellar.expert/explorer/testnet/tx/${feeResult.txId}`,
        vaultDeposit: `https://stellar.expert/explorer/testnet/tx/${vaultResult.txId}`,
      },
    };
  }
}
