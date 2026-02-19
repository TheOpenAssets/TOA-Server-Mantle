
---

## Part 8 — Admin Payout (Network-Agnostic)

### 8.1 Current Payout Implementation (Mantle)

The admin payout feature currently lives in `AssetLifecycleService.payoutOriginator()` and executes the following flow:

1. **Calculate Total USDC Raised** (Database Operations — Network-Agnostic ✓)
   - Query all confirmed `PRIMARY_MARKET` purchases for the asset (excludes P2P trades)
   - Sum the `totalPayment` field from each purchase
   - Query all leverage positions holding the asset token
   - Sum the `usdcBorrowed` from each position
   - Total = purchase payments + leverage borrowed amounts

2. **Execute USDC Transfer** (Network-Specific — Mantle-Only ✗)
   - Uses `ethers.js` directly with hardcoded USDC ERC-20 contract
   - Reads platform private key from config
   - Creates wallet client with `JsonRpcProvider`
   - Calls `usdc.transfer(originator, totalUsdcRaised)` on-chain
   - Waits for transaction receipt

3. **Record Payout in MongoDB** (Database Operations — Network-Agnostic ✓)
   - Creates `Payout` document with:
     - `assetId`, `originator`, `amount`, `amountFormatted`
     - `transactionHash`, `blockNumber`, `paidAt`
     - `purchaseIds[]`, `purchasesCount`
     - `leveragePositionIds[]`, `leveragePositionsCount` (if applicable)

4. **Burn Unsold Tokens** (Network-Specific — Mantle-Only ✗)
   - Calls `BlockchainService.burnUnsoldTokens(tokenAddress, assetId)`
   - Uses `ethers.js` to interact with RWAToken contract's `burn()` method
   - Calculates unsold tokens = total supply - tokens sold
   - Burns unsold tokens from platform wallet
   - Updates asset's `token.supply`, `token.unsoldTokensBurned`, `token.burnTransactionHash` in DB

5. **Update Asset Status** (Database Operations — Network-Agnostic ✓)
   - Sets asset status to `PAYOUT_COMPLETE`
   - Sets `checkpoints.payoutComplete = true`
   - Updates `listing.amountRaised`

6. **Send Notifications** (Network-Agnostic ✓)
   - Notifies originator about payout completion
   - Notifies admins about token burn (if any)
   - Uses existing `NotificationService` (works across all networks)

**API Endpoint**: `POST /assets/:assetId/payout` — Admin-only, triggers the entire payout flow.

### 8.2 Problem Statement

The payout flow has two network-specific operations that prevent it from working on Stellar:

1. **USDC Transfer**: Mantle uses ERC-20 USDC contracts with `transfer()` method. Stellar uses native or custom asset transfers with a completely different API (Soroban token contracts or Stellar native assets).

2. **Token Burning**: Mantle uses ERC-20 token contracts with a `burn()` method callable by the platform wallet. Stellar uses Soroban token contracts with different burning mechanisms (or burns may be handled via account deauthorization/clawback).

### 8.3 Solution Architecture

The solution follows the established adapter pattern. We introduce a **Payment Adapter** to handle stablecoin transfers across networks and extend the **Blockchain Adapter** to include token burning.

#### 8.3.1 New Interface: `PaymentAdapter`

Create `packages/backend/src/modules/blockchain/adapters/payment-adapter.interface.ts`:

```typescript
export interface PaymentTransferResult {
  txId: string;              // Transaction hash/ID
  blockNumber?: number;      // Block number (EVM) or ledger sequence (Stellar)
  timestamp?: number;        // Unix timestamp
  from: string;              // Sender address
  to: string;                // Recipient address
  amount: string;            // Amount in base units (wei for EVM, stroops for Stellar)
  amountFormatted: string;   // Human-readable (e.g., "87000 USDC")
  tokenSymbol: string;       // e.g., "USDC"
}

export interface PaymentAdapter {
  /**
   * Transfer stablecoin (USDC) from platform wallet to a recipient
   * @param recipient - Wallet address of recipient
   * @param amount - Amount in base units (string to handle BigInt safely)
   * @returns Transfer result with transaction details
   */
  transferStablecoin(
    recipient: string,
    amount: string
  ): Promise<PaymentTransferResult>;

  /**
   * Get platform's stablecoin balance
   * @returns Balance in base units (string)
   */
  getPlatformStablecoinBalance(): Promise<string>;

  /**
   * Get the stablecoin symbol used on this network (e.g., "USDC")
   * @returns Token symbol
   */
  getStablecoinSymbol(): string;

  /**
   * Get the stablecoin contract/asset identifier
   * @returns Contract address (EVM) or asset code (Stellar)
   */
  getStablecoinIdentifier(): string;
}
```

