import { Controller, Post, Body, UseGuards, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../guards/admin.guard';
import { AdminService } from '../services/admin.service';
import { UserRole } from '../../../database/schemas/user.schema';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('users/:walletAddress/role')
  async updateUserRole(
    @Param('walletAddress') walletAddress: string,
    @Body('role') role: UserRole,
  ) {
    return this.adminService.updateUserRole(walletAddress, role);
  }
}
