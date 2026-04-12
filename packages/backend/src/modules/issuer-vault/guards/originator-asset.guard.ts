import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IssuerVaultPosition,
  IssuerVaultPositionDocument,
} from '../../../database/schemas/issuer-vault-position.schema';

/**
 * Ensures the authenticated user is the registered issuer for the requested asset vault.
 * Reads :assetId from route params and compares it to the vault's issuerAddress in DB.
 *
 * Must be used AFTER JwtAuthGuard so req.user is populated.
 */
@Injectable()
export class OriginatorAssetGuard implements CanActivate {
  constructor(
    @InjectModel(IssuerVaultPosition.name)
    private readonly vaultModel: Model<IssuerVaultPositionDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const assetId: string = request.params?.assetId;

    if (!assetId) {
      throw new ForbiddenException('assetId param required');
    }

    const vault = await this.vaultModel.findOne({ assetId });
    if (!vault) {
      throw new NotFoundException(`IssuerVault not found for asset ${assetId}`);
    }

    const walletMatch =
      vault.issuerAddress.toLowerCase() === (user?.walletAddress ?? '').toLowerCase();

    if (!walletMatch) {
      throw new ForbiddenException('You are not the registered issuer for this asset');
    }

    return true;
  }
}
