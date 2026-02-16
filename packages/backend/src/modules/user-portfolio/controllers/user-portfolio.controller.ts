import { Controller, Get, Post, Param, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
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
    const network = req.user.network || 'mantle';
    return this.portfolioService.getPortfolio(walletAddress, network);
  }

  @Post('rebuild/:walletAddress')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiOperation({ summary: 'Rebuild user portfolio from scratch (Admin only)' })
  async rebuildPortfolio(@Param('walletAddress') walletAddress: string, @Request() req: any) {
    const network = req.user.network || 'mantle';
    return this.portfolioService.rebuildPortfolio(walletAddress, network);
  }
}
