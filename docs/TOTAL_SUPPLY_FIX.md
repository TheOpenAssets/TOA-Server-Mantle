# Total Supply Conversion Bug - FIXED ✅

## Problem Summary

The backend was saving the **token count** instead of the **wei amount** to the database, causing the frontend to display 0.0000000000001 tokens instead of 100,000 tokens.

## Root Cause

**File:** [blockchain.service.ts:144](src/modules/blockchain/services/blockchain.service.ts#L144)

**Before (WRONG):**
```typescript
'token.supply': totalSupplyRaw,  // ❌ Saved "100000" (token count)
```

**After (FIXED):**
```typescript
'token.supply': totalSupplyWei.toString(),  // ✅ Saves "100000000000000000000000" (wei)
```

## Additional Enhancement

Added automatic calculation of `totalSupply` from asset's `faceValue` and `pricePerToken`:

**File:** [blockchain.service.ts:78-103](src/modules/blockchain/services/blockchain.service.ts#L78-L103)

```typescript
// Calculate total supply if not provided
let totalSupplyRaw: string;

if (dto.totalSupply) {
  // Use provided value
  totalSupplyRaw = dto.totalSupply;
} else {
  // Calculate from asset's faceValue and pricePerToken
  const asset = await this.assetModel.findOne({ assetId: dto.assetId });

  const faceValue = parseFloat(asset.metadata?.faceValue || '0');
  const pricePerToken = parseFloat(asset.tokenParams?.pricePerToken || '1');

  // Calculate total tokens: faceValue / pricePerToken
  const totalTokens = Math.floor(faceValue / pricePerToken);
  totalSupplyRaw = totalTokens.toString();

  this.logger.log(`Calculated totalSupply from asset: faceValue=${faceValue}, pricePerToken=${pricePerToken}, totalTokens=${totalTokens}`);
}

// Convert to wei (18 decimals)
const totalSupplyWei = BigInt(totalSupplyRaw) * BigInt(10 ** 18);
```

## Example Calculation

For an invoice asset with:
- **Face Value:** $100,000
- **Price Per Token:** $1

**Calculation:**
```
totalTokens = 100,000 / 1 = 100,000
totalSupplyWei = 100,000 * 10^18 = 100,000,000,000,000,000,000,000
```

**Database saves:** `"100000000000000000000000"` (wei)

**Frontend displays:** `100000000000000000000000 / 1e18 = 100,000 tokens` ✅

## Testing

### Before Fix ❌
```bash
# Deploy token
curl -X POST "http://localhost:3000/admin/assets/deploy-token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assetId": "...", "name": "Test", "symbol": "TST"}'

# Database shows:
# token.supply: "100000"  ← WRONG

# Frontend displays:
# 100000 / 1e18 = 0.0000000000001 tokens  ← WRONG
```

### After Fix ✅
```bash
# Deploy token (same request)
curl -X POST "http://localhost:3000/admin/assets/deploy-token" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assetId": "...", "name": "Test", "symbol": "TST"}'

# Database shows:
# token.supply: "100000000000000000000000"  ← CORRECT!

# Frontend displays:
# 100000000000000000000000 / 1e18 = 100,000 tokens  ← CORRECT!
```

## Impact

- ✅ **On-chain deployment:** Already correct (was using `totalSupplyWei`)
- ✅ **Database storage:** NOW FIXED (changed from `totalSupplyRaw` to `totalSupplyWei.toString()`)
- ✅ **Frontend display:** Will now show correct values
- ✅ **Automatic calculation:** No need to manually pass `totalSupply` in the API call

## Files Modified

1. [packages/backend/src/modules/blockchain/services/blockchain.service.ts](src/modules/blockchain/services/blockchain.service.ts)
   - **Line 78-103:** Added automatic `totalSupply` calculation from asset's `faceValue` and `pricePerToken`
   - **Line 144:** Changed `totalSupplyRaw` to `totalSupplyWei.toString()` for database storage

## Migration for Existing Assets

If you have existing assets with incorrect `token.supply` values in the database:

### Option 1: Re-deploy Tokens (Recommended for Test Env)

Just re-deploy the token for the asset - it will update with the correct value.

### Option 2: Manual Database Update

```javascript
// Connect to MongoDB
db.assets.updateMany(
  { "token.supply": { $exists: true, $lt: "1000000000000000000" } },
  [
    {
      $set: {
        "token.supply": {
          $toString: {
            $multiply: [
              { $toLong: "$token.supply" },
              { $toLong: "1000000000000000000" }  // 10^18
            ]
          }
        }
      }
    }
  ]
);
```

## Verification

After deploying a new token, verify:

```bash
# Check token on-chain
node scripts/check-token-decimals.js <TOKEN_ADDRESS>

# Should show:
# Total Supply (raw): 100000000000000000000000 wei
# Total Supply (formatted): 100000.0 tokens  ✅
```
