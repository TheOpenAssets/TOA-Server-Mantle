import { Injectable, Logger } from '@nestjs/common';
import { IAdminDomainStrategy } from '../../../registry/interfaces/admin-domain.interface';
import { DeployTokenDto } from '../../../blockchain/dto/deploy-token.dto';
import { ListOnMarketplaceDto } from '../../../blockchain/dto/list-on-marketplace.dto';

@Injectable()
export class StellarAdminStrategy implements IAdminDomainStrategy {
  private readonly logger = new Logger(StellarAdminStrategy.name);

  async registerAsset(assetId: string): Promise<any> {
    throw new Error('Stellar registerAsset not implemented yet');
  }

  async deployToken(dto: DeployTokenDto): Promise<any> {
    throw new Error('Stellar deployToken not implemented yet');
  }

  async listOnMarketplace(dto: ListOnMarketplaceDto): Promise<any> {
    throw new Error('Stellar listOnMarketplace not implemented yet');
  }

  async revokeAsset(assetId: string, reason: string): Promise<any> {
    throw new Error('Stellar revokeAsset not implemented yet');
  }

  async endAuctionOnChain(assetId: string, clearingPrice: string): Promise<any> {
    throw new Error('Stellar endAuctionOnChain not implemented yet');
  }

  async approveMarketplace(assetId: string): Promise<any> {
    // Stellar might not need "approve" in the same way, or it might be a trustline
    throw new Error('Stellar approveMarketplace not implemented yet');
  }
}
