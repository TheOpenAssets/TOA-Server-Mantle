#!/bin/bash

# Changelog API Endpoints Testing Script
# This script tests all changelog endpoints with various filters

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="http://localhost:3000"
CHANGELOG_BASE="${API_BASE_URL}/changelog"
METRICS_BASE="${API_BASE_URL}/ui-metrics"

# Function to print colored output
print_header() {
    echo -e "\n${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${MAGENTA}  $1${NC}"
    echo -e "${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
}

print_section() {
    echo -e "\n${CYAN}┌────────────────────────────────────────┐${NC}"
    echo -e "${CYAN}│ $1${NC}"
    echo -e "${CYAN}└────────────────────────────────────────┘${NC}\n"
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

print_endpoint() {
    echo -e "${YELLOW}→ $1${NC}"
}

# Function to make API call and display results
api_call() {
    local METHOD=$1
    local ENDPOINT=$2
    local DESCRIPTION=$3
    
    print_section "$DESCRIPTION"
    print_endpoint "$METHOD $ENDPOINT"
    echo ""
    
    if [ "$METHOD" = "POST" ]; then
        RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$ENDPOINT" -H "Content-Type: application/json" 2>&1)
    else
        RESPONSE=$(curl -s -w "\n%{http_code}" "$ENDPOINT" 2>&1)
    fi
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | sed '$d')
    
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
        print_success "Status: $HTTP_CODE"
        echo ""
        
        # Parse and display key information
        if command -v jq &> /dev/null; then
            # Check if response is valid JSON
            if echo "$BODY" | jq empty 2>/dev/null; then
                SUCCESS=$(echo "$BODY" | jq -r '.success // "N/A"')
                COUNT=$(echo "$BODY" | jq -r '.count // "N/A"')
                MESSAGE=$(echo "$BODY" | jq -r '.message // ""')
                
                if [ "$SUCCESS" != "N/A" ]; then
                    echo -e "${GREEN}Success: $SUCCESS${NC}"
                fi
                
                if [ "$COUNT" != "N/A" ]; then
                    echo -e "${BLUE}Count: $COUNT${NC}"
                fi
                
                if [ -n "$MESSAGE" ]; then
                    echo -e "${BLUE}Message: $MESSAGE${NC}"
                fi
                
                echo ""
                print_info "Full Response:"
                echo "$BODY" | jq '.'
            else
                print_warning "Response is not valid JSON"
                echo "$BODY"
            fi
        else
            echo "$BODY"
        fi
    else
        print_error "Status: $HTTP_CODE"
        echo "$BODY"
    fi
    
    echo ""
    read -p "Press Enter to continue..."
}

# Function to display summary
display_summary() {
    local ENDPOINT=$1
    local TITLE=$2
    
    print_section "$TITLE"
    print_endpoint "GET $ENDPOINT"
    echo ""
    
    RESPONSE=$(curl -s "$ENDPOINT" 2>&1)
    
    if command -v jq &> /dev/null; then
        if echo "$RESPONSE" | jq empty 2>/dev/null; then
            COUNT=$(echo "$RESPONSE" | jq -r '.count // 0')
            
            print_success "Total Count: $COUNT"
            echo ""
            
            # Display top 5 items with key info
            if [ "$COUNT" -gt 0 ]; then
                echo "$RESPONSE" | jq -r '.data[0:5] | .[] | 
                    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                    "Repository: \(.repoName)\n" +
                    if .branchName then "Branch: \(.branchName)\n" else "" end +
                    "Author: \(.author)\n" +
                    "Timestamp: \(.timestamp)\n" +
                    if .kind == "COMMIT" then 
                        "Message: \(.raw.commit.message | split("\n")[0])\n" +
                        "SHA: \(.platformId[0:7])\n"
                    elif .kind == "PULL_REQUEST" then
                        "PR #\(.raw.number): \(.raw.title)\n" +
                        "State: \(.raw.state)\n"
                    else "" end
                '
            fi
        else
            print_error "Invalid JSON response"
            echo "$RESPONSE"
        fi
    else
        echo "$RESPONSE"
    fi
}