**Design Notes**:
- Returns are network-agnostic (strings, not viem/ethers types)
- Amount handling uses strings to avoid BigInt serialization issues
- Single responsibility: stablecoin payments only (USDC or equivalent)
- Human-readable formatting included for logging and notifications

#### 8.3.2 Extend `BlockchainAdapter` Interface

Add to `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts`:

```typescript
export interface TokenBurnResult {
  txId: string;              // Transaction hash/ID
  blockNumber?: number;      // Block number (EVM) or ledger sequence (Stellar)
  tokensBurned: string;      // Amount burned in base units (e.g., wei)
  tokensBurnedFormatted: string; // Human-readable (e.g., "5000.00")
  newTotalSupply: string;    // Updated total supply after burn
  newTotalSupplyFormatted: string; // Human-readable
}

export interface BlockchainAdapter {
  // ... existing methods ...

  /**
   * Burn unsold tokens from platform wallet
   * @param tokenIdentifier - Token address (EVM) or asset identifier (Stellar)
   * @param assetId - Asset ID (for logging/context)
   * @returns Burn result or null if no tokens to burn
   */
  burnUnsoldTokens(
    tokenIdentifier: string,
    assetId: string
  ): Promise<TokenBurnResult | null>;
}
```

**Design Notes**:
- Returns `null` if no tokens need burning (all sold)
- Calculates burn amount internally by querying on-chain token balances
- Network-agnostic return type (strings, not BigInt)
- Includes formatted values for immediate use in notifications

#### 8.3.3 EVM Payment Adapter Implementation

Create `packages/backend/src/modules/blockchain/adapters/evm/evm-payment.adapter.ts`:

**Implementation Strategy**:
- Extract the current USDC transfer logic from `AssetLifecycleService.payoutOriginator()`
- Use `ethers.js` (already in use, proven in production)
- Read USDC address from `deployed_contracts.json` (existing pattern)
- Use platform private key from config (existing pattern)
- Returns results in the unified `PaymentTransferResult` format

**Key Methods**:
- `transferStablecoin()`: Calls `usdc.transfer(recipient, amount)`, waits for receipt
- `getPlatformStablecoinBalance()`: Calls `usdc.balanceOf(platformAddress)`
- `getStablecoinSymbol()`: Returns `"USDC"`
- `getStablecoinIdentifier()`: Returns the USDC contract address from config

**Error Handling**:
- Validates sufficient balance before transfer
- Throws descriptive errors if transaction fails
- Logs transaction hash immediately after submission for traceability

#### 8.3.4 EVM Blockchain Adapter Extension

Update `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts`:

**Implementation Strategy**:
- Extract the current burn logic from `BlockchainService.burnUnsoldTokens()`
- Uses `ethers.js` to interact with RWAToken contract
- Reads token ABI from artifacts (existing pattern)
- Calculates unsold tokens = `totalSupply()` - `balanceOf(originatorAddress)` - `balanceOf(platformAddress)` + on-chain `tokensSold` from PrimaryMarket

**Key Method**:
- `burnUnsoldTokens(tokenAddress, assetId)`:
  1. Get platform wallet balance of the token
  2. If balance is 0, return `null` (nothing to burn)
  3. Call `rwaToken.burn(platformBalance)` via platform wallet
  4. Query new total supply after burn
  5. Return `TokenBurnResult` with all details

**Retry Logic** (Preserve Existing Behavior):
- Current implementation has a 3-retry mechanism with exponential backoff
- This should be preserved in the adapter — burning can fail due to gas issues or RPC hiccups
- Each retry should be logged for observability

