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
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { AssetLifecycleService } from '../services/asset-lifecycle.service';
import { CreateAssetDto } from '../dto/create-asset.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OriginatorGuard } from '../guards/originator.guard';

@Controller('assets')
@UseGuards(JwtAuthGuard)
export class AssetsController {
  constructor(private readonly assetLifecycleService: AssetLifecycleService) {}

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
}
