#!/bin/bash

# Script to verify P2P real-time event processing is working

echo "🧪 P2P Real-Time Event Processing Verification"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Check if backend is running
echo "📡 Checking if backend is running..."
if curl -s http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Backend is running${NC}"
else
    echo -e "${RED}❌ Backend is not running${NC}"
    echo "   Please start backend with: cd packages/backend && npm run start:dev"
    exit 1
fi

echo ""

# 2. Check deployed SecondaryMarket contract
echo "🔍 Checking SecondaryMarket contract..."
SECONDARY_MARKET_ADDRESS=$(cat packages/contracts/deployed_contracts.json | grep SecondaryMarket | awk -F'"' '{print $4}')
if [ -z "$SECONDARY_MARKET_ADDRESS" ]; then
    echo -e "${RED}❌ SecondaryMarket address not found in deployed_contracts.json${NC}"
    exit 1
else
    echo -e "${GREEN}✅ SecondaryMarket deployed at: $SECONDARY_MARKET_ADDRESS${NC}"
fi

echo ""

# 3. Test orderbook endpoint
echo "📊 Testing orderbook endpoint..."
ASSET_ID="AST-001" # Replace with actual assetId if different

ORDERBOOK_RESPONSE=$(curl -s "http://localhost:3000/marketplace/secondary/$ASSET_ID/orderbook")

if [ -z "$ORDERBOOK_RESPONSE" ]; then
    echo -e "${RED}❌ Orderbook endpoint returned empty response${NC}"
else
    echo -e "${GREEN}✅ Orderbook endpoint responding${NC}"
    
    # Check if response has orders
    BID_COUNT=$(echo $ORDERBOOK_RESPONSE | grep -o '"bids":\[' | wc -l)
    ASK_COUNT=$(echo $ORDERBOOK_RESPONSE | grep -o '"asks":\[' | wc -l)
    
    if [ "$BID_COUNT" -gt 0 ] && [ "$ASK_COUNT" -gt 0 ]; then
        echo -e "${GREEN}✅ Orderbook structure is correct${NC}"
        
        # Pretty print summary if jq is available
        if command -v jq &> /dev/null; then
            echo ""
            echo "📈 Orderbook Summary:"
            echo $ORDERBOOK_RESPONSE | jq '.summary'
        fi
    else
        echo -e "${YELLOW}⚠️  Orderbook structure may be incomplete${NC}"
    fi
fi

echo ""

# 4. Check backend logs for event watching
echo "📝 Checking if SecondaryMarket events are being watched..."
echo "   (This requires backend logs to be accessible)"
echo ""
echo -e "${YELLOW}Expected log messages:${NC}"
echo "   • Watching SecondaryMarket at $SECONDARY_MARKET_ADDRESS"
echo "   • [P2P Event] OrderCreated detected..."
echo "   • [P2P Event Processor] Processing OrderCreated..."
echo "   • [P2P Event Processor] ✅ Order Created in DB..."
echo ""

# 5. Instructions for manual testing
echo "🧪 Manual Testing Steps:"
echo "========================"
echo ""
echo "1. Create a test order:"
echo "   • Use the frontend or API to create a sell order"
echo "   • POST /marketplace/secondary/tx/create-order"
echo ""
echo "2. Check backend logs immediately:"
echo "   • Look for: [P2P Event] OrderCreated detected"
echo "   • Look for: [P2P Event Processor] ✅ Order Created in DB"
echo ""
echo "3. Query orderbook within seconds:"
echo "   curl http://localhost:3000/marketplace/secondary/$ASSET_ID/orderbook"
echo ""
echo "4. Verify order appears immediately (not after 1 hour)"
echo ""

# 6. Check MongoDB for orders
echo "💾 Database Verification:"
echo "========================"
echo ""
echo "Connect to MongoDB and run:"
echo "   use mantle-rwa"
echo "   db.p2porders.find().sort({createdAt: -1}).limit(5).pretty()"
echo ""
echo "Expected: Recent orders should have createdAt close to blockTimestamp"
echo ""

# 7. Summary
echo "📋 Summary:"
echo "==========="
echo ""
if [ -n "$SECONDARY_MARKET_ADDRESS" ]; then
    echo -e "${GREEN}✅ Configuration looks good${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Create a test order on-chain"
    echo "2. Watch backend logs for [P2P Event] messages"
    echo "3. Verify order appears in orderbook immediately"
    echo ""
    echo "If orders still don't appear:"
    echo "• Check backend logs for errors"
    echo "• Verify SECONDARY_MARKET_ADDRESS in .env (optional override)"
    echo "• Ensure WebSocket connection to Mantle RPC is working"
else
    echo -e "${RED}❌ Configuration issues detected${NC}"
fi

echo ""
echo "📚 For more details, see: docs/P2P_REAL_TIME_FIX.md"
echo ""
