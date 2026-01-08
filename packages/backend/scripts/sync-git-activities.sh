#!/bin/bash

# Git Activities Sync Script
# This script triggers a full sync of GitHub repositories, branches, commits, and pull requests

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:3000"
SYNC_ENDPOINT="${API_BASE_URL}/changelog/sync"
COMMITS_ENDPOINT="${API_BASE_URL}/changelog/commits"
PRS_ENDPOINT="${API_BASE_URL}/changelog/pull-requests"
TIMELINE_ENDPOINT="${API_BASE_URL}/changelog/timeline"

# Function to print colored output
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check if server is running
check_server() {
    print_header "Checking Server Status"
    
    if curl -s --max-time 5 "${API_BASE_URL}" > /dev/null 2>&1; then
        print_success "Server is running at ${API_BASE_URL}"
        return 0
    else
        print_error "Server is not running at ${API_BASE_URL}"
        print_info "Please start the server with: yarn start:dev"
        exit 1
    fi
}

# Trigger the sync
trigger_sync() {
    print_header "Triggering Full GitHub Sync"
    print_info "This will sync:"
    print_info "  - Repositories: TOA-Server-Mantle, TOA-Client-Mantle"
    print_info "  - All branches for each repository"
    print_info "  - All commits for each branch"
    print_info "  - All pull requests for each repository"
    echo ""
    
    print_info "Making POST request to ${SYNC_ENDPOINT}..."
    
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${SYNC_ENDPOINT}" \
        -H "Content-Type: application/json" 2>&1)
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ]; then
        print_success "Sync triggered successfully!"
        echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"
        return 0
    else
        print_error "Sync failed with HTTP code: $HTTP_CODE"
        echo "$BODY"
        return 1
    fi
}

# Wait for sync to complete (check server logs)
wait_for_sync() {
    print_header "Waiting for Sync to Complete"
    print_warning "Monitor the server logs in your terminal for progress..."
    print_info "Looking for: '=== Full Sync Completed ===' message"
    echo ""
    print_info "Waiting 10 seconds for sync to complete..."
    
    for i in {10..1}; do
        echo -ne "${YELLOW}${i}...${NC} "
        sleep 1
    done
    echo -e "\n"
}

# Get statistics
get_statistics() {
    print_header "Fetching Sync Statistics"
    
    # Get commits count
    print_info "Fetching commits..."
    COMMITS_RESPONSE=$(curl -s "${COMMITS_ENDPOINT}?limit=1000")
    COMMITS_COUNT=$(echo "$COMMITS_RESPONSE" | jq -r '.count' 2>/dev/null || echo "0")
    
    if [ "$COMMITS_COUNT" != "null" ] && [ "$COMMITS_COUNT" != "0" ]; then
        print_success "Total Commits: $COMMITS_COUNT"
        
        # Show commits by repository
        echo ""
        print_info "Commits by Repository:"
        echo "$COMMITS_RESPONSE" | jq -r '.data | group_by(.repoName) | .[] | "\(.| .[0].repoName): \(. | length) commits"' 2>/dev/null || echo "Unable to parse"
        
        # Show recent commits
        echo ""
        print_info "Most Recent Commits (Last 5):"
        echo "$COMMITS_RESPONSE" | jq -r '.data[0:5] | .[] | "  • \(.repoName) [\(.branchName)] - \(.author): \(.raw.commit.message | split("\n")[0])"' 2>/dev/null || echo "Unable to parse"
    else
        print_warning "No commits found"
    fi
    
    echo ""
    
    # Get pull requests count
    print_info "Fetching pull requests..."
    PRS_RESPONSE=$(curl -s "${PRS_ENDPOINT}?limit=1000")
    PRS_COUNT=$(echo "$PRS_RESPONSE" | jq -r '.count' 2>/dev/null || echo "0")
    
    if [ "$PRS_COUNT" != "null" ] && [ "$PRS_COUNT" != "0" ]; then
        print_success "Total Pull Requests: $PRS_COUNT"
        
        # Show PRs by repository
        echo ""
        print_info "Pull Requests by Repository:"
        echo "$PRS_RESPONSE" | jq -r '.data | group_by(.repoName) | .[] | "\(.| .[0].repoName): \(. | length) PRs"' 2>/dev/null || echo "Unable to parse"
        
        # Show PRs by state
        echo ""
        print_info "Pull Requests by State:"
        echo "$PRS_RESPONSE" | jq -r '.data | group_by(.raw.state) | .[] | "\(.| .[0].raw.state): \(. | length) PRs"' 2>/dev/null || echo "Unable to parse"
        
        # Show recent PRs
        echo ""
        print_info "Most Recent Pull Requests (Last 5):"
        echo "$PRS_RESPONSE" | jq -r '.data[0:5] | .[] | "  • PR #\(.raw.number) [\(.raw.state)] \(.raw.title) by \(.author)"' 2>/dev/null || echo "Unable to parse"
    else
        print_warning "No pull requests found"
    fi
}

