import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { GitActivity, GitActivityKind } from '../../../database/schemas/git-activity.schema';
import { GitHelperService } from './git-helper.service';
import { GitMetricsService } from './git-metrics.service';

@Injectable()
export class ChangelogService implements OnModuleInit {
    private readonly logger = new Logger(ChangelogService.name);

    constructor(
        @InjectModel(GitActivity.name)
        private gitActivityModel: Model<GitActivity>,
        private gitHelperService: GitHelperService,
        private gitMetricsService: GitMetricsService,
    ) { }

    async onModuleInit() {
        const count = await this.gitActivityModel.countDocuments();

        if (count === 0) {
            this.logger.log('Database is empty. Triggering initial full sync...');
            await this.fullSync();
        } else {
            this.logger.log(`Database contains ${count} git activities`);
        }
    }

    @Cron('*/15 * * * *')
    async scheduledSync() {
        this.logger.log('Starting scheduled sync (every 3 hours)');
        await this.fullSync();
    }

    async fullSync(): Promise<void> {
        this.logger.log('=== Starting Full Sync ===');
        const startTime = Date.now();

        try {
            // Step 1: Sync Repositories
            await this.syncRepositories();

            // Step 2: Sync Branches, Commits, and PRs for each repo
            const repos = this.gitHelperService.getRepoNames();

            for (const repoName of repos) {
                try {
                    await this.syncRepositoryData(repoName);
                    await this.gitMetricsService.refreshMetrics(repoName);
                } catch (error: any) {
                    this.logger.error(`Failed to sync repo ${repoName}:`, error.message);
                    // Continue with next repo despite error
                }
            }

            const duration = ((Date.now() - startTime) / 1000).toFixed(2);
            this.logger.log(`=== Full Sync Completed in ${duration}s ===`);
        } catch (error: any) {
            this.logger.error('Full sync failed:', error.message);
            throw error;
        }
    }

    private async syncRepositories(): Promise<void> {
        this.logger.log('Syncing repositories...');

        try {
            const repos = await this.gitHelperService.fetchOrgRepos();

            for (const repo of repos) {
                this.logger.debug(`  Upserting repository: ${repo.name}`);
                await this.gitActivityModel.updateOne(
                    {
                        kind: GitActivityKind.REPOSITORY,
                        platformId: String(repo.id)
                    },
                    {
                        $set: {
                            kind: GitActivityKind.REPOSITORY,
                            platformId: String(repo.id),
                            repoName: repo.name,
                            author: repo.owner.login,
                            timestamp: new Date(repo.created_at),
                            raw: repo,
                        },
                    },
                    { upsert: true }
                );
            }

            this.logger.log(`✓ Successfully synced ${repos.length} repositories`);
        } catch (error: any) {
            this.logger.error('✗ Failed to sync repositories:', error?.message || String(error));
            throw error;
        }
    }

    private async syncRepositoryData(repoName: string): Promise<void> {
        this.logger.log(`Syncing data for repository: ${repoName}`);

        // Sync Branches
        await this.syncBranches(repoName);

        // Sync Commits for each branch
        await this.syncCommits(repoName);

        // Sync Pull Requests
        await this.syncPullRequests(repoName);
    }

