import { Controller, Post, Body, Get, Query, UseGuards, Request, HttpCode, Logger } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { ChallengeDto, LoginDto, RefreshDto } from '../dto/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  async getChallenge(@Query() query: ChallengeDto) {
    this.logger.log(`🔐 Challenge requested for wallet: ${query.walletAddress} (role: ${query.role})`);
    const result = await this.authService.createChallenge(query.walletAddress, query.role);
    this.logger.log(`✅ Challenge created with nonce: ${result.nonce.substring(0, 16)}...`);
    return result;
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
    this.logger.log(`🔑 Login attempt for wallet: ${loginDto.walletAddress}`);
    try {
      const result = await this.authService.login(loginDto);
      this.logger.log(`✅ Login successful for: ${loginDto.walletAddress}`);
      return result;
    } catch (error) {
      this.logger.error(`❌ Login failed for ${loginDto.walletAddress}: ${error}`);
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() refreshDto: RefreshDto) {
    return this.authService.refresh(refreshDto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async logout(@Request() req: any) {
    await this.authService.logout(req.user);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getProfile(@Request() req: any) {
    return req.user;
  }
}
