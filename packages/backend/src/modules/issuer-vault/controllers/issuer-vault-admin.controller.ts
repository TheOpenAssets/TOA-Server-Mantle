import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { IssuerVaultService } from '../services/issuer-vault.service';
import { CreateIssuerVaultDto } from '../dto/issuer-vault.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../../admin/guards/admin-role.guard';

/**
 * Admin-only endpoints for IssuerVault lifecycle management.
 * These deal with configuration and monitoring — NOT money movement.
 */
@Controller('admin/issuer-vault')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class IssuerVaultAdminController {
  constructor(private readonly issuerVaultService: IssuerVaultService) {}

  /**
   * Create a vault slot for an asset and register it on-chain.
   * Call this before listing the asset on the marketplace.
   */
  @Post('create')
  async createVault(@Body() dto: CreateIssuerVaultDto) {
    return this.issuerVaultService.createVaultForAsset(dto);
  }

  /**
   * Get all IssuerVault positions (admin monitoring view)
   */
  @Get('all')
  async getAllVaults() {
    return this.issuerVaultService.getAllVaults();
  }
}
