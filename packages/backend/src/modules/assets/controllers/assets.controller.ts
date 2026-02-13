import {
  Controller,
  Post,
  Get,
  Body,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  Req,
  Param,
  Query,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AssetLifecycleService } from '../services/asset-lifecycle.service';
import { ModuleRegistryService } from '../../registry/services/module-registry.service';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OriginatorGuard } from '../guards/originator.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';
import { AssetStatus } from '@openassets/types';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly moduleRegistryService: ModuleRegistryService,
    private readonly assetLifecycleService: AssetLifecycleService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) { }

  private get assetService() {
    return this.moduleRegistryService.getAssetOriginationService();
  }

  @Get()
  async getAllMyAssets(
    @Req() req: any,
    @Query('status') status?: AssetStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters = {
      status,
      originator: req.user.walletAddress, // Always filter by authenticated user's wallet
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    };

    return this.assetService.getAllAssets(filters);
  }

  @Post('upload')
  @UseGuards(OriginatorGuard)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/assets', // Ensure this directory exists
        filename: (req, file, cb) => {
          const randomName = Array(32)
            .fill(null)
            .map(() => Math.round(Math.random() * 16).toString(16))
            .join('');
          cb(null, `${randomName}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async uploadAsset(
    @Req() req: any,
    @Body() dto: CreateAssetDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.assetService.createAsset(req.user.walletAddress, dto, file);
  }

  @Get(':assetId')
  async getAsset(@Param('assetId') assetId: string) {
    return this.assetService.getAsset(assetId);
  }

  @Get('originator/my-assets')
  @UseGuards(OriginatorGuard)
  async getMyAssets(@Req() req: any) {
    return this.assetService.getAssetsByOriginator(req.user.walletAddress);
  }

  @Post(':assetId/payout')
  @UseGuards(AdminGuard)
  async payoutOriginator(@Param('assetId') assetId: string) {
    return this.assetService.payoutOriginator(assetId);
  }

  @Get(':assetId/purchase-history')
  async getPurchaseHistory(@Param('assetId') assetId: string) {
    return this.assetLifecycleService.getPurchaseHistory(assetId);
  }

  @Get('token/:address')
  async getAssetByTokenAddress(@Param('address') address: string) {
    const asset = await this.assetModel.findOne({
      'token.address': { $regex: new RegExp(`^${address}$`, 'i') }, // Case-insensitive match
    });

    if (!asset) {
      return { success: false, message: 'Asset not found for this token address' };
    }

    return { success: true, asset };
  }
}
