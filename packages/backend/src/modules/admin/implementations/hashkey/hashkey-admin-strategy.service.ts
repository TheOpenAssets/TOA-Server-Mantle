import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Asset, AssetDocument } from '../../../../database/schemas/asset.schema';
import { Settlement, SettlementDocument } from '../../../../database/schemas/settlement.schema';
import { BlockchainService } from '../../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../../assets/services/asset-lifecycle.service';
import { NotificationService } from '../../../notifications/services/notification.service';
import { NetworkRegistryService } from '../../../blockchain/services/network-registry.service';
import { IssuerVaultService } from '../../../issuer-vault/services/issuer-vault.service';
import { ConfigService } from '@nestjs/config';
import { MantleAdminStrategy } from '../mantle/mantle-admin-strategy.service';

@Injectable()
export class HashkeyAdminStrategy extends MantleAdminStrategy {
  private readonly hashkeyExplorerPrefix = 'https://hashkey-testnet.blockscout.com/tx/';

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

  private convertToHashkeyExplorerUrl(value: string): string {
    const txHashPattern = /(0x[a-fA-F0-9]{64})$/;
    const match = value.match(txHashPattern);
    if (!match) return value;
    return `${this.hashkeyExplorerPrefix}${match[1]}`;
  }

  private rewriteExplorerUrls<T>(value: T): T {
    if (typeof value === 'string') {
      return this.convertToHashkeyExplorerUrl(value) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.rewriteExplorerUrls(item)) as T;
    }
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
        (acc, [k, v]) => {
          acc[k] = this.rewriteExplorerUrls(v);
          return acc;
        },
        {},
      ) as T;
    }
    return value;
  }

  // Override every method that returns explorerUrl so HashKey URLs appear in responses

  override async registerAsset(assetId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.registerAsset(assetId));
  }

  override async deployToken(dto: any): Promise<any> {
    return this.rewriteExplorerUrls(await super.deployToken(dto));
  }

  override async listOnMarketplace(dto: any): Promise<any> {
    return this.rewriteExplorerUrls(await super.listOnMarketplace(dto));
  }

  override async approveMarketplace(assetId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.approveMarketplace(assetId));
  }

  override async supplyYieldSettlement(settlementId: string): Promise<any> {
    return this.rewriteExplorerUrls(await super.supplyYieldSettlement(settlementId));
  }
}