#### 8.3.5 Stellar Payment Adapter Implementation

Create `packages/backend/src/modules/blockchain/adapters/stellar/stellar-payment.adapter.ts`:

**Implementation Strategy**:
- Uses `@stellar/stellar-sdk` for transaction building
- Stellar has two payment patterns:
  1. **Native Assets**: If USDC is a native Stellar asset, use `Payment` operation
  2. **Soroban Token**: If USDC is a Soroban smart contract token, use contract invocation

**Assumptions** (To Be Confirmed During Implementation):
- USDC on Stellar is likely a Soroban token contract (similar to ERC-20)
- Contract ID will be in Stellar-specific config (e.g., `STELLAR_USDC_CONTRACT_ID`)
- Platform secret key is already in config (`STELLAR_PLATFORM_SECRET`)

**Key Methods**:
- `transferStablecoin()`:
  - Build Stellar transaction with `transfer` operation
  - Sign with platform keypair
  - Submit to Soroban RPC
  - Wait for transaction confirmation
  - Return ledger sequence as `blockNumber` equivalent
- `getPlatformStablecoinBalance()`:
  - Invoke `balance` method on USDC Soroban contract with platform address
- `getStablecoinSymbol()`: Returns `"USDC"` or configurable value
- `getStablecoinIdentifier()`: Returns Soroban contract ID

**Error Handling**:
- Stellar transaction failures return structured error responses
- Parse error codes (e.g., insufficient balance, trustline issues)
- Log transaction hash (envelope hash) for traceability

#### 8.3.6 Stellar Blockchain Adapter Extension

Update `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts`:

**Implementation Strategy**:
- Stellar Soroban tokens may handle burning differently than EVM
- Two common patterns:
  1. **Burn Function**: Soroban token contract has explicit `burn()` function (similar to ERC-20)
  2. **Clawback**: Issuer-controlled clawback of tokens (Stellar-native pattern)

**Assumptions** (To Be Confirmed):
- RWA tokens on Stellar are Soroban contracts with a `burn()` function
- Platform wallet is authorized to burn its own tokens

**Key Method**:
- `burnUnsoldTokens(tokenIdentifier, assetId)`:
  1. Get platform balance of the token (invoke `balance` method)
  2. If balance is 0, return `null`
  3. Invoke `burn` method on token contract with platform balance
  4. Wait for confirmation
  5. Query new total supply
  6. Return `TokenBurnResult`

**Fallback for Stellar-Native Assets**:
- If the token is a Stellar classic asset (not Soroban), burning may involve returning tokens to the issuer
- This should be documented and handled gracefully

### 8.4 Update `AssetLifecycleService.payoutOriginator()`

Refactor the method to use the adapters instead of direct blockchain calls.

**Changes**:

1. **Inject Adapters** (Constructor Injection):
   - Inject `PAYMENT_ADAPTER` token → `PaymentAdapter`
   - Inject `BLOCKCHAIN_ADAPTER` token → `BlockchainAdapter` (already injected for other operations)

2. **Replace USDC Transfer Logic** (Lines 954-999 in current code):
   - Remove all `ethers.js` imports and direct USDC contract interaction
   - Replace with:
     ```typescript
     // Check platform balance
     const platformBalance = await this.paymentAdapter.getPlatformStablecoinBalance();
     const balanceBigInt = BigInt(platformBalance);

     if (balanceBigInt < totalUsdcRaised) {
       throw new Error(`Insufficient USDC balance. Have: ${Number(balanceBigInt) / 1e6}, Need: ${Number(totalUsdcRaised) / 1e6}`);
     }

     // Execute transfer
     this.logger.log(`Transferring ${Number(totalUsdcRaised) / 1e6} USDC to ${asset.originator}`);
     const transferResult = await this.paymentAdapter.transferStablecoin(
       asset.originator,
       totalUsdcRaised.toString()
     );
     this.logger.log(`Transaction submitted: ${transferResult.txId}`);
     this.logger.log(`Transaction confirmed in block ${transferResult.blockNumber}`);
     ```