# Get timeline
get_timeline() {
    print_header "Fetching Recent Activity Timeline"
    
    TIMELINE_RESPONSE=$(curl -s "${TIMELINE_ENDPOINT}?limit=10")
    TIMELINE_COUNT=$(echo "$TIMELINE_RESPONSE" | jq -r '.count' 2>/dev/null || echo "0")
    
    if [ "$TIMELINE_COUNT" != "null" ] && [ "$TIMELINE_COUNT" != "0" ]; then
        print_success "Recent Activity (Last 10 items):"
        echo ""
        echo "$TIMELINE_RESPONSE" | jq -r '.data[] | 
            if .kind == "COMMIT" then
                "  [\(.timestamp | split("T")[0])] COMMIT - \(.repoName) - \(.author): \(.raw.commit.message | split("\n")[0])"
            elif .kind == "PULL_REQUEST" then
                "  [\(.timestamp | split("T")[0])] PR #\(.raw.number) - \(.repoName) - \(.raw.title) [\(.raw.state)]"
            else
                "  [\(.timestamp | split("T")[0])] \(.kind) - \(.repoName)"
            end
        ' 2>/dev/null || echo "Unable to parse timeline"
    else
        print_warning "No timeline data found"
    fi
}

# Query specific data
query_menu() {
    print_header "Query Options"
    echo "Available queries:"
    echo "  1. Get commits for specific repository"
    echo "  2. Get commits for specific branch"
    echo "  3. Get commits by author"
    echo "  4. Get open pull requests"
    echo "  5. Get closed pull requests"
    echo "  6. Skip queries"
    echo ""
    read -p "Enter your choice (1-6): " CHOICE
    
    case $CHOICE in
        1)
            read -p "Enter repository name (TOA-Server-Mantle or TOA-Client-Mantle): " REPO
            print_info "Fetching commits for ${REPO}..."
            curl -s "${COMMITS_ENDPOINT}?repo=${REPO}&limit=10" | jq '.'
            ;;
        2)
            read -p "Enter repository name: " REPO
            read -p "Enter branch name: " BRANCH
            print_info "Fetching commits for ${REPO}:${BRANCH}..."
            curl -s "${COMMITS_ENDPOINT}?repo=${REPO}&branch=${BRANCH}&limit=10" | jq '.'
            ;;
        3)
            read -p "Enter author name/username: " AUTHOR
            print_info "Fetching commits by ${AUTHOR}..."
            curl -s "${COMMITS_ENDPOINT}?author=${AUTHOR}&limit=10" | jq '.'
            ;;
        4)
            print_info "Fetching open pull requests..."
            curl -s "${PRS_ENDPOINT}?state=open&limit=20" | jq '.'
            ;;
        5)
            print_info "Fetching closed pull requests..."
            curl -s "${PRS_ENDPOINT}?state=closed&limit=20" | jq '.'
            ;;
        6)
            print_info "Skipping queries..."
            ;;
        *)
            print_warning "Invalid choice, skipping queries..."
            ;;
    esac
}

# Main execution
main() {
    print_header "GitHub Activities Sync Script"
    print_info "Organization: TheOpenAssets"
    print_info "Repositories: TOA-Server-Mantle, TOA-Client-Mantle"
    
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Install it for better JSON parsing:"
        print_info "  macOS: brew install jq"
        print_info "  Linux: sudo apt-get install jq"
        echo ""
    fi
    
    # Check server
    check_server
    
    # Trigger sync
    if trigger_sync; then
        # Wait for sync
        wait_for_sync
        
        # Get statistics
        get_statistics
        
        # Get timeline
        get_timeline
        
        # Query menu
        echo ""
        query_menu
        
        # Success message
        echo ""
        print_header "Sync Process Complete!"
        print_success "All GitHub activities have been synced to the database"
        print_info "The sync will automatically run every 3 hours"
        print_info "You can manually trigger it again with: POST ${SYNC_ENDPOINT}"
    else
        print_error "Sync process failed. Check server logs for details."
        exit 1
    fi
}

# Run main function
main
