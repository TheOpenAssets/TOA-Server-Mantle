import { Controller, Get, Param, Query, Patch } from '@nestjs/common';
import { AnnouncementService } from '../services/announcement.service';
import { AnnouncementType, AnnouncementStatus } from '../../../database/schemas/announcement.schema';

@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Get()
  async getAllAnnouncements(
    @Query('type') type?: AnnouncementType,
    @Query('status') status?: AnnouncementStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.announcementService.getAllAnnouncements({
      type,
      status,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    });
  }

  @Get('asset/:assetId')
  async getAnnouncementsByAsset(@Param('assetId') assetId: string) {
    return this.announcementService.getAnnouncementsByAsset(assetId);
  }

  @Patch(':announcementId/archive')
  async archiveAnnouncement(@Param('announcementId') announcementId: string) {
    return this.announcementService.archiveAnnouncement(announcementId);
  }
}
