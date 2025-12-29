import { Controller, Post, Body, Get, Query, UseGuards, Request, HttpCode } from '@nestjs/common';
import { AuthService } from '../services/auth.service';
import { ChallengeDto, LoginDto, RefreshDto } from '../dto/auth.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('challenge')
  async getChallenge(@Query() query: ChallengeDto) {
    return this.authService.createChallenge(query.walletAddress, query.role);
  }

  @Post('login')
  @HttpCode(200)
  async login(@Body() loginDto: LoginDto) {
   
    return this.authService.login(loginDto);
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
