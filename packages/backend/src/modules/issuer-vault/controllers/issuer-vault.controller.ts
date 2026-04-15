import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { IssuerVaultService } from '../services/issuer-vault.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OriginatorAssetGuard } from '../guards/originator-asset.guard';

/**
 * Issuer-facing endpoints.
 * JwtAuthGuard verifies the JWT. OriginatorAssetGuard ensures the caller
 * is the registered issuer for the specific asset vault.
 *
 * Note: withdraw and repay are initiated from the frontend by having the issuer
 * sign the transaction directly with their wallet. These endpoints serve as
 * a lightweight proxy / sync trigger rather than executing on behalf of the issuer.
 * The actual on-chain tx is sent from the issuer's wallet via the frontend.
 * After the tx lands, the event listener picks it up and syncs the DB automatically.
 */
@Controller('issuer/vault')
@UseGuards(JwtAuthGuard)
export class IssuerVaultController {
  constructor(private readonly issuerVaultService: IssuerVaultService) {}

  /**
   * Get live debt summary for an asset vault.
   * Syncs from chain on every call to return fresh interest figure.
   */
  @Get(':assetId/debt')
  @UseGuards(OriginatorAssetGuard)
  async getDebtSummary(@Param('assetId') assetId: string) {
    return this.issuerVaultService.getDebtSummary(assetId);
  }

  /**
   * Get vault details for an asset (read-only, any authenticated user can check)
   */
  @Get(':assetId')
  async getVault(@Param('assetId') assetId: string) {
    return this.issuerVaultService.getVaultByAsset(assetId);
  }

  /**
   * Admin recovery: create the Settlement record for a vault that was fully repaid
   * on-chain but whose VaultFullyRepaid event was never processed by the backend.
   *
   * Body: { txHash: string, totalInterest: string }
   *   - txHash: the repayDebt transaction hash (from block explorer)
   *   - totalInterest: the totalInterest arg from the VaultFullyRepaid event (wei string)
   *     Pass "0" if the vault had no interest (e.g. same-block repayment).
   */
  @Post(':assetId/recover-settlement')
  @UseGuards(JwtAuthGuard)
  async recoverSettlement(
    @Param('assetId') assetId: string,
    @Body() body: { txHash: string; totalInterest: string },
  ) {
    return this.issuerVaultService.recoverSettlement(assetId, body.txHash, body.totalInterest);
  }
}
