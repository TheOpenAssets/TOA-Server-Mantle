import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { GitActivity, GitActivitySchema } from '../../database/schemas/git-activity.schema';
import { GitMetrics, GitMetricsSchema } from '../../database/schemas/git-metrics.schema';
import { ChangelogController } from './controller/changelog.controller';
import { GitMetricsController } from './controller/git-metrics.controller';
import { ChangelogService } from './services/changelog.service';
import { GitHelperService } from './services/git-helper.service';
import { GitMetricsService } from './services/git-metrics.service';

@Module({
    imports: [
        ConfigModule,
        ScheduleModule.forRoot(),
        MongooseModule.forFeature([
            { name: GitActivity.name, schema: GitActivitySchema },
            { name: GitMetrics.name, schema: GitMetricsSchema },
        ]),
    ],
    controllers: [ChangelogController, GitMetricsController],
    providers: [ChangelogService, GitHelperService, GitMetricsService],
    exports: [ChangelogService, GitMetricsService],
})
export class ChangelogModule { }
