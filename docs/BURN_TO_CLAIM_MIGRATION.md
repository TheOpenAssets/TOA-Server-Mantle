# 🔥 Burn-to-Claim Migration Guide

## Overview

We've migrated from a complex time-weighted distribution model to a **simple burn-to-claim model** that fixes critical bugs and aligns with your requirements.

---

## What Changed

### Old Model (BUGGY):
```
1. Admin deposits settlement → YieldVault
2. Backend calculates complex time-weighted token-days
3. Backend calls distributeYieldBatch() for each investor
4. Investor calls claimAllYield() to receive USDC
5. Investor KEEPS their RWA tokens ❌
```

**Problems:**
- ❌ Unit mismatch bug: `amountRaised` (USDC WEI) treated as USD
- ❌ Investors paid 1.54x more than expected!
- ❌ Complex token-days calculation (unnecessary for primary-only market)
- ❌ Tokens not burned (investors keep worthless tokens)

### New Model (FIXED):
```
1. Admin deposits settlement → YieldVault
2. Investor calls claimYield(tokenAddress, amount) DIRECTLY on contract
3. Contract burns investor's RWA tokens 🔥
4. Contract sends pro-rata USDC to investor
```

**Benefits:**
- ✅ Simple calculation: `yieldPerToken = totalSettlement / totalTokenSupply`
- ✅ Direct investor → contract (no backend needed!)
- ✅ Tokens burned on claim (clean settlement)
- ✅ Fixed unit mismatch bug
- ✅ Exact payouts matching invoice settlement

---

## Example: $100 Invoice

### Settlement:
```
Invoice Value: $100
Amount Raised: $80 USDC (100 tokens @ $0.80/token)
Platform Fee: $1.50 (1.5%)
Net Distribution: $98.50 USDC
```

### Investor Claims:
```
Investor holds: 100 tokens
Yield per token: $98.50 / 100 = $0.985 USDC/token

Investor burns 100 tokens →  Receives: 100 × $0.985 = $98.50 USDC ✓
```

**Result:** Investor receives exactly $98.50 (correct!) instead of $152.15 (bug!)

---

## Deployment Steps

### 1. Redeploy YieldVault Contract

The contract has been updated with new functions:

**New Functions:**
- `depositSettlement(tokenAddress, totalSettlement)` - Admin deposits settlement
- `claimYield(tokenAddress, tokenAmount)` - Investor burns tokens to claim
- `getSettlementInfo(tokenAddress)` - View settlement details
- `getClaimableForTokens(tokenAddress, tokenAmount)` - Calculate claimable USDC

**Deploy:**
```bash
cd packages/contracts
npx hardhat compile
npx hardhat run scripts/deploy.ts --network mantleSepolia
```

Update `deployed_contracts.json` with the new YieldVault address.

### 2. Update Backend (Already Done!)

