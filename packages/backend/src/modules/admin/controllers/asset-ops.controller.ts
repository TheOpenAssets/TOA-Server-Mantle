import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { BlockchainService } from '../../blockchain/services/blockchain.service';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { DeployTokenDto } from '../../blockchain/dto/deploy-token.dto';

@Controller('admin/assets')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class AssetOpsController {
  constructor(
    private readonly blockchainService: BlockchainService,
    private readonly assetLifecycleService: AssetLifecycleService,
  ) {}

  @Post(':assetId/register')
  async registerAsset(@Param('assetId') assetId: string) {
    const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
    return this.blockchainService.registerAsset(payload);
  }

  @Post('deploy-token')
  async deployToken(@Body() dto: DeployTokenDto) {
    return this.blockchainService.deployToken(dto);
  }

  @Post(':assetId/revoke')
  async revokeAsset(@Param('assetId') assetId: string, @Body('reason') reason: string) {
    return this.blockchainService.revokeAsset(assetId, reason);
  }
}
