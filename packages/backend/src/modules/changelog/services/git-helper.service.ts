import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GitHelperService {
    private readonly logger = new Logger(GitHelperService.name);
    private readonly octokit: Octokit;
    private readonly githubOrg: string;
    private readonly githubRepos: string[];

    constructor(private configService: ConfigService) {
        const token = this.configService.get<string>('GITHUB_TOKEN');
        this.githubOrg = this.configService.get<string>('GITHUB_ORG') || '';
        const reposString = this.configService.get<string>('GITHUB_REPOS');
        this.githubRepos = reposString?.split(',').map(r => r.trim()) || [];

        if (!token || !this.githubOrg || this.githubRepos.length === 0) {
            throw new Error('Missing required GitHub configuration: GITHUB_TOKEN, GITHUB_ORG, or GITHUB_REPOS');
        }

        this.octokit = new Octokit({
            auth: token,
            headers: {
                'X-GitHub-Api-Version': '2022-11-28',
            },
        });
    }

    getOrgName(): string {
        return this.githubOrg;
    }

    getRepoNames(): string[] {
        return this.githubRepos;
    }

    /**
     * Generic pagination helper for GitHub API
     */
    async paginate<T>(
        apiCall: (page: number) => Promise<{ data: T[] }>,
    ): Promise<T[]> {
        const results: T[] = [];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            try {
                const response = await apiCall(page);

                if (!response.data || response.data.length === 0) {
                    hasMore = false;
                } else {
                    results.push(...response.data);
                    page++;
                }
            } catch (error: any) {
                this.logger.error(`Pagination error on page ${page}:`, error?.message || String(error));
                hasMore = false;
            }
        }

        return results;
    }

    /**
     * Fetch specific repositories from the organization
     */
    async fetchOrgRepos(): Promise<any[]> {
        this.logger.log(`Fetching repositories for org: ${this.githubOrg}`);

        try {
            const allRepos = await this.paginate(async (page) => {
                return this.octokit.repos.listForOrg({
                    org: this.githubOrg,
                    type: 'all', // Changed from 'private' to 'all' to include all repo types
                    per_page: 100,
                    page,
                });
            });

            this.logger.debug(`Found ${allRepos.length} total repositories in org`);
            this.logger.debug(`All repo names: ${allRepos.map((r: any) => r.name).join(', ')}`);
            this.logger.debug(`Looking for configured repos: ${this.githubRepos.join(', ')}`);

            // Filter to only include the configured repositories
            const filteredRepos = allRepos.filter((repo: any) =>
                this.githubRepos.includes(repo.name)
            );

            // Log which configured repos were found and which were missing
            const foundRepoNames = filteredRepos.map((r: any) => r.name);
            const missingRepoNames = this.githubRepos.filter(name => !foundRepoNames.includes(name));

            if (missingRepoNames.length > 0) {
                this.logger.warn(`⚠ ${missingRepoNames.length} configured repositories not found in organization: ${missingRepoNames.join(', ')}`);
                this.logger.warn('This may indicate a repository name mismatch or insufficient API token permissions');
            }

            this.logger.log(`✓ Successfully fetched ${filteredRepos.length}/${this.githubRepos.length} configured repositories`);
            if (filteredRepos.length > 0) {
                this.logger.debug(`Repositories: ${filteredRepos.map((r: any) => r.name).join(', ')}`);
            }
            return filteredRepos;
        } catch (error: any) {
            this.logger.error(`✗ Failed to fetch repositories for org ${this.githubOrg}:`, error?.message || String(error));
            throw error;
        }
    }

    /**
     * Fetch all branches for a repository
     */
    async fetchBranches(repoName: string): Promise<any[]> {
        this.logger.log(`Fetching branches for ${repoName}`);

        try {
            const branches = await this.paginate(async (page) => {
                return this.octokit.repos.listBranches({
                    owner: this.githubOrg,
                    repo: repoName,
                    per_page: 100,
                    page,
                });
            });

            this.logger.log(`✓ Successfully fetched ${branches.length} branches for ${repoName}`);
            if (branches.length > 0) {
                this.logger.debug(`Branches: ${branches.map((b: any) => b.name).join(', ')}`);
            }
            return branches;
        } catch (error: any) {
            this.logger.error(`✗ Failed to fetch branches for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }

    /**
     * Fetch commits for a specific branch
     */
    async fetchCommits(
        repoName: string,
        branchName: string,
        since?: Date,
    ): Promise<any[]> {
        const sinceMsg = since ? ` since ${since.toISOString()}` : '';
        this.logger.log(`Fetching commits for ${repoName}:${branchName}${sinceMsg}`);

        try {
            const params: any = {
                owner: this.githubOrg,
                repo: repoName,
                sha: branchName,
                per_page: 100,
            };

            if (since) {
                params.since = since.toISOString();
            }

            const commits = await this.paginate(async (page) => {
                return this.octokit.repos.listCommits({
                    ...params,
                    page,
                });
            });

            this.logger.log(`✓ Successfully fetched ${commits.length} commits for ${repoName}:${branchName}`);
            return commits;
        } catch (error: any) {
            this.logger.error(`✗ Failed to fetch commits for ${repoName}:${branchName}:`, error?.message || String(error));
            throw error;
        }
    }

    /**
     * Fetch pull requests for a repository
     */
    async fetchPullRequests(repoName: string): Promise<any[]> {
        this.logger.log(`Fetching pull requests for ${repoName}`);

        try {
            const pullRequests = await this.paginate(async (page) => {
                return this.octokit.pulls.list({
                    owner: this.githubOrg,
                    repo: repoName,
                    state: 'all',
                    sort: 'created',
                    direction: 'desc',
                    per_page: 100,
                    page,
                    mediaType: {
                        format: 'application/vnd.github.v3+json',
                    },
                });
            });

            this.logger.log(`✓ Successfully fetched ${pullRequests.length} pull requests for ${repoName}`);
            const states = pullRequests.reduce((acc: any, pr: any) => {
                acc[pr.state] = (acc[pr.state] || 0) + 1;
                return acc;
            }, {});
            this.logger.debug(`PR states: ${JSON.stringify(states)}`);
            return pullRequests;
        } catch (error: any) {
            this.logger.error(`✗ Failed to fetch pull requests for ${repoName}:`, error?.message || String(error));
            throw error;
        }
    }
}