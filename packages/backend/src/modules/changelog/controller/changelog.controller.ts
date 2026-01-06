import { Controller, Get, Post, Query, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ChangelogService } from '../services/changelog.service';
import { CommitQueryDto, PullRequestQueryDto, TimelineQueryDto, OrganizationQueryDto } from '../dto/changelog-query.dto';

@Controller('changelog')
export class ChangelogController {
    private readonly logger = new Logger(ChangelogController.name);

    constructor(private readonly changelogService: ChangelogService) { }

    @Post('sync')
    @HttpCode(HttpStatus.OK)
    async triggerSync() {
        this.logger.log('POST /changelog/sync - Manual sync triggered');

        try {
            await this.changelogService.fullSync();
            this.logger.log('✓ Manual sync completed successfully');
            return {
                success: true,
                message: 'Sync triggered successfully',
                timestamp: new Date().toISOString(),
            };
        } catch (error: any) {
            this.logger.error('✗ Manual sync failed:', error?.message || String(error));
            throw error;
        }
    }

    @Get('commits')
    async getCommits(@Query() query: CommitQueryDto) {
        this.logger.log(`GET /changelog/commits - Query: ${JSON.stringify(query)}`);

        try {
            const filters = {
                repo: query.repo,
                branch: query.branch,
                author: query.author,
                since: query.since ? new Date(query.since) : undefined,
                until: query.until ? new Date(query.until) : undefined,
                limit: query.limit,
            };

            const commits = await this.changelogService.getCommits(filters);
            this.logger.log(`✓ Retrieved ${commits.length} commits`);

            return {
                success: true,
                count: commits.length,
                filters,
                data: commits,
            };
        } catch (error: any) {
            this.logger.error('✗ Failed to get commits:', error?.message || String(error));
            throw error;
        }
    }

    @Get('pull-requests')
    async getPullRequests(@Query() query: PullRequestQueryDto) {
        this.logger.log(`GET /changelog/pull-requests - Query: ${JSON.stringify(query)}`);

        try {
            const filters = {
                repo: query.repo,
                state: query.state,
                limit: query.limit,
            };

            const pullRequests = await this.changelogService.getPullRequests(filters);
            this.logger.log(`✓ Retrieved ${pullRequests.length} pull requests`);

            return {
                success: true,
                count: pullRequests.length,
                filters,
                data: pullRequests,
            };
        } catch (error: any) {
            this.logger.error('✗ Failed to get pull requests:', error?.message || String(error));
            throw error;
        }
    }

    @Get('timeline')
    async getTimeline(@Query() query: TimelineQueryDto) {
        this.logger.log(`GET /changelog/timeline - Query: ${JSON.stringify(query)}`);

        try {
            const filters = {
                repo: query.repo,
                since: query.since ? new Date(query.since) : undefined,
                until: query.until ? new Date(query.until) : undefined,
                limit: query.limit,
            };

            const timeline = await this.changelogService.getTimeline(filters);
            this.logger.log(`✓ Retrieved ${timeline.length} timeline items`);

            return {
                success: true,
                count: timeline.length,
                filters,
                data: timeline,
            };
        } catch (error: any) {
            this.logger.error('✗ Failed to get timeline:', error?.message || String(error));
            throw error;
        }
    }

    @Get('organization')
    async getOrganization(@Query() query: OrganizationQueryDto) {
        this.logger.log(`GET /changelog/organization - Query: ${JSON.stringify(query)}`);

        try {
            const filters = {
                repo: query.repo,
            };

            const organization = await this.changelogService.getOrganizationDetails(filters);
            this.logger.log(`✓ Retrieved organization details: ${organization.totalSynced}/${organization.totalConfigured} repositories synced`);

            return {
                success: true,
                data: organization,
            };
        } catch (error: any) {
            this.logger.error('✗ Failed to get organization details:', error?.message || String(error));
            throw error;
        }
    }
}