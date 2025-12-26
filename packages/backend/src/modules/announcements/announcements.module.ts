import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BullModule } from '@nestjs/bullmq';
import { AnnouncementController } from './controllers/announcement.controller';
import { AnnouncementService } from './services/announcement.service';
import { AuctionStatusProcessor } from './processors/auction-status.processor';
import { Announcement, AnnouncementSchema } from '../../database/schemas/announcement.schema';
import { Asset, AssetSchema } from '../../database/schemas/asset.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Announcement.name, schema: AnnouncementSchema },
      { name: Asset.name, schema: AssetSchema },
    ]),
    BullModule.registerQueue({
      name: 'auction-status-check',
    }),
  ],
  controllers: [AnnouncementController],
  providers: [AnnouncementService, AuctionStatusProcessor],
  exports: [AnnouncementService],
})
export class AnnouncementsModule {}