# Check if server is running
check_server() {
    print_header "Checking Server Status"
    
    if curl -s --max-time 5 "${API_BASE_URL}" > /dev/null 2>&1; then
        print_success "Server is running at ${API_BASE_URL}"
    else
        print_error "Server is not running at ${API_BASE_URL}"
        print_info "Please start the server with: yarn start:dev"
        exit 1
    fi
}

# Main menu
show_menu() {
    clear
    print_header "Changelog API Endpoint Tester"
    
    echo "Choose an option:"
    echo ""
    echo "  ${CYAN}Sync Operations:${NC}"
    echo "    1. Trigger Manual Full Sync (POST /changelog/sync)"
    echo "    2. Trigger Repository UI Metrics Sync (POST /ui-metrics/sync/:repoName)"
    echo ""
    echo "  ${CYAN}Commits Endpoints:${NC}"
    echo "    3. Get All Commits"
    echo "    4. Get Commits by Repository"
    echo "    5. Get Commits by Branch"
    echo "    6. Get Commits by Author"
    echo "    7. Get Commits with Date Range"
    echo "    8. Get Commits with Custom Filters"
    echo ""
    echo "  ${CYAN}Pull Requests Endpoints:${NC}"
    echo "    9. Get All Pull Requests"
    echo "   10. Get Open Pull Requests"
    echo "   11. Get Closed Pull Requests"
    echo "   12. Get Pull Requests by Repository"
    echo ""
    echo "  ${CYAN}Timeline Endpoints:${NC}"
    echo "   13. Get Timeline (Commits + PRs)"
    echo "   14. Get Timeline by Repository"
    echo "   15. Get Timeline with Date Range"
    echo ""
    echo "  ${CYAN}Summary, Stats & Metrics:${NC}"
    echo "   16. Quick Summary of All Data"
    echo "   17. Detailed Statistics"
    echo "   18. Organization Details (All Repos & Branches)"
    echo "   19. Get Repository UI Metrics (GET /ui-metrics/:repoName)"
    echo ""
    echo "   ${RED}0. Exit${NC}"
    echo ""
    read -p "Enter your choice: " CHOICE
    
    case $CHOICE in
        1)
            api_call "POST" "${CHANGELOG_BASE}/sync" "Trigger Manual Full Sync"
            ;;
        2)
            read -p "Enter repository name (TOA-Server-Mantle/TOA-Client-Mantle): " REPO
            api_call "POST" "${METRICS_BASE}/sync/${REPO}" "Trigger UI Metrics Sync for ${REPO}"
            ;;
        3)
            api_call "GET" "${CHANGELOG_BASE}/commits?limit=10" "Get All Commits (Last 10)"
            ;;
        4)
            read -p "Enter repository name (TOA-Server-Mantle/TOA-Client-Mantle): " REPO
            api_call "GET" "${CHANGELOG_BASE}/commits?repo=${REPO}&limit=10" "Get Commits for ${REPO}"
            ;;
        5)
            read -p "Enter repository name: " REPO
            read -p "Enter branch name: " BRANCH
            api_call "GET" "${CHANGELOG_BASE}/commits?repo=${REPO}&branch=${BRANCH}&limit=10" "Get Commits for ${REPO}:${BRANCH}"
            ;;
        6)
            read -p "Enter author name/username: " AUTHOR
            api_call "GET" "${CHANGELOG_BASE}/commits?author=${AUTHOR}&limit=10" "Get Commits by ${AUTHOR}"
            ;;
        7)
            read -p "Enter start date (YYYY-MM-DD): " SINCE
            read -p "Enter end date (YYYY-MM-DD): " UNTIL
            api_call "GET" "${CHANGELOG_BASE}/commits?since=${SINCE}T00:00:00Z&until=${UNTIL}T23:59:59Z&limit=20" "Get Commits from ${SINCE} to ${UNTIL}"
            ;;
        8)
            read -p "Repository (optional): " REPO
            read -p "Branch (optional): " BRANCH
            read -p "Author (optional): " AUTHOR
            read -p "Limit (default 10): " LIMIT
            LIMIT=${LIMIT:-10}
            
            QUERY="limit=${LIMIT}"
            [ -n "$REPO" ] && QUERY="${QUERY}&repo=${REPO}"
            [ -n "$BRANCH" ] && QUERY="${QUERY}&branch=${BRANCH}"
            [ -n "$AUTHOR" ] && QUERY="${QUERY}&author=${AUTHOR}"
            
            api_call "GET" "${CHANGELOG_BASE}/commits?${QUERY}" "Get Commits with Custom Filters"
            ;;
        9)
            api_call "GET" "${CHANGELOG_BASE}/pull-requests?limit=10" "Get All Pull Requests"
            ;;
        10)
            api_call "GET" "${CHANGELOG_BASE}/pull-requests?state=open&limit=20" "Get Open Pull Requests"
            ;;
        11)
            api_call "GET" "${CHANGELOG_BASE}/pull-requests?state=closed&limit=20" "Get Closed Pull Requests"
            ;;
        12)
            read -p "Enter repository name: " REPO
            api_call "GET" "${CHANGELOG_BASE}/pull-requests?repo=${REPO}&limit=20" "Get Pull Requests for ${REPO}"
            ;;
        13)
            api_call "GET" "${CHANGELOG_BASE}/timeline?limit=15" "Get Timeline (Last 15 items)"
            ;;
        14)
            read -p "Enter repository name: " REPO
            api_call "GET" "${CHANGELOG_BASE}/timeline?repo=${REPO}&limit=15" "Get Timeline for ${REPO}"
            ;;
        15)
            read -p "Enter start date (YYYY-MM-DD): " SINCE
            read -p "Enter end date (YYYY-MM-DD): " UNTIL
            api_call "GET" "${CHANGELOG_BASE}/timeline?since=${SINCE}T00:00:00Z&until=${UNTIL}T23:59:59Z&limit=30" "Get Timeline from ${SINCE} to ${UNTIL}"
            ;;
        16)
            clear
            print_header "Quick Summary"
            display_summary "${CHANGELOG_BASE}/commits?limit=5" "Recent Commits"
            echo ""
            display_summary "${CHANGELOG_BASE}/pull-requests?limit=5" "Recent Pull Requests"
            echo ""
            read -p "Press Enter to continue..."
            ;;
        17)
            clear
            print_header "Detailed Statistics"
            
            # Get all commits
            print_section "Commit Statistics"
            COMMITS=$(curl -s "${CHANGELOG_BASE}/commits?limit=1000")
            
            if command -v jq &> /dev/null; then
                TOTAL_COMMITS=$(echo "$COMMITS" | jq -r '.count')
                print_success "Total Commits: $TOTAL_COMMITS"
                
                echo ""
                print_info "Commits by Repository:"
                echo "$COMMITS" | jq -r '.data | group_by(.repoName) | .[] | "  • \(.[0].repoName): \(. | length) commits"'
                
                echo ""
                print_info "Commits by Author (Top 10):"
                echo "$COMMITS" | jq -r '.data | group_by(.author) | sort_by(length) | reverse | .[0:10] | .[] | "  • \(.[0].author): \(. | length) commits"'
                
                echo ""
                print_info "Commits by Branch (Top 10):"
                echo "$COMMITS" | jq -r '.data | group_by(.branchName) | sort_by(length) | reverse | .[0:10] | .[] | "  • \(.[0].branchName // "N/A"): \(. | length) commits"'
            fi
            
            echo ""
            print_section "Pull Request Statistics"
            PRS=$(curl -s "${CHANGELOG_BASE}/pull-requests?limit=1000")
            
            if command -v jq &> /dev/null; then
                TOTAL_PRS=$(echo "$PRS" | jq -r '.count')
                print_success "Total Pull Requests: $TOTAL_PRS"
                
                echo ""
                print_info "PRs by Repository:"
                echo "$PRS" | jq -r '.data | group_by(.repoName) | .[] | "  • \(.[0].repoName): \(. | length) PRs"'
                
                echo ""
                print_info "PRs by State:"
                echo "$PRS" | jq -r '.data | group_by(.raw.state) | .[] | "  • \(.[0].raw.state): \(. | length) PRs"'
                
                echo ""
                print_info "PRs by Author (Top 10):"
                echo "$PRS" | jq -r '.data | group_by(.author) | sort_by(length) | reverse | .[0:10] | .[] | "  • \(.[0].author): \(. | length) PRs"'
            fi
            
            echo ""
            read -p "Press Enter to continue..."
            ;;
        18)
            clear
            print_header "Organization Details"
            
            read -p "Enter repository name (optional, leave blank for all): " REPO
            
            if [ -n "$REPO" ]; then
                print_section "Fetching details for ${REPO}"
                ORG_DETAILS=$(curl -s "${CHANGELOG_BASE}/organization?repo=${REPO}")
            else
                print_section "Fetching all organization details"
                ORG_DETAILS=$(curl -s "${CHANGELOG_BASE}/organization")
            fi
            
            if command -v jq &> /dev/null; then
                if echo "$ORG_DETAILS" | jq empty 2>/dev/null; then
                    ORG_NAME=$(echo "$ORG_DETAILS" | jq -r '.data.organization')
                    TOTAL_REPOS=$(echo "$ORG_DETAILS" | jq -r '.data.totalRepositories')
                    TOTAL_BRANCHES=$(echo "$ORG_DETAILS" | jq -r '.data.totalBranches')
                    TOTAL_COMMITS=$(echo "$ORG_DETAILS" | jq -r '.data.summary.totalCommits')
                    TOTAL_PRS=$(echo "$ORG_DETAILS" | jq -r '.data.summary.totalPullRequests')
                    
                    print_success "Organization: $ORG_NAME"
                    echo ""
                    print_info "📊 Overall Statistics:"
                    echo "  • Total Repositories: $TOTAL_REPOS"
                    echo "  • Total Branches: $TOTAL_BRANCHES"
                    echo "  • Total Commits: $TOTAL_COMMITS"
                    echo "  • Total Pull Requests: $TOTAL_PRS"
                    
                    echo ""
                    print_info "📁 Configured Repositories:"
                    echo "$ORG_DETAILS" | jq -r '.data.configuredRepositories | .[] | "  • \(.)"'
                    
                    echo ""
                    print_section "Repository Details"
                    
                    echo "$ORG_DETAILS" | jq -r '.data.repositories[] | 
                        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
                        "📦 Repository: \(.name)\n" +
                        "   Owner: \(.owner)\n" +
                        "   Default Branch: \(.defaultBranch)\n" +
                        "   Private: \(.isPrivate)\n" +
                        "   Description: \(.description // "N/A")\n" +
                        "   URL: \(.url)\n" +
                        "   Created: \(.createdAt)\n" +
                        "\n" +
                        "   📊 Statistics:\n" +
                        "      • Branches: \(.statistics.totalBranches)\n" +
                        "      • Commits: \(.statistics.totalCommits)\n" +
                        "      • Pull Requests: \(.statistics.totalPullRequests)\n" +
                        "\n" +
                        "   🌿 Branches:\n" +
                        (.branches | .[] | "      • \(.name)\(.protected and " (protected)" or "")")
                    '
                    
                    echo ""
                    print_section "Full JSON Response"
                    echo "$ORG_DETAILS" | jq '.'
                else
                    print_error "Invalid JSON response"
                    echo "$ORG_DETAILS"
                fi
            else
                echo "$ORG_DETAILS"
            fi
            
            echo ""
            read -p "Press Enter to continue..."
            ;;
        19)
            read -p "Enter repository name (TOA-Server-Mantle/TOA-Client-Mantle): " REPO
            api_call "GET" "${METRICS_BASE}/${REPO}" "Get UI Metrics for ${REPO}"
            ;;
        0)
            print_success "Goodbye!"
            exit 0
            ;;
        *)
            print_error "Invalid choice"
            sleep 2
            ;;
    esac
}

# Main execution
main() {
    # Check if jq is installed
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. Install it for better JSON parsing:"
        print_info "  macOS: brew install jq"
        print_info "  Linux: sudo apt-get install jq"
        echo ""
        read -p "Press Enter to continue anyway..."
    fi
    
    # Check server
    check_server
    
    # Show menu in loop
    while true; do
        show_menu
    done
}

# Run main function
main
