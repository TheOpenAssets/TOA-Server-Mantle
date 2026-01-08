import { Controller, Get, Post, Param, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { GitMetricsService } from '../services/git-metrics.service';

@Controller('ui-metrics')
export class GitMetricsController {
  private readonly logger = new Logger(GitMetricsController.name);

  constructor(private readonly gitMetricsService: GitMetricsService) {}

  @Get(':repoName')
  async getMetrics(@Param('repoName') repoName: string) {
    try {
      const metrics = await this.gitMetricsService.getMetrics(repoName);
      if (!metrics) {
        throw new HttpException('Metrics not found for this repository', HttpStatus.NOT_FOUND);
      }
      return {
        success: true,
        data: metrics,
      };
    } catch (error) {
        if (error instanceof HttpException) {
            throw error;
        }
      this.logger.error(`Failed to get metrics for ${repoName}`, error);
      throw new HttpException('Internal Server Error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('sync/:repoName')
  async syncMetrics(@Param('repoName') repoName: string) {
    try {
      const metrics = await this.gitMetricsService.refreshMetrics(repoName);
      return {
        success: true,
        message: 'Metrics refreshed successfully',
        data: metrics,
      };
    } catch (error) {
      this.logger.error(`Failed to sync metrics for ${repoName}`, error);
      throw new HttpException('Failed to refresh metrics', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
