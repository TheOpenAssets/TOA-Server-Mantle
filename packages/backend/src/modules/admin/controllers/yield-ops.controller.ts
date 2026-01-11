import { Controller, Post, Body, UseGuards, Get, Param, Logger } from '@nestjs/common';
import { YieldDistributionService } from '../../yield/services/yield-distribution.service';
import { RecordSettlementDto, ConfirmUSDCDto, DistributeDto } from '../../yield/dto/yield-ops.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';
import { LeverageBlockchainService } from '../../leverage/services/leverage-blockchain.service';
import { LeveragePositionService } from '../../leverage/services/leverage-position.service';
import { ClaimYieldFromBurnDto, ProcessSettlementDto } from '../../leverage/dto/leverage.dto';

@Controller('admin/yield')
@UseGuards(JwtAuthGuard, AdminRoleGuard)
export class YieldOpsController {
  // private readonly logger = new Logger(YieldOpsController.name);

  constructor(
    private readonly yieldDistributionService: YieldDistributionService,
  ) { }

  @Post('settlement')
  async recordSettlement(@Body() dto: RecordSettlementDto) {
    return this.yieldDistributionService.recordSettlement(dto);
  }

  @Post('confirm-usdc')
  async confirmUSDC(@Body() dto: ConfirmUSDCDto) {
    return this.yieldDistributionService.confirmUSDCConversion(dto.settlementId, dto.usdcAmount);
  }

  @Post('distribute')
  async distribute(@Body() dto: DistributeDto) {
    return this.yieldDistributionService.distributeYield(dto.settlementId);
  }
}