3. **Update Payout Record Creation** (Lines 1001-1017):
   - Replace `tx.hash` with `transferResult.txId`
   - Replace `receipt.blockNumber` with `transferResult.blockNumber`

4. **Replace Token Burn Logic** (Lines 1020-1144):
   - Remove call to `BlockchainService.burnUnsoldTokens()`
   - Replace with:
     ```typescript
     const burnResult = await this.blockchainAdapter.burnUnsoldTokens(
       asset.token.address,
       assetId
     );

     if (burnResult && BigInt(burnResult.tokensBurned) > 0n) {
       this.logger.log(`✅ Burned ${burnResult.tokensBurnedFormatted} tokens`);
       this.logger.log(`   New supply: ${burnResult.newTotalSupplyFormatted} tokens`);
       this.logger.log(`   Burn tx: ${burnResult.txId}`);

       // Update asset's token supply in database
       await this.assetModel.updateOne(
         { assetId },
         {
           $set: {
             'token.supply': burnResult.newTotalSupply,
             'token.unsoldTokensBurned': burnResult.tokensBurned,
             'token.burnTransactionHash': burnResult.txId,
           }
         }
       );

       // Notifications (existing logic, same)
     } else if (burnResult && BigInt(burnResult.tokensBurned) === 0n) {
       this.logger.log(`✅ No unsold tokens to burn - all tokens were sold`);
       // Notification (existing)
     } else {
       // burnResult is null — adapter couldn't burn (network issue)
       this.logger.warn(`⚠️ Burn operation returned null - may need manual intervention`);
     }
     ```

5. **Update Final Return** (Lines 1195-1207):
   - Replace `tx.hash` with `transferResult.txId`
   - Replace `receipt.blockNumber` with `transferResult.blockNumber`

**Backward Compatibility**:
- All MongoDB operations remain identical
- All notification logic unchanged
- API response structure unchanged (still returns `transactionHash`, `blockNumber`)
- Leverage position handling unchanged (DB-only logic)

### 8.5 Adapter Registration in `BlockchainModule`

Update `packages/backend/src/modules/blockchain/blockchain.module.ts` to register the payment adapter.

**Changes**:

1. **Add Payment Adapter Injection Token**:
   - In `blockchain.constants.ts`: `export const PAYMENT_ADAPTER = 'PAYMENT_ADAPTER';`

2. **Register EVM Payment Adapter** (When `NETWORK_TYPE=mantle`):
   ```typescript
   {
     provide: PAYMENT_ADAPTER,
     useClass: EvmPaymentAdapter,
   }
   ```

3. **Register Stellar Payment Adapter** (When `NETWORK_TYPE=stellar`):
   ```typescript
   {
     provide: PAYMENT_ADAPTER,
     useClass: StellarPaymentAdapter,
   }
   ```

**No Changes Needed**:
- `BlockchainAdapter` registration already exists (from previous work)
- Same dynamic `forRoot()` pattern used for payment adapter
- Global module decorator ensures availability across all services

### 8.6 Testing Strategy

#### Unit Tests
- **EVM Payment Adapter**:
  - Mock `ethers.js` contract calls
  - Test `transferStablecoin()` with valid recipient and amount
  - Test balance check failure (insufficient funds)
  - Test transaction failure handling

- **Stellar Payment Adapter**:
  - Mock Stellar SDK transaction submission
  - Test payment operation building
  - Test balance query via contract invocation
  - Test transaction confirmation parsing

- **Blockchain Adapters (Burn)**:
  - Test `burnUnsoldTokens()` with platform balance > 0
  - Test return `null` when balance is 0
  - Test retry logic on EVM adapter
  - Test formatted output values

#### Integration Tests
- **Mantle End-to-End Payout**:
  1. Create asset, list on marketplace, execute purchases
  2. Call `POST /assets/:assetId/payout`
  3. Verify:
     - USDC transferred to originator on-chain
     - Payout record created in MongoDB
     - Unsold tokens burned
     - Asset status = `PAYOUT_COMPLETE`
     - Notifications sent

- **Stellar End-to-End Payout** (When Stellar contracts are deployed):
  1. Same flow as Mantle
  2. Verify Stellar-specific transaction structures
  3. Verify ledger sequence recorded correctly

