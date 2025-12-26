# AUCTION E2E TESTING GUIDE

## Overview
This guide provides comprehensive end-to-end testing instructions for the Uniform Price Auction system implemented in the RWA platform. The auction system allows originators to create auctions for their tokenized assets, investors to place bids, and the system to execute uniform price auctions with automatic settlement.

## Prerequisites

### Environment Setup
1. **Node.js & Yarn**: Ensure Node.js 18+ and Yarn are installed
2. **Hardhat**: Contracts deployed on Mantle Sepolia testnet
3. **MongoDB**: Backend database running
4. **Backend Server**: Running on port 3000
5. **Test Accounts**: Multiple test wallets with ETH and USDC

### Contract Addresses (Latest Deployment)
```
AttestationRegistry:    0x03FE7d3736402D140659e7bD92B64808E31C3f51
TrustedIssuersRegistry: 0xf63B563b6D438122cBC87f4356e60b8BB3Bc53E2
IdentityRegistry:       0x2E310C62A225033055E88B690F8d054ece8bcbC4
YieldVault:            0xb9BfaEDe01f0f2b2162072b73e2b2038Fb42b5cD
TokenFactory:          0x89C70bB202341c28e7a8dF333b4981BfB49b3c21
PrimaryMarketplace:    0x96183D507Bbb0dA7d78192dce7FBC8C1f209061C
USDC (Mock):           0x9A54Bad93a00Bf1232D4e636f5e53055Dc0b8238
Faucet:                0x643b8c16F894B39399506cC921efa68d61A14905
```

### Test Data Setup
1. **Create Test Users**:
   - Originator: `originator@test.com`
   - Investor 1: `investor1@test.com`
   - Investor 2: `investor2@test.com`
   - Admin: `admin@test.com`

2. **Fund Test Accounts with USDC**:
   ```bash
   # Use the faucet to get USDC tokens
   node scripts/faucet-usdc.js <recipient_address> <amount_in_usdc>

   # Example: Get 10,000 USDC for an investor
   node scripts/faucet-usdc.js 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 10000
   ```

   **Note**: The faucet requires the recipient to have ETH for gas fees. If you don't have ETH, use the mint script instead:
   ```bash
   node scripts/mint-usdc.js <recipient_address> <amount_in_usdc>
   ```

## Test Scenarios

### Scenario 1: Complete Auction Flow

#### Step 1: Setup Test Data
```bash
# 1. Register users
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"originator@test.com","password":"password123","role":"originator"}'

curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"investor1@test.com","password":"password123","role":"investor"}'

curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"investor2@test.com","password":"password123","role":"investor"}'

# 2. Login to get tokens
ORIGINATOR_TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"originator@test.com","password":"password123"}' | jq -r '.access_token')

INVESTOR1_TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"investor1@test.com","password":"password123"}' | jq -r '.access_token')

INVESTOR2_TOKEN=$(curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"investor2@test.com","password":"password123"}' | jq -r '.access_token')
```

#### Step 2: Create Asset
```bash
# Create asset as originator
ASSET_RESPONSE=$(curl -X POST http://localhost:3000/assets \
  -H "Authorization: Bearer $ORIGINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Commercial Property",
    "description": "A test commercial property for auction",
    "assetType": "real_estate",
    "valuation": 1000000,
    "location": "Test City",
    "documents": ["doc1.pdf"],
    "metadata": {"size": "5000 sq ft"}
  }')

ASSET_ID=$(echo $ASSET_RESPONSE | jq -r '.asset._id')
echo "Created asset with ID: $ASSET_ID"
```

#### Step 3: Create Auction
```bash
# Create auction for the asset
AUCTION_RESPONSE=$(curl -X POST http://localhost:3000/admin/asset-ops/create-auction \
  -H "Authorization: Bearer $ORIGINATOR_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"assetId\": \"$ASSET_ID\",
    \"totalTokens\": 1000,
    \"reservePrice\": 900000,
    \"startTime\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"endTime\": \"$(date -u -v+1H +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"minBidAmount\": 100
  }")

AUCTION_ID=$(echo $AUCTION_RESPONSE | jq -r '.auction._id')
echo "Created auction with ID: $AUCTION_ID"
```

#### Step 4: Place Bids
```bash
# Investor 1 places bid
curl -X POST http://localhost:3000/assets/$ASSET_ID/bid \
  -H "Authorization: Bearer $INVESTOR1_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bidAmount": 950000,
    "bidQuantity": 500
  }'

# Investor 2 places bid
curl -X POST http://localhost:3000/assets/$ASSET_ID/bid \
  -H "Authorization: Bearer $INVESTOR2_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bidAmount": 980000,
    "bidQuantity": 300
  }'
```

#### Step 5: End Auction
```bash
# Wait for auction end time or manually end it
curl -X POST http://localhost:3000/admin/asset-ops/end-auction/$AUCTION_ID \
  -H "Authorization: Bearer $ORIGINATOR_TOKEN"
```

