import { Injectable, Logger } from '@nestjs/common';
import { AssetLifecycleService } from '../../services/asset-lifecycle.service';
import { IAssetOriginationService } from '../../../registry/interfaces/asset-origination.interface';
import { CreateAssetDto } from '../../dto/create-asset.dto';

@Injectable()
export class StellarAssetOriginationService implements IAssetOriginationService {
  private readonly logger = new Logger(StellarAssetOriginationService.name);

  constructor(
    private readonly assetLifecycleService: AssetLifecycleService,
  ) { }

  async createAsset(userWallet: string, dto: CreateAssetDto, file: Express.Multer.File): Promise<any> {
    return this.assetLifecycleService.createAsset(userWallet, dto, file);
  }

  async approveAsset(assetId: string, adminWallet: string): Promise<any> {
    return this.assetLifecycleService.approveAsset(assetId, adminWallet);
  }

  async registerAsset(assetId: string): Promise<any> {
    throw new Error('registerAsset should be called via AdminDomainStrategy');
  }

  async deployToken(assetId: string, totalSupply: string): Promise<any> {
    throw new Error('deployToken should be called via AdminDomainStrategy');
  }

  async listOnMarketplace(assetId: string, duration?: number): Promise<any> {
    throw new Error('listOnMarketplace should be called via AdminDomainStrategy');
  }

  async payoutOriginator(assetId: string): Promise<any> {
    return this.assetLifecycleService.payoutOriginator(assetId);
  }

  async getAsset(assetId: string): Promise<any> {
    return this.assetLifecycleService.getAsset(assetId);
  }

  async getAssetsByOriginator(originator: string): Promise<any[]> {
    return this.assetLifecycleService.getAssetsByOriginator(originator);
  }

  async getAllAssets(filters?: any): Promise<any> {
    return this.assetLifecycleService.getAllAssets(filters);
  }

  async rejectAsset(assetId: string, reason: string): Promise<any> {
    return this.assetLifecycleService.rejectAsset(assetId, reason);
  }
}
