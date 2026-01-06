import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { GitMetrics } from '../../../database/schemas/git-metrics.schema';
import { GitActivity, GitActivityKind } from '../../../database/schemas/git-activity.schema';

@Injectable()
export class GitMetricsService {
  private readonly logger = new Logger(GitMetricsService.name);

  constructor(
    @InjectModel(GitMetrics.name) private gitMetricsModel: Model<GitMetrics>,
    @InjectModel(GitActivity.name) private gitActivityModel: Model<GitActivity>,
  ) {}

  async refreshMetrics(repoName: string): Promise<GitMetrics> {
    this.logger.log(`Refreshing metrics for repo: ${repoName}`);

    const [contributionData, graphData, contributors] = await Promise.all([
      this.calculateContributionData(repoName),
      this.calculateGraphData(repoName),
      this.calculateContributors(repoName),
    ]);

    return this.gitMetricsModel.findOneAndUpdate(
      { repoName },
      {
        repoName,
        contributionData,
        graphData,
        contributors,
      },
      { upsert: true, new: true },
    );
  }

  async getMetrics(repoName: string): Promise<GitMetrics | null> {
    return this.gitMetricsModel.findOne({ repoName }).exec();
  }

  private async calculateContributionData(repoName: string): Promise<{ date: string; count: number }[]> {
    // Aggregation to count commits per day
    // Ensure we use the author date from the commit, which is stored in timestamp field for GitActivity when kind=COMMIT
    const aggregation = await this.gitActivityModel.aggregate([
      {
        $match: {
          repoName,
          kind: GitActivityKind.COMMIT,
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' },
          },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          date: '$_id',
          count: 1,
          _id: 0,
        },
      },
      {
        $sort: { date: 1 },
      },
    ]);

    return aggregation;
  }

  private async calculateGraphData(repoName: string): Promise<any> {
    // 1. Fetch Commits
    const commits = await this.gitActivityModel
      .find({ repoName, kind: GitActivityKind.COMMIT })
      .select('raw timestamp platformId')
      .sort({ timestamp: -1 })
      .lean();

    const graphCommits = commits.map((activity) => {
      const raw = activity.raw;
      // Ensure we have the necessary structure for commit-graph
      return {
        sha: activity.platformId, // Using platformId as SHA
        commit: {
          author: {
            name: raw.commit.author.name,
            date: raw.commit.author.date,
            email: raw.commit.author.email,
          },
          message: raw.commit.message,
        },
        parents: raw.parents.map((p: any) => ({ sha: p.sha })),
        html_url: raw.html_url,
      };
    });

    // 2. Fetch Branches (Heads)
    const branches = await this.gitActivityModel
      .find({ repoName, kind: GitActivityKind.BRANCH })
      .select('branchName raw')
      .lean();

    const graphBranchHeads = branches.map((activity) => ({
      name: activity.branchName || 'unknown',
      commit: { sha: activity.raw.commit.sha },
      link: activity.raw._links?.html || activity.raw.url, // Fallback if links structure varies
    }));

    return {
      commits: graphCommits,
      branchHeads: graphBranchHeads,
    };
  }

  private async calculateContributors(repoName: string): Promise<{ name: string; author: string; avatarUrl: string; profileUrl: string }[]> {
    // Extract unique authors from commits
    const commits = await this.gitActivityModel
      .find({ repoName, kind: GitActivityKind.COMMIT })
      .select('raw')
      .lean();

    const contributorMap = new Map<string, { name: string; author: string; avatarUrl: string; profileUrl: string }>();

    for (const commit of commits) {
      const author = commit.raw.author; // GitHub 'author' object (the user)
      const commitAuthor = commit.raw.commit.author; // Git 'author' object (name/email)

      if (author && author.login) {
        if (!contributorMap.has(author.login)) {
          contributorMap.set(author.login, {
            name: commitAuthor.name || author.login,
            author: commit.raw.author,
            avatarUrl: author.avatar_url,
            profileUrl: author.html_url,
          });
        }
      } else if (commitAuthor.name) {
        // Fallback if no GitHub user is linked
        const key = commitAuthor.email || commitAuthor.name;
        if (!contributorMap.has(key)) {
          contributorMap.set(key, {
            name: commitAuthor.name,
            author: commitAuthor.name,
            avatarUrl: '', // No avatar for non-linked users
            profileUrl: '',
          });
        }
      }
    }

    return Array.from(contributorMap.values());
  }
}
