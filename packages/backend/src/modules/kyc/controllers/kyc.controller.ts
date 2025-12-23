import { Controller, Post, Get, Delete, UseGuards, Request, UploadedFile, UseInterceptors, ParseFilePipeBuilder, HttpStatus } from '@nestjs/common';
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
}
