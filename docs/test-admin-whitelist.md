# Admin Whitelist Security Fix

## Problem (CRITICAL VULNERABILITY - FIXED)

Previously, **ANY wallet address could become an admin** by simply requesting a challenge with `role: 'ADMIN'`. This was a critical security vulnerability.

## Solution

Added admin whitelist validation at **two layers**:

### 1. Challenge Creation ([auth.service.ts:48-52](src/modules/auth/services/auth.service.ts#L48-L52))

```typescript
async createChallenge(walletAddress: string, role?: UserRole) {
  // Validate admin role request
  if (role === UserRole.ADMIN && !this.isApprovedAdmin(walletAddress)) {
    throw new ForbiddenException('Wallet address not authorized for admin role');
  }
  // ... continue
}
```

### 2. Login/Signature Verification ([auth.service.ts:96-99](src/modules/auth/services/auth.service.ts#L96-L99))

```typescript
// 3a. Validate admin role (defense in depth)
if (rolePreference === UserRole.ADMIN && !this.isApprovedAdmin(walletAddress)) {
  throw new ForbiddenException('Wallet address not authorized for admin role');
}
```

## Whitelist Configuration

Approved admin addresses are stored in:
```
packages/backend/configs/approved_admins.json
```

```json
{
    "admins": [
        "0x23e67597f0898f747Fa3291C8920168adF9455D0"
    ]
}
```

### Adding New Admins

1. Edit `configs/approved_admins.json`
2. Add the wallet address to the `admins` array
3. Restart the backend server
4. The new admin can now request challenges and login as admin

## Testing

### Test 1: Approved Admin ✅

```bash
# Request challenge as admin (approved wallet)
curl -X POST "http://localhost:3000/auth/challenge" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x23e67597f0898f747Fa3291C8920168adF9455D0",
    "role": "ADMIN"
  }'

# Expected: Returns challenge message
# ✅ ALLOWED
```

### Test 2: Unapproved Admin ❌

```bash
# Request challenge as admin (unauthorized wallet)
curl -X POST "http://localhost:3000/auth/challenge" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x6F662Dc7814aD324a361D0D1B0D1a457222eb42f",
    "role": "ADMIN"
  }'

# Expected: 403 Forbidden
# {
#   "statusCode": 403,
#   "message": "Wallet address not authorized for admin role"
# }
# ❌ BLOCKED
```

### Test 3: Originator/Investor (No Restriction) ✅

```bash
# Any wallet can be ORIGINATOR or INVESTOR
curl -X POST "http://localhost:3000/auth/challenge" \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "0x6F662Dc7814aD324a361D0D1B0D1a457222eb42f",
    "role": "ORIGINATOR"
  }'

# Expected: Returns challenge message
# ✅ ALLOWED (ORIGINATOR and INVESTOR roles are unrestricted)
```

## Security Features

1. **Defense in Depth**: Validation at both challenge creation AND login
2. **Case-Insensitive**: Wallet addresses are normalized to lowercase
3. **Fail-Safe**: If config file can't be loaded, admin list defaults to empty (denies all)
4. **No Bypass**: Even if role is stored in Redis, login validates again before creating user

## Impact

- ✅ Only whitelisted addresses can become admins
- ✅ Unauthorized admin attempts are blocked immediately
- ✅ Existing non-admin users are unaffected
- ✅ ORIGINATOR and INVESTOR roles remain open to all wallets

## Files Modified

1. [packages/backend/src/modules/auth/services/auth.service.ts](src/modules/auth/services/auth.service.ts)
   - Added `approvedAdmins` property
   - Added constructor to load whitelist
   - Added `isApprovedAdmin()` helper
   - Added validation in `createChallenge()`
   - Added validation in `login()`

2. [packages/backend/configs/approved_admins.json](../configs/approved_admins.json)
   - Created whitelist configuration file
