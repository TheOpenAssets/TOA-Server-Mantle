import { DeployTokenDto } from '../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../blockchain/dto/list-on-marketplace.dto';

export interface IAdminDomainStrategy {
  /**
   * Register an asset on-chain
   */
  registerAsset(assetId: string): Promise<any>;

  /**
   * Deploy a token for an asset
   */
  deployToken(dto: DeployTokenDto): Promise<any>;

  /**
   * List a token on the marketplace
   */
  listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any>;

  /**
   * Revoke an asset from the blockchain
   */
  revokeAsset(assetId: string, reason: string): Promise<any>;

  /**
   * End an auction on-chain
   */
  endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any>;

  /**
   * Approve marketplace to spend tokens (EVM specific, but can be stubbed for others)
   */
  approveMarketplace(assetId: string): Promise<any>;
}
