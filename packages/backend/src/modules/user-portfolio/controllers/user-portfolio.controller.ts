import { Controller, Get, Post, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NetworkType } from '@openassets/types';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../admin/guards/admin.guard';
import { UserPortfolioService } from '../services/user-portfolio.service';
import { PortfolioResponseDto } from '../dto/portfolio-response.dto';

@ApiTags('Portfolio')
@Controller('portfolio')
@ApiBearerAuth()
export class UserPortfolioController {
  constructor(private readonly portfolioService: UserPortfolioService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Get full enriched user portfolio' })
  @ApiResponse({ status: 200, type: PortfolioResponseDto })
  async getPortfolio(@Request() req: any) {
    const walletAddress = req.user.walletAddress;
    const network = req.user.network as NetworkType;
    return this.portfolioService.getPortfolio(walletAddress, network);
  }

  @Post('rebuild/:walletAddress')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Rebuild user portfolio from scratch (Admin only)' })
  async rebuildPortfolio(@Param('walletAddress') walletAddress: string, @Request() req: any) {
    const network = req.user.network as NetworkType;
    return this.portfolioService.rebuildPortfolio(walletAddress, network);
  }

  @Get('validate/:walletAddress')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Validate portfolio sync status (Admin only)' })
  @ApiResponse({
    status: 200,
    description: 'Returns comparison between portfolio data and actual purchases/bids',
  })
  async validatePortfolio(@Param('walletAddress') walletAddress: string, @Request() req: any) {
    const network = req.user.network as NetworkType;
    return this.portfolioService.validatePortfolioSync(walletAddress, network);
  }
}
