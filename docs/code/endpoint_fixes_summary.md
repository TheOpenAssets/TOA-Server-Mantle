# Endpoint Fixes - December 24, 2025

## Summary

Fixed two critical issues with the asset management endpoints:

1. **Register Asset Endpoint** - Now returns proper JSON response instead of raw transaction hash
2. **Deploy Token Endpoint** - Fixed BigInt conversion error and UUID handling

---

## Issue 1: Register Asset Response Format

### Problem
The `/admin/assets/:assetId/register` endpoint was returning only the raw transaction hash as a string:
```bash
0xede37f66a40d0e57d27a683d7e4f42aa3cb98dd26a0c3ca8b74884884b9c4b85%
```

### Solution
Updated [asset-ops.controller.ts](packages/backend/src/modules/admin/controllers/asset-ops.controller.ts#L16-L27) to return a structured JSON response:

```typescript
@Post(':assetId/register')
async registerAsset(@Param('assetId') assetId: string) {
  const payload = await this.assetLifecycleService.getRegisterAssetPayload(assetId);
  const txHash = await this.blockchainService.registerAsset(payload);
  
  return {
    success: true,
    message: 'Asset successfully registered on-chain',
    assetId,
    transactionHash: txHash,
    explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
  };
}
```

### New Response Format
```json
{
  "success": true,
  "message": "Asset successfully registered on-chain",
  "assetId": "c25b7a83-2b1c-447d-b2ef-dc95f4ae4bad",
  "transactionHash": "0xede37f66a40d0e57d27a683d7e4f42aa3cb98dd26a0c3ca8b74884884b9c4b85",
  "explorerUrl": "https://sepolia.mantlescan.xyz/tx/0xede37f66a40d0e57d27a683d7e4f42aa3cb98dd26a0c3ca8b74884884b9c4b85"
}
```

---

## Issue 2: Deploy Token BigInt Conversion Error

### Problem
The `/admin/assets/deploy-token` endpoint was failing with:
```
TypeError: Cannot convert undefined to a BigInt
```

This occurred because:
1. The DTO required `totalSupply` and `issuer` as mandatory fields
2. The request wasn't providing these values
3. The service was trying to convert `undefined` to `BigInt`

### Root Cause
The `assetId` being passed was in UUID format (`c25b7a83-2b1c-447d-b2ef-dc95f4ae4bad`), but the smart contract expects a bytes32 format.

### Solution

#### 1. Updated DTO ([deploy-token.dto.ts](packages/backend/src/modules/blockchain/dto/deploy-token.dto.ts))
Made `totalSupply` and `issuer` optional since they can be fetched from the asset record or have sensible defaults:

```typescript
export class DeployTokenDto {
  @IsString()
  @IsNotEmpty()
  assetId!: string;  // UUID format is fine now

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  symbol!: string;

  // Now optional
  @IsOptional()
  @IsString()
  totalSupply?: string;

  @IsOptional()
  @IsString()
  issuer?: string;
}
```

#### 2. Updated Service ([blockchain.service.ts](packages/backend/src/modules/blockchain/services/blockchain.service.ts#L63-L92))
Added UUID to bytes32 conversion and default values:

```typescript
async deployToken(dto: DeployTokenDto): Promise<string> {
  const wallet = this.walletService.getAdminWallet();
  const address = this.contractLoader.getContractAddress('TokenFactory');
  const abi = this.contractLoader.getContractAbi('TokenFactory');

  this.logger.log(`Deploying token for asset ${dto.assetId}...`);

  // Convert UUID to bytes32 for on-chain usage
  const assetIdBytes32 = '0x' + dto.assetId.replace(/-/g, '').padEnd(64, '0');
  
  // Use provided values or defaults
  const totalSupply = dto.totalSupply || '100000'; // Default 100k tokens
  const issuer = dto.issuer || wallet.account.address; // Default to admin wallet

  this.logger.log(`Token params: supply=${totalSupply}, name=${dto.name}, symbol=${dto.symbol}, issuer=${issuer}`);

  const hash = await wallet.writeContract({
    address: address as Address,
    abi,
    functionName: 'deployTokenSuite',
    args: [assetIdBytes32, BigInt(totalSupply), dto.name, dto.symbol, issuer],
  });

  await this.publicClient.waitForTransactionReceipt({ hash });
  this.logger.log(`Token deployed in tx: ${hash}`);
  
  return hash;
}
```

#### 3. Updated Controller Response ([asset-ops.controller.ts](packages/backend/src/modules/admin/controllers/asset-ops.controller.ts#L29-L39))
Added structured response with explorer link:

```typescript
@Post('deploy-token')
async deployToken(@Body() dto: DeployTokenDto) {
  const txHash = await this.blockchainService.deployToken(dto);
  
  return {
    success: true,
    message: 'Token deployment initiated',
    assetId: dto.assetId,
    transactionHash: txHash,
    explorerUrl: `https://sepolia.mantlescan.xyz/tx/${txHash}`,
    note: 'Token address will be available once the transaction is confirmed. Check the events or query the asset.',
  };
}
```

---

## Testing

### Test the Register Endpoint
```bash
curl -X POST "http://localhost:3000/admin/assets/$ASSET_ID/register" \
  --header "Authorization: Bearer $ADMIN_TOKEN" | jq
