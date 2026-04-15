import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../../database/schemas/settlement.schema';
import { BlockchainService } from '../../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../../assets/services/asset-lifecycle.service';
import { NotificationService } from '../../../notifications/services/notification.service';
import { DeployTokenDto } from '../../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../../blockchain/dto/list-on-marketplace.dto';
import { NetworkRegistryService } from '../../../blockchain/services/network-registry.service';
import { IssuerVaultService } from '../../../issuer-vault/services/issuer-vault.service';
import { ConfigService } from '@nestjs/config';
import { MantleAdminStrategy } from '../mantle/mantle-admin-strategy.service';

@Injectable()
export class BnbAdminStrategy extends MantleAdminStrategy {
  private readonly bnbExplorerPrefix = 'https://testnet-explorer.hsk.xyz/tx/';

  private convertToBnbExplorerUrl(value: string): string {
    const txHashPattern = /(0x[a-fA-F0-9]{64})$/;
    const match = value.match(txHashPattern);

    if (!match) {
      return value;
    }

    return `${this.bnbExplorerPrefix}${match[1]}`;
  }

  constructor(
    @InjectModel(Asset.name) assetModel: Model<AssetDocument>,
    @InjectModel(Settlement.name) settlementModel: Model<SettlementDocument>,
    blockchainService: BlockchainService,
    networkRegistryService: NetworkRegistryService,
    assetLifecycleService: AssetLifecycleService,
    notificationService: NotificationService,
    configService: ConfigService,
    issuerVaultService: IssuerVaultService,
  ) {
    super(
      assetModel,
      settlementModel,
      blockchainService,
      networkRegistryService,
      assetLifecycleService,
      notificationService,
      configService,
      issuerVaultService,
    );
  }

  private rewriteExplorerUrls<T>(value: T): T {
    if (typeof value === 'string') {
      return this.convertToBnbExplorerUrl(value) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.rewriteExplorerUrls(item)) as T;
    }

    if (value && typeof value === 'object') {
      const transformed = Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (acc, [key, val]) => {
          acc[key] = this.rewriteExplorerUrls(val);
          return acc;
        },
        {},
      );
      return transformed as T;
    }

    return value;
  }

  async registerAsset(assetId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.registerAsset(assetId));
  }

  async deployToken(dto: DeployTokenDto): Promise<any> {
    return this.rewriteExplorerUrls(await super.deployToken(dto));
  }

  async listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any> {
    return this.rewriteExplorerUrls(await super.listOnMarketplace(dto));
  }

  async revokeAsset(assetId: string, reason: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.revokeAsset(assetId, reason));
  }

  async endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.endAuctionOnChain(assetId, clearingPrice));
  }

  async approveMarketplace(assetId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.approveMarketplace(assetId));
  }

  async supplyYieldSettlement(settlementId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.supplyYieldSettlement(settlementId));
  }
}
