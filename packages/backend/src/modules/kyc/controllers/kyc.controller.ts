import { Controller, Post, Get, Delete, UseGuards, Request, UploadedFile, UseInterceptors, ParseFilePipeBuilder, HttpStatus, Res, StreamableFile } from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { KycService } from '../services/kyc.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('kyc')
@UseGuards(JwtAuthGuard)
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('document'))
  async upload(
    @Request() req: any,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(pdf|jpeg|jpg|png)$/ })
        .addMaxSizeValidator({ maxSize: 5 * 1024 * 1024 }) // 5MB
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.kycService.uploadDocument(req.user, file);
  }

  @Get('status')
  async getStatus(@Request() req: any) {
    return this.kycService.getStatus(req.user);
  }

  @Delete('documents')
  async deleteDocument(@Request() req: any) {
    return this.kycService.deleteDocument(req.user);
  }

  @Get('document')
  async getDocument(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    const { file, contentType } = await this.kycService.getDocument(req.user);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${req.user.walletAddress}-kyc-document"`,
    });
    return new StreamableFile(file);
  }

  @Post('manual-approve')
  async manualApprove(@Request() req: any) {
    // TEMPORARY: Manual approval for testing (remove in production)
    return this.kycService.manualApprove(req.user);
  }
}
