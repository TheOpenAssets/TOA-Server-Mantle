import { Controller, Get, Post, Patch, Param, Query, UseGuards, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { SseEmitterService } from '../services/sse-emitter.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly sseService: SseEmitterService,
  ) {}

  @Get('stream')
  // We handle auth manually here via query param token or cookie usually for SSE,
  // but for simplicity assuming header auth works or handling basic connect
  // SSE often requires token in query param: /stream?token=...
  // For this prototype, we'll assume the client sends the token and we validate via Guard if possible,
  // or logic inside. Let's use a custom logic to allow extracting user from req.
  @UseGuards(JwtAuthGuard)
  stream(@Req() req: any, @Res() res: Response) {
    this.sseService.addConnection(req.user.walletAddress, res);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  getNotifications(
    @Req() req: any,
    @Query('filter') filter: 'all' | 'unread' | 'read' = 'all',
    @Query('limit') limit = 20,
    @Query('offset') offset = 0,
  ) {
    return this.notificationService.getNotifications(req.user.walletAddress, filter, Number(limit), Number(offset));
  }

  @Get('unread-count')
  @UseGuards(JwtAuthGuard)
  async getUnreadCount(@Req() req: any) {
    const result = await this.notificationService.getNotifications(req.user.walletAddress, 'all', 1);
    return { unreadCount: result.meta.unreadCount };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async getNotificationById(@Req() req: any, @Param('id') id: string) {
    return this.notificationService.getNotificationById(req.user.walletAddress, id);
  }

  @Patch(':id/read')
  @UseGuards(JwtAuthGuard)
  async markRead(@Req() req: any, @Param('id') id: string) {
    await this.notificationService.markAsRead(req.user.walletAddress, id);
    return { success: true };
  }

  @Post('mark-all-read')
  @UseGuards(JwtAuthGuard)
  async markAllRead(@Req() req: any) {
    await this.notificationService.markAllRead(req.user.walletAddress);
    return { success: true };
  }
}