    private async syncBranches(repoName: string): Promise<void> {
        this.logger.log(`Syncing branches for ${repoName}`);

        try {
            const branches = await this.gitHelperService.fetchBranches(repoName);
            const liveBranchNames = branches.map(b => b.name);

            // Upsert branches
            for (const branch of branches) {
                const platformId = `${repoName}:${branch.name}`;

                // GitHub Branches API only returns minimal commit info (sha, url)
                // We'll use the branch name as author and current time as timestamp
                // The commit sync will have the full author details
                const author = 'branch';
                const timestamp = new Date();

                await this.gitActivityModel.updateOne(
                    {
                        kind: GitActivityKind.BRANCH,
                        platformId,
                    },
                    {
                        $set: {
                            kind: GitActivityKind.BRANCH,
                            platformId,
                            repoName,
                            branchName: branch.name,
                            author,
                            timestamp,
                            raw: branch,
                        },
                    },
                    { upsert: true }
                );
            }

            // Reconciliation: Delete branches that no longer exist
            const deletedBranches = await this.gitActivityModel.deleteMany({
                kind: GitActivityKind.BRANCH,
                repoName,
                branchName: { $nin: liveBranchNames },
            });

            if (deletedBranches.deletedCount > 0) {
                this.logger.warn(`  Deleted ${deletedBranches.deletedCount} stale branches for ${repoName}`);
            }

            this.logger.log(`✓ Successfully synced ${branches.length} branches for ${repoName}`);
        } catch (error: any) {
            this.logger.error(`✗ Failed to sync branches for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }

    private async syncCommits(repoName: string): Promise<void> {
        this.logger.log(`Syncing commits for ${repoName}`);

        try {
            // Get all branches for this repo from DB
            const branches = await this.gitActivityModel.find({
                kind: GitActivityKind.BRANCH,
                repoName,
            });

            this.logger.debug(`  Found ${branches.length} branches to sync commits from`);
            let totalCommits = 0;

            for (const branch of branches) {
                try {
                    // Get the most recent commit timestamp for this branch to optimize fetch
                    const latestCommit = await this.gitActivityModel
                        .findOne({
                            kind: GitActivityKind.COMMIT,
                            repoName,
                            branchName: branch.branchName,
                        })
                        .sort({ timestamp: -1 });

                    const since = latestCommit?.timestamp;

                    if (!branch.branchName) {
                        this.logger.warn(`Branch without name found for repo ${repoName}`);
                        continue;
                    }

                    const commits = await this.gitHelperService.fetchCommits(
                        repoName,
                        branch.branchName,
                        since,
                    );

                    this.logger.debug(`  Processing ${commits.length} commits for ${repoName}:${branch.branchName}`);

                    for (const commit of commits) {
                        await this.gitActivityModel.updateOne(
                            {
                                kind: GitActivityKind.COMMIT,
                                platformId: commit.sha,
                            },
                            {
                                $set: {
                                    kind: GitActivityKind.COMMIT,
                                    platformId: commit.sha,
                                    repoName,
                                    branchName: branch.branchName,
                                    author: commit.author?.login || commit.commit.author.name,
                                    timestamp: new Date(commit.commit.author.date),
                                    raw: commit,
                                },
                            },
                            { upsert: true }
                        );
                    }

                    totalCommits += commits.length;
                } catch (error: any) {
                    this.logger.error(
                        `  ✗ Failed to sync commits for ${repoName}:${branch.branchName}:`,
                        error?.message || String(error),
                    );
                }
            }

            this.logger.log(`✓ Successfully synced ${totalCommits} commits across ${branches.length} branches for ${repoName}`);
        } catch (error: any) {
            this.logger.error(`✗ Failed to sync commits for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }

    private async syncPullRequests(repoName: string): Promise<void> {
        this.logger.log(`Syncing pull requests for ${repoName}`);

        try {
            const pullRequests = await this.gitHelperService.fetchPullRequests(repoName);

            for (const pr of pullRequests) {
                this.logger.debug(`  Upserting PR #${pr.number}: ${pr.title}`);
                await this.gitActivityModel.updateOne(
                    {
                        kind: GitActivityKind.PULL_REQUEST,
                        platformId: String(pr.id),
                    },
                    {
                        $set: {
                            kind: GitActivityKind.PULL_REQUEST,
                            platformId: String(pr.id),
                            repoName,
                            branchName: pr.head.ref,
                            author: pr.user.login,
                            timestamp: new Date(pr.created_at),
                            raw: pr,
                        },
                    },
                    { upsert: true }
                );
            }

            this.logger.log(`✓ Successfully synced ${pullRequests.length} pull requests for ${repoName}`);
        } catch (error: any) {
            this.logger.error(`✗ Failed to sync pull requests for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }

    async getCommits(filters: {
        repo?: string;
        branch?: string;
        author?: string;
        since?: Date;
        until?: Date;
        limit?: number;
    }): Promise<GitActivity[]> {
        const query: any = { kind: GitActivityKind.COMMIT };

        if (filters.repo) {
            query.repoName = filters.repo;
        }

        if (filters.branch) {
            query.branchName = filters.branch;
        }

        if (filters.author) {
            query.author = new RegExp(filters.author, 'i');
        }

        if (filters.since || filters.until) {
            query.timestamp = {};
            if (filters.since) {
                query.timestamp.$gte = filters.since;
            }
            if (filters.until) {
                query.timestamp.$lte = filters.until;
            }
        }

        return this.gitActivityModel
            .find(query)
            .sort({ timestamp: -1 })
            .limit(filters.limit || 100)
            .exec();
    }

    async getPullRequests(filters: {
        repo?: string;
        state?: string;
        limit?: number;
    }): Promise<GitActivity[]> {
        const query: any = { kind: GitActivityKind.PULL_REQUEST };

        if (filters.repo) {
            query.repoName = filters.repo;
        }

        if (filters.state) {
            query['raw.state'] = filters.state;
        }

        return this.gitActivityModel
            .find(query)
            .sort({ timestamp: -1 })
            .limit(filters.limit || 100)
            .exec();
    }

    async getTimeline(filters: {
        repo?: string;
        since?: Date;
        until?: Date;
        limit?: number;
    }): Promise<GitActivity[]> {
        const query: any = {
            kind: { $in: [GitActivityKind.COMMIT, GitActivityKind.PULL_REQUEST] },
        };

        if (filters.repo) {
            query.repoName = filters.repo;
        }

        if (filters.since || filters.until) {
            query.timestamp = {};
            if (filters.since) {
                query.timestamp.$gte = filters.since;
            }
            if (filters.until) {
                query.timestamp.$lte = filters.until;
            }
        }

        return this.gitActivityModel
            .find(query)
            .sort({ timestamp: -1 })
            .limit(filters.limit || 100)
            .exec();
    }

    async getOrganizationDetails(filters: { repo?: string }): Promise<any> {
        this.logger.log('Fetching organization details...');

        try {
            const orgName = this.gitHelperService.getOrgName();
            const configuredRepos = this.gitHelperService.getRepoNames();

            // Get all repositories from database
            const repoQuery: any = { kind: GitActivityKind.REPOSITORY };
            if (filters.repo) {
                repoQuery.repoName = filters.repo;
            }

             this.logger.log(`Configured repositories: ${repoQuery}`);

            const repositories = await this.gitActivityModel
                .find(repoQuery)
                .exec();

            // Get all branches from database
            const branchQuery: any = { kind: GitActivityKind.BRANCH };
            if (filters.repo) {
                branchQuery.repoName = filters.repo;
            }

            const branches = await this.gitActivityModel
                .find(branchQuery)
                .exec();

            // Get commit and PR counts for each repo
            const commitCounts = await this.gitActivityModel.aggregate([
                {
                    $match: {
                        kind: GitActivityKind.COMMIT,
                        ...(filters.repo ? { repoName: filters.repo } : {})
                    }
                },
                { $group: { _id: '$repoName', count: { $sum: 1 } } },
            ]);

            const prCounts = await this.gitActivityModel.aggregate([
                {
                    $match: {
                        kind: GitActivityKind.PULL_REQUEST,
                        ...(filters.repo ? { repoName: filters.repo } : {})
                    }
                },
                { $group: { _id: '$repoName', count: { $sum: 1 } } },
            ]);

            // Build the response structure
            const repoDetails = repositories.map((repo) => {
                const repoBranches = branches.filter(
                    (branch) => branch.repoName === repo.repoName,
                );

                const commitCount = commitCounts.find(
                    (c) => c._id === repo.repoName,
                )?.count || 0;

                const prCount = prCounts.find(
                    (p) => p._id === repo.repoName,
                )?.count || 0;

                return {
                    id: repo.platformId,
                    name: repo.repoName,
                    owner: repo.author,
                    createdAt: repo.timestamp,
                    url: repo.raw?.html_url,
                    description: repo.raw?.description,
                    defaultBranch: repo.raw?.default_branch,
                    isPrivate: repo.raw?.private,
                    statistics: {
                        totalBranches: repoBranches.length,
                        totalCommits: commitCount,
                        totalPullRequests: prCount,
                    },
                    branches: repoBranches.map((branch) => ({
                        name: branch.branchName,
                        lastCommitSha: branch.raw?.commit?.sha,
                        protected: branch.raw?.protected,
                        updatedAt: branch.updatedAt,
                    })),
                };
            });

            // Find missing repositories (configured but not synced)
            const syncedRepoNames = repositories.map(r => r.repoName);
            const missingRepos = configuredRepos.filter(
                configuredRepo => !syncedRepoNames.includes(configuredRepo)
            );

            // Warn about missing repositories
            if (missingRepos.length > 0) {
                this.logger.warn(
                    `⚠ ${missingRepos.length} configured repositories not found in database: ${missingRepos.join(', ')}`
                );
                this.logger.warn('These repositories may not have been synced yet or there may be access issues.');
            }

            const response = {
                organization: orgName,
                configuredRepositories: configuredRepos,
                syncedRepositories: syncedRepoNames,
                totalConfigured: configuredRepos.length,
                totalSynced: repositories.length,
                totalBranches: branches.length,
                totalRepositories: repositories.length,
                missingRepositories: missingRepos.length > 0 ? missingRepos : undefined,
                repositories: repoDetails,
                summary: {
                    totalCommits: commitCounts.reduce((sum, c) => sum + c.count, 0),
                    totalPullRequests: prCounts.reduce((sum, p) => sum + p.count, 0),
                },
            };

            this.logger.log(`✓ Successfully fetched organization details: ${repositories.length}/${configuredRepos.length} repositories synced`);
            return response;
        } catch (error: any) {
            this.logger.error('✗ Failed to fetch organization details:', error?.message || String(error));
            throw error;
        }
    }

    async getMetrics(repoName: string): Promise<any> {
        this.logger.log(`Fetching metrics for repo: ${repoName}`);
        try {
            const metrics = await this.gitMetricsService.getMetrics(repoName);
            if (!metrics) {
                this.logger.warn(`No metrics found for repo: ${repoName}`);
                return null;
            }
            this.logger.log(`✓ Successfully fetched metrics for ${repoName}`);
            return metrics;
        } catch (error: any) {
            this.logger.error(`✗ Failed to fetch metrics for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }
}