- **Cross-Network Safety**:
  - Deploy with `NETWORK_TYPE=stellar` but no leverage module
  - Payout should skip leverage position calculation gracefully (already works — DB query returns empty array)

#### Error Scenarios
- **Insufficient Platform Balance**: Should throw descriptive error before attempting transfer
- **Transaction Failure**: Should throw with transaction hash for debugging
- **Burn Failure**: Should retry 3 times (EVM), then either succeed or throw
- **Notification Failure**: Should log but not fail the payout (existing behavior preserved)

### 8.7 Database Schema (No Changes Required)

The `Payout` schema is already network-agnostic:
- `transactionHash: string` — Works for EVM hashes (0x...) and Stellar envelope hashes
- `blockNumber?: number` — Works for EVM blocks and Stellar ledger sequences
- All other fields are DB-only (asset ID, originator, amounts, purchase IDs)

**No Schema Migrations Needed.**

### 8.8 API Documentation (Swagger)

Existing endpoint: `POST /assets/:assetId/payout`

**Add Response Documentation**:
- Include `transactionHash` (string, network-specific format)
- Include `blockNumber` (number, block or ledger sequence)
- Note: Works across all networks (Mantle, Stellar)

**Add Error Responses**:
- `400 Bad Request`: No USDC raised yet
- `400 Bad Request`: Insufficient platform balance
- `500 Internal Server Error`: Transfer or burn failed (includes transaction hash if available)

### 8.9 Configuration Changes

#### Mantle (Existing Config — No Changes)
- `PLATFORM_PRIVATE_KEY` — Already in use
- `blockchain.rpcUrl` — Already in use
- `deployed_contracts.json` contains USDC address — Already in use

#### Stellar (New Config Required)
Add to `.env.stellar.example`:
```bash
# Stellar Payment Config
STELLAR_USDC_CONTRACT_ID=CBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX  # Soroban USDC contract ID
STELLAR_PLATFORM_SECRET=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX    # Platform wallet secret key
```

Add to `packages/backend/src/config/blockchain.config.ts`:
```typescript
stellar: {
  usdcContractId: process.env.STELLAR_USDC_CONTRACT_ID,
  platformSecret: process.env.STELLAR_PLATFORM_SECRET,
  // ... other Stellar config
}
```

### 8.10 Deployment Checklist

#### Mantle Deployment (Backward Compatibility)
1. ✅ No new env vars needed (uses existing keys)
2. ✅ No database migrations
3. ✅ Deploy code with adapter refactor
4. ✅ Test payout on testnet asset
5. ✅ Verify USDC transfer and token burn work identically

#### Stellar Deployment (New Network)
1. ✅ Set `NETWORK_TYPE=stellar` in `.env`
2. ✅ Set `STELLAR_USDC_CONTRACT_ID` and `STELLAR_PLATFORM_SECRET`
3. ✅ Deploy Stellar RWA token contracts with burn functionality
4. ✅ Deploy code with Stellar adapters
5. ✅ Test payout on Stellar testnet asset
6. ✅ Verify USDC transfer via Soroban contract
7. ✅ Verify token burn via Soroban contract

### 8.11 Logging & Observability

All adapter methods must include structured logging:
- **Before Transfer**: "Transferring {amount} USDC to {recipient}"
- **After Transfer**: "Transfer confirmed: txId={txId}, block={blockNumber}"
- **Before Burn**: "Burning {balance} unsold tokens from {tokenAddress}"
- **After Burn**: "Burned {tokensBurned}, new supply: {newSupply}"
- **On Error**: "Payment failed: {error.message}" (include transaction hash if available)

**Log Levels**:
- `INFO`: Successful operations
- `WARN`: Burn returned null, insufficient balance before transfer
- `ERROR`: Transaction failures, contract call failures

### 8.12 Future Enhancements (Out of Scope)

1. **Multi-Currency Payouts**: Support payouts in tokens other than USDC (e.g., USDT, native tokens)
2. **Partial Payouts**: Allow originators to request partial payouts before full sale
3. **Payout Scheduling**: Automatic payouts triggered by event listeners when listing ends
4. **Gas Optimization**: Batch multiple payouts in a single transaction (EVM only)
5. **Stellar Clawback Support**: Use Stellar's native clawback for token burning instead of contract burns

