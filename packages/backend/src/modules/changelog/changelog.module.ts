import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { GitActivity, GitActivitySchema } from '../../database/schemas/git-activity.schema';
import { ChangelogController } from './controller/changelog.controller';
import { ChangelogService } from './services/changelog.service';
import { GitHelperService } from './services/git-helper.service';

@Module({
    imports: [
        ConfigModule,
        ScheduleModule.forRoot(),
        MongooseModule.forFeature([
            { name: GitActivity.name, schema: GitActivitySchema },
        ]),
    ],
    controllers: [ChangelogController],
    providers: [ChangelogService, GitHelperService],
    exports: [ChangelogService],
})
export class ChangelogModule { }