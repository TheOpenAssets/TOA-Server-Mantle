import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { IsString, IsNotEmpty, IsNumber } from 'class-validator';
import { AssetLifecycleService } from '../../assets/services/asset-lifecycle.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminRoleGuard } from '../guards/admin-role.guard';

export class ApproveAssetDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  adminWallet!: string;
}

export class RejectAssetDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class ScheduleAuctionDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsNumber()
  startDelayMinutes!: number; // Minutes from now when auction should start
}

export class EndAuctionDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;

  @IsString()
  @IsNotEmpty()
  clearingPrice!: string; // Clearing price in USDC wei (6 decimals)

  @IsString()
  @IsNotEmpty()
  transactionHash!: string; // Transaction hash from endAuction call
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

  @Post('schedule-auction')
  async scheduleAuction(@Body() dto: ScheduleAuctionDto) {
    return this.assetLifecycleService.scheduleAuction(dto.assetId, dto.startDelayMinutes);
  }

  @Get('auction-clearing-price/:assetId')
  async getAuctionClearingPriceSuggestion(@Param('assetId') assetId: string) {
    return this.assetLifecycleService.calculateSuggestedClearingPrice(assetId);
  }

  @Post('end-auction')
  async endAuction(@Body() dto: EndAuctionDto) {
    return this.assetLifecycleService.endAuction(dto.assetId, dto.clearingPrice, dto.transactionHash);
  }
}