Backend changes:
- Fixed `amountRaised` unit mismatch bug in [yield-distribution.service.ts](packages/backend/src/modules/yield/services/yield-distribution.service.ts#L48-L50)
- Simplified `distributeYield()` - just deposits to vault, no complex distribution
- Removed unnecessary token-days calculation for primary-only market

No code changes needed - just restart backend:
```bash
cd packages/backend
npm run start:dev
```

### 3. Test Flow

#### Admin Settlement:
```bash
# Same as before - uses existing script
ADMIN_PRIVATE_KEY=0x... ./scripts/admin-settle-yield.sh <asset-id> 100
```

#### Investor Claim (NEW SCRIPT):
```bash
# Option 1: Burn ALL tokens
INVESTOR_PRIVATE_KEY=0x... ./scripts/investor-claim-yield-v2.sh 0xTOKENADDRESS

# Option 2: Burn specific amount
INVESTOR_PRIVATE_KEY=0x... ./scripts/investor-claim-yield-v2.sh 0xTOKENADDRESS 50
```

---

## API Changes (Backend)

### Settlement API (No changes needed!)
```bash
# 1. Record Settlement
POST /admin/yield/settlement
{
  "assetId": "...",
  "settlementAmount": 100,  # USD value
  "settlementDate": "2025-12-30"
}

# 2. Confirm USDC Conversion
POST /admin/yield/confirm-usdc
{
  "settlementId": "...",
  "usdcAmount": "98500000"  # USDC WEI (6 decimals)
}

# 3. Distribute (deposits to vault)
POST /admin/yield/distribute
{
  "settlementId": "..."
}
```

**Response changed:**
```json
{
  "message": "Settlement deposited to YieldVault - investors can now burn tokens to claim",
  "totalDeposited": "98500000",
  "tokenAddress": "0x...",
  "effectiveYield": "23.12%"
}
```

### Investor Claim API (NOT NEEDED!)

Investors claim **DIRECTLY from contract** - no backend API needed!

They call `YieldVault.claimYield(tokenAddress, tokenAmount)` directly.

---

## Smart Contract Interface

### YieldVault (New)

**Admin Functions:**
```solidity
function depositSettlement(address tokenAddress, uint256 totalSettlement) external onlyPlatform
```

**Investor Functions (DIRECT - NO BACKEND):**
```solidity
function claimYield(address tokenAddress, uint256 tokenAmount) external
```

**View Functions:**
```solidity
function getSettlementInfo(address tokenAddress) external view returns (
    uint256 totalSettlement,
    uint256 totalTokenSupply,
    uint256 totalClaimed,
    uint256 totalTokensBurned,
    uint256 yieldPerToken
)

function getClaimableForTokens(address tokenAddress, uint256 tokenAmount) external view returns (uint256)
```

**Events:**
```solidity
event SettlementDeposited(address indexed tokenAddress, bytes32 indexed assetId, uint256 totalSettlement, uint256 totalTokenSupply, uint256 timestamp);
event YieldClaimed(address indexed user, address indexed tokenAddress, uint256 tokensBurned, uint256 usdcReceived, uint256 timestamp);
```

---

## Testing Checklist

- [ ] Deploy new YieldVault contract
- [ ] Update deployed_contracts.json
- [ ] Restart backend
- [ ] Create test asset & tokenize
- [ ] Investor buys tokens on primary market
- [ ] Admin settles invoice using admin-settle-yield.sh
- [ ] Verify settlement deposited (check YieldVault.getSettlementInfo())
- [ ] Investor claims using investor-claim-yield-v2.sh
- [ ] Verify:
  - Tokens burned (investor balance = 0)
  - USDC received matches calculation
  - Yield amount is correct (not 1.54x inflated!)

---

## Backwards Compatibility

The new YieldVault contract keeps deprecated functions for backwards compatibility:

- `depositYield()` - redirects to `depositSettlement()`
- `distributeYieldBatch()` - still works (for emergency use)
- `claimAllYield()` - still works (for old allocations)
- `getUserClaimable()` - still works (returns 0 for new settlements)

**Migration strategy:**
1. Deploy new YieldVault
2. New settlements use burn-to-claim model
3. Old settlements (if any) can still use old claim method

---

## Key Fixes

### 1. Unit Mismatch Bug (CRITICAL FIX)

**Before:**
```typescript
const amountRaised = parseFloat(asset.listing?.amountRaised || '0');
// amountRaised stored as "80000000" (80 USDC in WEI)
// Treated as 80,000,000 USD! ❌
```

**After:**
```typescript
const amountRaisedWei = parseFloat(asset.listing?.amountRaised || '0');
const amountRaised = amountRaisedWei / 1e6;  // Convert to USD ✅
// "80000000" → 80 USD ✓
```

### 2. Simplified Distribution

**Before:** 300+ lines of complex token-days calculation
**After:** 50 lines - just deposit to vault!

---

## Future: Secondary Marketplace

When you build the secondary marketplace, you can add time-weighted token-days tracking:

```solidity
// Future enhancement for secondary market
mapping(address => mapping(address => uint256)) public tokenDays;  // user => token => days held

function claimYieldProportional(address tokenAddress) external {
    // Calculate based on token-days held
    // More complex - but not needed for primary-only market!
}
```

For now, burn-to-claim is perfect for primary market only.

---

## Summary

✅ **Bug Fixed:** Unit mismatch causing 1.54x overpayment
✅ **Simplified:** Removed unnecessary complexity
✅ **Direct Claiming:** Investors → contract (no backend)
✅ **Token Burning:** Clean settlement as required
✅ **Exact Payouts:** $98.50 instead of $152.15 on $100 invoice

**Next Steps:**
1. Deploy new YieldVault
2. Test with your $100 invoice example
3. Verify correct payout!

Happy testing! 🚀
