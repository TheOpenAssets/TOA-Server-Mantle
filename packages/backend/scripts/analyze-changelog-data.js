const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = 'http://localhost:3000';
const CHANGELOG_BASE = `${API_BASE_URL}/changelog`;
const OUTPUT_FILE = path.join(__dirname, 'changelog_api_responses.json');

const results = [];

async function recordResponse(endpoint, params, responseData) {
    results.push({
        timestamp: new Date().toISOString(),
        endpoint,
        params,
        status: 'success',
        data: responseData
    });
}

async function recordError(endpoint, params, error) {
    results.push({
        timestamp: new Date().toISOString(),
        endpoint,
        params,
        status: 'error',
        error: error.message,
        response: error.response?.data
    });
    console.error(`❌ Error calling ${endpoint}: ${error.message}`);
}

async function runAnalysis() {
    console.log('🚀 Starting Changelog API Analysis...');

    try {
        // Step 1: Call Option 17 - Organization Details
        console.log('\n📊 Step 1: Fetching Organization Details...');
        const orgUrl = `${CHANGELOG_BASE}/organization`;
        
        let orgData;
        try {
            const response = await axios.get(orgUrl);
            orgData = response.data;
            await recordResponse('/changelog/organization', {}, orgData);
            console.log('✅ Organization details fetched.');
        } catch (error) {
            await recordError('/changelog/organization', {}, error);
            console.error('Critical Error: Could not fetch organization details. Aborting dependent steps.');
            return;
        }

        if (!orgData || !orgData.success || !orgData.data || !orgData.data.repositories) {
            console.error('Critical Error: Invalid organization data structure.');
            return;
        }

        const repositories = orgData.data.repositories;
        console.log(`ℹ️ Found ${repositories.length} repositories.`);

        // Step 2: Iterate through repositories and call relevant endpoints
        for (const repo of repositories) {
            const repoName = repo.name;
            console.log(`\n📦 Processing Repository: ${repoName}`);

            // 2a. Get Commits by Repository
            console.log(`   → Fetching commits for repo: ${repoName}`);
            try {
                const commitsUrl = `${CHANGELOG_BASE}/commits`;
                const params = { repo: repoName, limit: 10 };
                const res = await axios.get(commitsUrl, { params });
                await recordResponse('/changelog/commits', params, res.data);
            } catch (e) {
                await recordError('/changelog/commits', { repo: repoName }, e);
            }

            // 2b. Get Pull Requests by Repository
            console.log(`   → Fetching PRs for repo: ${repoName}`);
            try {
                const prUrl = `${CHANGELOG_BASE}/pull-requests`;
                const params = { repo: repoName, limit: 10 };
                const res = await axios.get(prUrl, { params });
                await recordResponse('/changelog/pull-requests', params, res.data);
            } catch (e) {
                await recordError('/changelog/pull-requests', { repo: repoName }, e);
            }

            // 2c. Get Timeline by Repository
            console.log(`   → Fetching timeline for repo: ${repoName}`);
            try {
                const timelineUrl = `${CHANGELOG_BASE}/timeline`;
                const params = { repo: repoName, limit: 10 };
                const res = await axios.get(timelineUrl, { params });
                await recordResponse('/changelog/timeline', params, res.data);
            } catch (e) {
                await recordError('/changelog/timeline', { repo: repoName }, e);
            }

            // 2d. Process Branches
            if (repo.branches && Array.isArray(repo.branches)) {
                for (const branch of repo.branches) {
                    const branchName = branch.name;
                    console.log(`      🌿 Processing Branch: ${branchName}`);
                    
                    // Get Commits by Branch
                    try {
                        const branchCommitsUrl = `${CHANGELOG_BASE}/commits`;
                        const params = { repo: repoName, branch: branchName, limit: 5 };
                        const res = await axios.get(branchCommitsUrl, { params });
                        await recordResponse('/changelog/commits', params, res.data);
                    } catch (e) {
                        await recordError('/changelog/commits', { repo: repoName, branch: branchName }, e);
                    }
                }
            }
        }

        // Step 3: Fetch Global Lists (All Commits, All PRs)
        console.log('\n🌍 Step 3: Fetching Global Lists...');
        
        console.log('   → Fetching all commits (limit 20)');
        try {
            const allCommitsUrl = `${CHANGELOG_BASE}/commits`;
            const params = { limit: 20 };
            const res = await axios.get(allCommitsUrl, { params });
            await recordResponse('/changelog/commits', params, res.data);
        } catch (e) {
            await recordError('/changelog/commits', { limit: 20 }, e);
        }

        console.log('   → Fetching all pull requests (limit 20)');
        try {
            const allPrsUrl = `${CHANGELOG_BASE}/pull-requests`;
            const params = { limit: 20 };
            const res = await axios.get(allPrsUrl, { params });
            await recordResponse('/changelog/pull-requests', params, res.data);
        } catch (e) {
            await recordError('/changelog/pull-requests', { limit: 20 }, e);
        }

    } catch (error) {
        console.error('Unexpected error during analysis:', error);
    } finally {
        // Step 4: Save Results
        console.log(`\n💾 Saving results to ${OUTPUT_FILE}...`);
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
        console.log('✨ Analysis complete!');
    }
}

// Check if server is running before starting
axios.get(API_BASE_URL)
    .then(() => runAnalysis())
    .catch(() => {
        console.error(`❌ Server is not reachable at ${API_BASE_URL}. Please start the server first.`);
        process.exit(1);
    });