### 8.13 Implementation Sequence

**Phase 1: Define Interfaces & Constants**
1. Create `PaymentAdapter` interface
2. Add `burnUnsoldTokens` method to `BlockchainAdapter` interface
3. Add `PAYMENT_ADAPTER` injection token to `blockchain.constants.ts`

**Phase 2: EVM Adapter Implementation**
1. Implement `EvmPaymentAdapter` (extract from existing code)
2. Extend `EvmBlockchainAdapter` with `burnUnsoldTokens` method (extract from `BlockchainService`)
3. Register `EvmPaymentAdapter` in `BlockchainModule` for Mantle network

**Phase 3: Refactor `AssetLifecycleService`**
1. Inject `PAYMENT_ADAPTER` and `BLOCKCHAIN_ADAPTER` in constructor
2. Replace USDC transfer logic with `paymentAdapter.transferStablecoin()`
3. Replace burn logic with `blockchainAdapter.burnUnsoldTokens()`
4. Update payout record creation to use adapter result fields
5. Test on Mantle testnet — verify identical behavior

**Phase 4: Stellar Adapter Implementation**
1. Implement `StellarPaymentAdapter` using `@stellar/stellar-sdk`
2. Extend `StellarBlockchainAdapter` with `burnUnsoldTokens` method
3. Add Stellar USDC config to `.env.stellar.example`
4. Register `StellarPaymentAdapter` in `BlockchainModule` for Stellar network

**Phase 5: End-to-End Testing**
1. Test Mantle payout flow (regression test)
2. Test Stellar payout flow on testnet
3. Verify payout records in MongoDB are identical across networks
4. Verify notifications work identically

**Phase 6: Documentation**
1. Update Swagger docs for `/assets/:assetId/payout` endpoint
2. Update `context.md` files for modified services
3. Add payout adapter examples to developer docs

### 8.14 Files to Create

- `packages/backend/src/modules/blockchain/adapters/payment-adapter.interface.ts`
- `packages/backend/src/modules/blockchain/adapters/evm/evm-payment.adapter.ts`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-payment.adapter.ts`

### 8.15 Files to Modify

- `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts` — Add `burnUnsoldTokens` method
- `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts` — Implement `burnUnsoldTokens`
- `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts` — Implement `burnUnsoldTokens`
- `packages/backend/src/modules/blockchain/blockchain.constants.ts` — Add `PAYMENT_ADAPTER` token
- `packages/backend/src/modules/blockchain/blockchain.module.ts` — Register payment adapter providers
- `packages/backend/src/modules/assets/services/asset-lifecycle.service.ts` — Refactor `payoutOriginator()` to use adapters
- `packages/backend/src/modules/blockchain/services/blockchain.service.ts` — Remove `burnUnsoldTokens` method (moved to adapter)
- `packages/backend/src/config/blockchain.config.ts` — Add Stellar USDC config fields
- `packages/backend/.env.stellar.example` — Add Stellar payment config vars

### 8.16 Success Criteria

The payout feature is considered network-agnostic when:

1. ✅ A Mantle deployment can execute payouts using `EvmPaymentAdapter` and burn tokens via `EvmBlockchainAdapter`
2. ✅ A Stellar deployment can execute payouts using `StellarPaymentAdapter` and burn tokens via `StellarBlockchainAdapter`
3. ✅ Both networks produce identical `Payout` records in MongoDB (same schema, same fields)
4. ✅ Both networks send identical notification structures to originators
5. ✅ The `POST /assets/:assetId/payout` API response is identical across networks (except for transaction hash format)
6. ✅ No conditional `if (network === 'mantle')` logic exists in `AssetLifecycleService.payoutOriginator()` — all network branching is encapsulated in adapters
7. ✅ Existing Mantle payouts work identically before and after the refactor (zero behavioral change)
8. ✅ Code coverage remains above 80% for payout flow (unit tests for adapters + integration tests)

---