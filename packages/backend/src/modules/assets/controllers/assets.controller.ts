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
import { CreateAssetDto } from '../dto/create-asset.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OriginatorGuard } from '../guards/originator.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { AssetStatus } from '../../../database/schemas/asset.schema';
import { Asset, AssetDocument } from '../../../database/schemas/asset.schema';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(
    private readonly assetLifecycleService: AssetLifecycleService,
    @InjectModel(Asset.name) private assetModel: Model<AssetDocument>,
  ) { }

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

    return this.assetLifecycleService.getAllAssets(filters);
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
    return this.assetLifecycleService.createAsset(req.user.walletAddress, dto, file);
  }

  @Get(':assetId')
  async getAsset(@Param('assetId') assetId: string) {
    return this.assetLifecycleService.getAsset(assetId);
  }

  @Get('originator/my-assets')
  @UseGuards(OriginatorGuard)
  async getMyAssets(@Req() req: any) {
    return this.assetLifecycleService.getAssetsByOriginator(req.user.walletAddress);
  }

  @Post(':assetId/payout')
  @UseGuards(AdminGuard)
  async payoutOriginator(@Param('assetId') assetId: string) {
    const result = await this.assetLifecycleService.payoutOriginator(assetId);
    if (result?.success) {
      await this.assetModel.updateOne(
        { assetId },
        { $set: { status: AssetStatus.PAYOUT_COMPLETE, 'listing.phase': 'PAYOUT_COMPLETE' } },
      );
    }
    return result;
  }

  @Get(':assetId/purchase-history')
  async getPurchaseHistory(@Param('assetId') assetId: string) {
    return this.assetLifecycleService.getPurchaseHistory(assetId);
  }
}
