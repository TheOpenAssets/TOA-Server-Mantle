import { AssetStatus } from '@openassets/types';
import { CreateAssetDto } from '../../assets/dto/create-asset.dto';
import { RegisterAssetDto } from '../../blockchain/dto/register-asset.dto';

export interface IAssetOriginationService {
  /**
   * Create an asset record from an uploaded invoice/document
   */
  createAsset(userWallet: string, dto: CreateAssetDto, file: Express.Multer.File): Promise<any>;

  /**
   * Approve an asset, typically involves generating an attestation
   */
  approveAsset(assetId: string, adminWallet: string): Promise<any>;

  /**
   * Register the asset on-chain
   */
  registerAsset(assetId: string): Promise<any>;

  /**
   * Deploy the token for the asset
   */
  deployToken(assetId: string, totalSupply: string): Promise<any>;

  /**
   * List the asset on the primary marketplace
   */
  listOnMarketplace(assetId: string, duration?: number): Promise<any>;

  /**
   * Execute payout to the originator
   */
  payoutOriginator(assetId: string): Promise<any>;

  /**
   * Get an asset by ID
   */
  getAsset(assetId: string): Promise<any>;

  /**
   * Get all assets for an originator
   */
  getAssetsByOriginator(originator: string): Promise<any[]>;

  /**
   * Get all assets with optional filtering
   */
  getAllAssets(filters?: any): Promise<any>;

  /**
   * Reject an asset
   */
  rejectAsset(assetId: string, reason: string): Promise<any>;
}
