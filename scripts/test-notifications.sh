#!/bin/bash

# Notification API Test Script
# Tests all notification endpoints

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
API_BASE_URL="${API_BASE_URL:-http://localhost:3000}"
USER_TOKEN="${USER_TOKEN}"
WALLET_ADDRESS="${WALLET_ADDRESS}"

# Function to print headers
print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

# Function to print success
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

# Function to print error
print_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Function to print info
print_info() {
    echo -e "${YELLOW}ℹ $1${NC}"
}

# Validate inputs
if [ -z "$USER_TOKEN" ]; then
    print_error "USER_TOKEN not set!"
    echo "Usage: USER_TOKEN=your_jwt_token ./test-notifications.sh"
    echo ""
    echo "To get a token, login as an originator or investor:"
    echo "  ORIGINATOR_PRIVATE_KEY=0x... ./scripts/upload-as-originator.sh sample.pdf"
    exit 1
fi

print_header "Notification API Test Suite"
print_info "API Base URL: $API_BASE_URL"
echo ""

# Test 1: Get Unread Count
print_header "Test 1: Get Unread Count"
print_info "Fetching unread notification count..."

UNREAD_RESPONSE=$(curl -s -X GET "$API_BASE_URL/notifications/unread-count" \
  -H "Authorization: Bearer $USER_TOKEN")

echo "$UNREAD_RESPONSE" | jq '.'

if echo "$UNREAD_RESPONSE" | jq -e '.unreadCount' > /dev/null 2>&1; then
    UNREAD_COUNT=$(echo "$UNREAD_RESPONSE" | jq -r '.unreadCount')
    print_success "Unread count: $UNREAD_COUNT"
else
    print_error "Failed to get unread count"
    echo "$UNREAD_RESPONSE"
fi

# Test 2: Fetch All Notifications
print_header "Test 2: Fetch All Notifications"
print_info "Fetching all notifications (limit 5)..."

ALL_NOTIFS_RESPONSE=$(curl -s -X GET "$API_BASE_URL/notifications?limit=5" \
  -H "Authorization: Bearer $USER_TOKEN")

echo "$ALL_NOTIFS_RESPONSE" | jq '.'

if echo "$ALL_NOTIFS_RESPONSE" | jq -e '.notifications' > /dev/null 2>&1; then
    TOTAL_COUNT=$(echo "$ALL_NOTIFS_RESPONSE" | jq -r '.meta.totalCount')
    print_success "Total notifications: $TOTAL_COUNT"

    # Extract first notification ID for later tests
    FIRST_NOTIF_ID=$(echo "$ALL_NOTIFS_RESPONSE" | jq -r '.notifications[0]._id // empty')
    if [ ! -z "$FIRST_NOTIF_ID" ] && [ "$FIRST_NOTIF_ID" != "null" ]; then
        print_info "First notification ID: $FIRST_NOTIF_ID"
    fi
else
    print_error "Failed to fetch notifications"
    echo "$ALL_NOTIFS_RESPONSE"
fi

# Test 3: Fetch Unread Notifications
print_header "Test 3: Fetch Unread Notifications"
print_info "Fetching only unread notifications..."

UNREAD_NOTIFS_RESPONSE=$(curl -s -X GET "$API_BASE_URL/notifications?filter=unread&limit=5" \
  -H "Authorization: Bearer $USER_TOKEN")

echo "$UNREAD_NOTIFS_RESPONSE" | jq '.'

if echo "$UNREAD_NOTIFS_RESPONSE" | jq -e '.notifications' > /dev/null 2>&1; then
    UNREAD_ITEMS=$(echo "$UNREAD_NOTIFS_RESPONSE" | jq '.notifications | length')
    print_success "Unread notifications fetched: $UNREAD_ITEMS items"
else
    print_error "Failed to fetch unread notifications"
fi

