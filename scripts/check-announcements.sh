#!/bin/bash

# Check Announcements Helper Script
# Quick script to monitor announcements for an asset

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
ASSET_ID="${1}"
FILTER_TYPE="${2}" # Optional: AUCTION_SCHEDULED, AUCTION_LIVE, AUCTION_FAILED

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

print_cyan() {
    echo -e "${CYAN}$1${NC}"
}

if [ -z "$ASSET_ID" ]; then
    echo "Usage: ./check-announcements.sh <asset-id> [type]"
    echo ""
    echo "Parameters:"
    echo "  asset-id : UUID of the asset"
    echo "  type     : (Optional) Filter by type: AUCTION_SCHEDULED, AUCTION_LIVE, AUCTION_FAILED"
    echo ""
    echo "Examples:"
    echo "  ./check-announcements.sh 550e8400-e29b-41d4-a716-446655440000"
    echo "  ./check-announcements.sh 550e8400-e29b-41d4-a716-446655440000 AUCTION_LIVE"
    exit 1
fi

print_header "Announcements for Asset"
print_info "Asset ID: $ASSET_ID"

RESPONSE=$(curl -s -X GET "$API_BASE_URL/announcements/asset/$ASSET_ID")
TOTAL=$(echo "$RESPONSE" | jq '. | length')

if [ "$TOTAL" -eq 0 ]; then
    echo -e "${YELLOW}No announcements found for this asset${NC}"
    exit 0
fi

echo ""
print_cyan "Found $TOTAL announcement(s):"
echo ""

echo "$RESPONSE" | jq -r '.[] |
  "\u001b[36m━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\u001b[0m\n" +
  "Type:    \u001b[32m" + .type + "\u001b[0m\n" +
  "Status:  " + .status + "\n" +
  "Title:   " + .title + "\n" +
  "Created: " + .createdAt + "\n" +
  "Message: " + .message + "\n"'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
print_info "Total announcements: $TOTAL"
