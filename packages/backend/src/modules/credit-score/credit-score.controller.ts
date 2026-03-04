import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/src/modules/auth/guards/jwt-auth.guard';
import { CreditScoreService, BorrowTerms } from '@/src/modules/credit-score/credit-score.service';

@ApiTags('credit-score')
@Controller('credit-score')
@UseGuards(JwtAuthGuard)
export class CreditScoreController {
  constructor(private readonly creditScoreService: CreditScoreService) {}

  @Get(':walletAddress')
  @ApiOperation({ summary: 'Get composite credit score and tier for a wallet' })
  @ApiResponse({
    status: 200,
    description: 'Returns composite score, layer scores, tier, and applicable LTV',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCreditScore(
    @Param('walletAddress') walletAddress: string,
  ): Promise<BorrowTerms> {
    return this.creditScoreService.getBorrowTerms(walletAddress);
  }

  @Get('borrow-terms/:walletAddress')
  @ApiOperation({ summary: 'Preview personalised borrowing terms before committing to a loan' })
  @ApiResponse({
    status: 200,
    description: 'Returns credit-adjusted LTV and borrowing tier preview',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getBorrowTerms(
    @Param('walletAddress') walletAddress: string,
  ): Promise<BorrowTerms> {
    return this.creditScoreService.getBorrowTerms(walletAddress);
  }
}