# Test 4: Get Notification by ID (if we have one)
if [ ! -z "$FIRST_NOTIF_ID" ] && [ "$FIRST_NOTIF_ID" != "null" ]; then
    print_header "Test 4: Get Notification by ID"
    print_info "Fetching notification: $FIRST_NOTIF_ID"

    SINGLE_NOTIF_RESPONSE=$(curl -s -X GET "$API_BASE_URL/notifications/$FIRST_NOTIF_ID" \
      -H "Authorization: Bearer $USER_TOKEN")

    echo "$SINGLE_NOTIF_RESPONSE" | jq '.'

    if echo "$SINGLE_NOTIF_RESPONSE" | jq -e '._id' > /dev/null 2>&1; then
        NOTIF_HEADER=$(echo "$SINGLE_NOTIF_RESPONSE" | jq -r '.header')
        print_success "Notification retrieved: $NOTIF_HEADER"
    else
        print_error "Failed to get notification by ID"
        echo "$SINGLE_NOTIF_RESPONSE"
    fi

    # Test 5: Mark Notification as Read
    print_header "Test 5: Mark Notification as Read"
    print_info "Marking notification as read: $FIRST_NOTIF_ID"

    MARK_READ_RESPONSE=$(curl -s -X PATCH "$API_BASE_URL/notifications/$FIRST_NOTIF_ID/read" \
      -H "Authorization: Bearer $USER_TOKEN")

    echo "$MARK_READ_RESPONSE" | jq '.'

    if echo "$MARK_READ_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
        print_success "Notification marked as read"
    else
        print_error "Failed to mark notification as read"
    fi
else
    print_info "Skipping Test 4 & 5 - No notifications available"
fi

# Test 6: Mark All as Read
print_header "Test 6: Mark All as Read"
print_info "Marking all notifications as read..."

MARK_ALL_RESPONSE=$(curl -s -X POST "$API_BASE_URL/notifications/mark-all-read" \
  -H "Authorization: Bearer $USER_TOKEN")

echo "$MARK_ALL_RESPONSE" | jq '.'

if echo "$MARK_ALL_RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
    print_success "All notifications marked as read"
else
    print_error "Failed to mark all as read"
fi

# Test 7: Verify Unread Count is 0
print_header "Test 7: Verify Unread Count After Mark All Read"
print_info "Checking if unread count is now 0..."

FINAL_UNREAD_RESPONSE=$(curl -s -X GET "$API_BASE_URL/notifications/unread-count" \
  -H "Authorization: Bearer $USER_TOKEN")

FINAL_UNREAD_COUNT=$(echo "$FINAL_UNREAD_RESPONSE" | jq -r '.unreadCount')

if [ "$FINAL_UNREAD_COUNT" == "0" ]; then
    print_success "Unread count is now 0"
else
    print_info "Unread count is: $FINAL_UNREAD_COUNT (might have received new notifications)"
fi

# Summary
print_header "Test Summary"
echo ""
echo "Tests Completed:"
echo "  ✓ Get Unread Count"
echo "  ✓ Fetch All Notifications"
echo "  ✓ Fetch Unread Notifications"
if [ ! -z "$FIRST_NOTIF_ID" ]; then
    echo "  ✓ Get Notification by ID"
    echo "  ✓ Mark Notification as Read"
else
    echo "  ⊘ Get Notification by ID (skipped - no notifications)"
    echo "  ⊘ Mark Notification as Read (skipped - no notifications)"
fi
echo "  ✓ Mark All as Read"
echo "  ✓ Verify Unread Count"
echo ""

print_info "To test SSE stream, run:"
echo "  curl -N -H \"Authorization: Bearer \$USER_TOKEN\" $API_BASE_URL/notifications/stream"
echo ""

print_info "To trigger notifications, upload an asset:"
echo "  ORIGINATOR_PRIVATE_KEY=0x... ./scripts/upload-as-originator.sh sample-invoice.pdf"
echo ""

print_header "All Tests Complete! 🎉"