#### Step 6: Verify Results
```bash
# Check auction results
curl -X GET http://localhost:3000/assets/$ASSET_ID/auction-results \
  -H "Authorization: Bearer $ORIGINATOR_TOKEN"

# Check token balances
curl -X GET http://localhost:3000/assets/$ASSET_ID/token-balance \
  -H "Authorization: Bearer $INVESTOR1_TOKEN"

curl -X GET http://localhost:3000/assets/$ASSET_ID/token-balance \
  -H "Authorization: Bearer $INVESTOR2_TOKEN"
```

### Scenario 2: Auction with No Bids
- Create auction as above
- Don't place any bids
- End auction
- Verify auction status is "failed"
- Asset remains with originator

### Scenario 3: Auction Below Reserve Price
- Create auction with reserve price 1,000,000
- Place bids totaling less than reserve
- End auction
- Verify auction fails

### Scenario 4: Multiple Assets Parallel Auctions
- Create multiple assets
- Create auctions for each
- Place bids on different auctions
- End auctions
- Verify each auction processes independently

## API Endpoints Reference

### Asset Management
```
GET    /assets/my-assets          # Get originator's assets
GET    /admin/assets/all         # Admin: Get all assets
POST   /assets                   # Create new asset
PUT    /assets/:id               # Update asset
DELETE /assets/:id               # Delete asset
```

### Auction Operations
```
POST   /admin/asset-ops/create-auction    # Create auction
POST   /admin/asset-ops/end-auction/:id  # End auction
GET    /assets/:id/auction-results       # Get auction results
POST   /assets/:id/bid                   # Place bid
GET    /assets/:id/bids                  # Get bids for asset
GET    /assets/:id/token-balance         # Get token balance
```

### Authentication
```
POST   /auth/register             # Register user
POST   /auth/login               # Login user
```

## Contract Interaction Scripts

### Request USDC from Faucet
```bash
# Request USDC tokens from the faucet contract
node scripts/faucet-usdc.js <recipient_address> <amount_in_usdc>

# Example: Get 5000 USDC
node scripts/faucet-usdc.js 0x742d35Cc6634C0532925a3b844Bc454e4438f44e 5000
```

### Mint USDC Tokens (Admin Only)
```bash
# Mint USDC directly to an address (requires admin privileges)
node scripts/mint-usdc.js <recipient_address> <amount>
```

### Approve Marketplace
```bash
# Approve marketplace to spend USDC
node scripts/approve-marketplace.js <user_address>
```

### Check Token Supply
```bash
# Check total supply of asset tokens
node scripts/check-token-supply.js <asset_id>
```

### Buy Tokens
```bash
# Purchase tokens after auction
node scripts/buy-tokens.js <asset_id> <buyer_address> <amount>
```

## Validation Steps

### 1. Database Validation
```bash
# Check MongoDB collections
mongosh rwa_db --eval "db.assets.find().pretty()"
mongosh rwa_db --eval "db.auctions.find().pretty()"
mongosh rwa_db --eval "db.bids.find().pretty()"
```

### 2. Contract State Validation
```bash
# Check contract balances
npx hardhat run scripts/check-contract-state.js --network mantleTestnet
```

### 3. API Response Validation
- Verify HTTP status codes
- Check response data structure
- Validate business logic (uniform price calculation)

### 4. End-to-End Flow Validation
- Asset creation → Auction creation → Bidding → Auction end → Token distribution
- Balance transfers
- State transitions

## Troubleshooting

### Common Issues

1. **Auction Creation Fails**
   - Check asset ownership
   - Verify asset status is "approved"
   - Ensure auction parameters are valid

2. **Bids Not Accepted**
   - Check auction timing (start/end time)
   - Verify bidder has sufficient USDC balance
   - Check bid amount meets minimum requirements

3. **Auction End Fails**
   - Ensure auction has ended (time-based or manual)
   - Check for sufficient bids above reserve price

4. **Token Distribution Issues**
   - Verify contract addresses in deployed_contracts.json
   - Check gas limits for transactions
   - Validate USDC approvals

### Debug Commands
```bash
# Check backend logs
tail -f packages/backend/logs/app.log

# Check contract events
npx hardhat run scripts/check-events.js --network mantleTestnet

# Reset test data
mongosh rwa_db --eval "db.dropDatabase()"
```

## Performance Testing

### Load Testing
```bash
# Simulate multiple concurrent bids
for i in {1..10}; do
  curl -X POST http://localhost:3000/assets/$ASSET_ID/bid \
    -H "Authorization: Bearer $INVESTOR1_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"bidAmount\": 950000, \"bidQuantity\": 100}" &
done
```

### Stress Testing
- Test with 100+ concurrent users
- Large bid amounts
- Multiple auctions running simultaneously

## Security Testing

### Authorization Tests
- Verify role-based access control
- Test unauthorized access attempts
- Validate JWT token requirements

### Input Validation
- Test with malformed data
- SQL injection attempts
- XSS prevention

## Cleanup

### After Testing
```bash
# Clear test data
mongosh rwa_db --eval "db.assets.deleteMany({})"
mongosh rwa_db --eval "db.auctions.deleteMany({})"
mongosh rwa_db --eval "db.bids.deleteMany({})"

# Reset contracts (if needed)
npx hardhat run scripts/reset-contracts.js --network mantleTestnet
```

This guide should enable comprehensive testing of the auction system. Update contract addresses as needed after redeployment.