```

Expected response:
```json
{
  "success": true,
  "message": "Asset successfully registered on-chain",
  "assetId": "c25b7a83-2b1c-447d-b2ef-dc95f4ae4bad",
  "transactionHash": "0x...",
  "explorerUrl": "https://sepolia.mantlescan.xyz/tx/0x..."
}
```

### Test the Deploy Token Endpoint
```bash
curl -X POST "http://localhost:3000/admin/assets/deploy-token" \
  --header "Authorization: Bearer $ADMIN_TOKEN" \
  --header 'Content-Type: application/json' \
  --data '{
    "assetId": "'$ASSET_ID'",
    "name": "Tech Invoice RWA Token",
    "symbol": "TINV"
  }' | jq
```

Expected response:
```json
{
  "success": true,
  "message": "Token deployment initiated",
  "assetId": "c25b7a83-2b1c-447d-b2ef-dc95f4ae4bad",
  "transactionHash": "0x...",
  "explorerUrl": "https://sepolia.mantlescan.xyz/tx/0x...",
  "note": "Token address will be available once the transaction is confirmed. Check the events or query the asset."
}
```

### Automated Test Script
A test script is available at [scripts/test-endpoints.sh](scripts/test-endpoints.sh):

```bash
# Set environment variables first
export ADMIN_TOKEN="your_token_here"
export ASSET_ID="c25b7a83-2b1c-447d-b2ef-dc95f4ae4bad"

# Run the test script
./scripts/test-endpoints.sh
```

---

## Key Improvements

1. **Better UX**: Clients now receive structured JSON responses with clear success/failure indicators
2. **Explorer Links**: Immediate access to view transactions on Mantle Sepolia Explorer
3. **Simplified API**: Deploy token endpoint no longer requires `totalSupply` or `issuer` in the request body
4. **UUID Support**: Automatic conversion from UUID to bytes32 format for blockchain compatibility
5. **Default Values**: Sensible defaults (100k tokens, admin as issuer) make the API easier to use
6. **Error Prevention**: Fixed the BigInt conversion error that was blocking token deployment

---

## Files Modified

1. [packages/backend/src/modules/admin/controllers/asset-ops.controller.ts](packages/backend/src/modules/admin/controllers/asset-ops.controller.ts)
2. [packages/backend/src/modules/blockchain/dto/deploy-token.dto.ts](packages/backend/src/modules/blockchain/dto/deploy-token.dto.ts)
3. [packages/backend/src/modules/blockchain/services/blockchain.service.ts](packages/backend/src/modules/blockchain/services/blockchain.service.ts)

---

## Next Steps

Now that both endpoints are working, you can proceed with the complete flow:

1. ✅ **Register Asset** - Asset is on-chain with attestation
2. 🔄 **Deploy Token** - Create ERC-20 token representing the asset
3. 📝 **List on Marketplace** - Make tokens available for purchase
4. 💰 **Distribute Yield** - When invoice is paid, distribute returns to token holders

Use the commands from the test script to complete the deployment!
