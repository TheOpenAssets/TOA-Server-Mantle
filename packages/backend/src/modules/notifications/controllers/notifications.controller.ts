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

  @Get('test-auth')
  @UseGuards(JwtAuthGuard)
  testAuth(@Req() req: any) {
    return {
      success: true,
      message: 'JWT Auth working',
      user: {
        walletAddress: req.user.walletAddress,
        role: req.user.role,
        kyc: req.user.kyc,
      },
    };
  }

  @Get('stream')
  @UseGuards(JwtAuthGuard)
  async stream(@Req() req: any, @Res() res: Response) {
    try {
      // Normalize wallet address to lowercase for consistent matching
      const normalizedWallet = req.user.walletAddress.toLowerCase();

      console.log(`[SSE] Connection request from: ${req.user?.walletAddress || 'unknown'}`);
      console.log(`[SSE] Normalized wallet: ${normalizedWallet}`);

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable buffering for nginx

      // Write status code
      res.status(200);

      // Add connection with LOWERCASE wallet address
      this.sseService.addConnection(normalizedWallet, res);

      console.log(`[SSE] Connection established for: ${req.user.walletAddress}`);

      // Keep the connection alive - don't let NestJS close it
      // Wait indefinitely until the client disconnects
      await new Promise((resolve) => {
        res.on('close', () => {
          console.log(`[SSE] Client disconnected: ${normalizedWallet}`);
          resolve(null);
        });
      });
    } catch (error: any) {
      console.error(`[SSE] Connection error:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to establish SSE connection' });
      }
    }
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
