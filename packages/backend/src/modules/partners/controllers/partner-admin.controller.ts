import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { PartnerService } from '../services/partner.service';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CreatePartnerDto, UpdatePartnerDto } from '../dto/partner-admin.dto';
import { PartnerStatus } from '../../../database/schemas/partner.schema';

@ApiTags('Admin - Partners')
@Controller('admin/partners')
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class PartnerAdminController {
  constructor(private readonly partnerService: PartnerService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new partner platform' })
  async createPartner(@Req() req: any, @Body() createDto: CreatePartnerDto) {
    const adminWallet = req.user.walletAddress || 'admin';
    return this.partnerService.createPartner(createDto, adminWallet);
  }

  @Get()
  @ApiOperation({ summary: 'List all partners' })
  async listPartners(@Query('status') status?: PartnerStatus) {
    const filter = status ? { status } : {};
    return this.partnerService.listPartners(filter);
  }

  @Get(':partnerId')
  @ApiOperation({ summary: 'Get partner details' })
  async getPartner(@Param('partnerId') partnerId: string) {
    const partner = await this.partnerService.findById(partnerId);
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  @Patch(':partnerId')
  @ApiOperation({ summary: 'Update partner details' })
  async updatePartner(
    @Param('partnerId') partnerId: string,
    @Body() updateDto: UpdatePartnerDto,
  ) {
    const partner = await this.partnerService.updatePartner(partnerId, updateDto);
    if (!partner) throw new NotFoundException('Partner not found');
    return partner;
  }

  @Post(':partnerId/regenerate-api-key')
  @ApiOperation({ summary: 'Regenerate partner API key' })
  async regenerateApiKey(@Param('partnerId') partnerId: string) {
    const result = await this.partnerService.regenerateApiKey(partnerId);
    if (!result) throw new NotFoundException('Partner not found');
    return result;
  }
}
