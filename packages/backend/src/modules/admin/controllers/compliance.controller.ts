import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';

export class ApproveAssetDto {
  assetId!: string;
  adminWallet!: string;
}

export class RejectAssetDto {
  assetId!: string;
  reason!: string;
}

@Controller('admin/compliance')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class ComplianceController {
  constructor(private readonly assetLifecycleService: AssetLifecycleService) {}

  @Post('approve')
  async approveAsset(@Body() dto: ApproveAssetDto) {
    return this.assetLifecycleService.approveAsset(dto.assetId, dto.adminWallet);
  }

  @Post('reject')
  async rejectAsset(@Body() dto: RejectAssetDto) {
    return this.assetLifecycleService.rejectAsset(dto.assetId, dto.reason);
  }
}
