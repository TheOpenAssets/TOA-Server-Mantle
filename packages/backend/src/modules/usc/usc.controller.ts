import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiTags,
} from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtAuthGuard } from '@/src/modules/auth/guards/jwt-auth.guard';
import { UscEvent, UscEventDocument } from '@/src/database/schemas/usc-event.schema';
import { UscProofService } from './usc-proof.service';
import { SubmitProofDto } from './dto/submit-proof.dto';

@ApiTags('usc')
@Controller('usc')
@UseGuards(JwtAuthGuard)
export class UscController {
  constructor(
    private readonly uscProofService: UscProofService,
    @InjectModel(UscEvent.name) private readonly uscEventModel: Model<UscEventDocument>,
  ) {}

  @Post('submit-proof')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit a cross-chain credit event proof for on-chain verification via USC precompile' })
  @ApiBody({ type: SubmitProofDto })
  @ApiResponse({ status: 200, description: 'Proof submitted. Returns txHash and verification status.' })
  @ApiResponse({ status: 400, description: 'Invalid proof or submission failed.' })
  async submitProof(@Body() dto: SubmitProofDto) {
    return this.uscProofService.submitProof(dto);
  }

  @Get('events/:walletAddress')
  @ApiOperation({ summary: 'Get verified cross-chain credit events for a wallet' })
  @ApiResponse({ status: 200, description: 'Returns list of verified cross-chain events, most recent first.' })
  async getEvents(@Param('walletAddress') walletAddress: string) {
    return this.uscEventModel
      .find({ walletAddress: walletAddress.toLowerCase() })
      .sort({ verifiedAt: -1 })
      .limit(50)
      .exec();
  }
}
