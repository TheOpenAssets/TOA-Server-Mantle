# Network-Agnostic Yield Settlement Implementation Plan

## Context

### Why This Change Is Needed

The Open Assets platform currently has a yield settlement flow that admin uses to supply settlement funds (invoice face value) to the YieldVault contract when invoices mature. This flow enables investors to claim their yield by burning RWA tokens proportionally to their holdings.

**Current State:**
- Yield settlement is **hardcoded for Mantle/EVM** using direct `BlockchainService` calls
- Uses `viem` library with Mantle-specific chain configuration
- Tightly coupled to EVM wallet operations and contract ABIs
- Located in `YieldDistributionService.distributeYield()` which calls `blockchainService.depositYield()`
- there is no yield contract at all configured in the packages/stellar-contracts/contracts

<!-- Comment : Current state reveiw shall also include the contract capablities to handle changes  -->

**Problem:**
The system is being made network-agnostic to support Stellar alongside Mantle. The yield settlement endpoint is the last critical admin operation that remains EVM-only. Without this migration, admins cannot complete the full asset lifecycle on Stellar networks.

**Business Flow:**
1. Invoice matures and originator pays face value off-chain (e.g., $100)
2. Admin records settlement via `/admin/yield/settlement` endpoint
3. Backend calculates platform fee (1.5% = $1.50) and net distribution ($98.50)
4. Admin confirms USDC conversion via `/admin/yield/confirm-usdc`
<!-- Comment : Currenlty we do nopt have anything liek yield vault on stellar that creation is must too -->
5. **[THIS STEP NEEDS MIGRATION]** Admin calls `/admin/yield/distribute` which deposits net USDC to YieldVault on-chain
6. Investors burn their RWA tokens to claim proportional USDC
7. Leverage/Solvency positions automatically settle in cascade

**Critical Discovery:** The current implementation has a **platform fee gap** - the 1.5% fee is calculated but never actually transferred to a platform wallet. The system only deposits the net amount to YieldVault. This plan will address both network abstraction AND the fee transfer gap.

---

## Implementation Approach

### Architecture Decision: Hybrid Pattern

Following the established codebase pattern for admin operations (registerAsset, deployToken, listOnMarketplace), yield settlement will use the **Strategy + Adapter** hybrid pattern:

1. **BlockchainAdapter Interface** - Add `depositYield()` method for network-agnostic on-chain deposits
2. **IAdminDomainStrategy Interface** - Add `supplyYieldSettlement()` orchestration method for business logic
3. **Network-specific Implementations** - Implement in both EVM and Stellar adapters/strategies
4. **YieldDistributionService** - Update to use `ModuleRegistryService` instead of direct `BlockchainService`

**Why Hybrid?**
- Yield settlement is **admin-initiated** → fits Strategy pattern (like other admin ops)
- Complex orchestration with **cascading settlements** (leverage, solvency, P2P orders) → needs strategy-level business logic
- Network-specific on-chain mechanics → needs adapter-level abstraction

---

## Implementation Steps

### Phase 1: Extend BlockchainAdapter Interface

**File:** `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts`

Add yield settlement methods to the interface:

```typescript
interface BlockchainAdapter {
  // ... existing methods ...

  /**
   * Deposit yield USDC to YieldVault for a specific RWA token
   * Investors can then burn their tokens to claim proportional yield
   *
   * @param tokenIdentifier - EVM: token contract address, Stellar: asset code or SAC ID
   * @param usdcAmount - Raw USDC amount in smallest unit (6 decimals: "1000000" = 1 USDC)
   * @returns Transaction ID and confirmation
   */
  depositYieldToVault(
    tokenIdentifier: string,
    usdcAmount: string,
  ): Promise<{ txId: string }>;

  /**
   * Transfer USDC from admin/platform wallet to a recipient (for platform fee collection)
   *
   * @param recipientAddress - Wallet address to receive USDC
   * @param usdcAmount - Raw USDC amount in smallest unit (6 decimals)
   * @returns Transaction ID
   */
  transferUSDC(
    recipientAddress: string,
    usdcAmount: string,
  ): Promise<{ txId: string }>;
}
```

**Rationale:**
- Separate `depositYieldToVault` from `transferUSDC` for clarity
- Follows naming convention of existing methods (e.g., `listOnMarketplace`, `burnUnsoldTokens`)
- Returns network-agnostic `{ txId: string }` instead of EVM-specific `Hash`

---

### Phase 2: Implement EVM Adapter Methods

**File:** `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts`

Migrate logic from `BlockchainService.depositYield()` (lines 229-271) into the EVM adapter:

```typescript
async depositYieldToVault(tokenIdentifier: string, usdcAmount: string): Promise<{ txId: string }> {
  const wallet = this.walletAdapter.getPlatformWallet(); // EVM wallet client
  const yieldVaultAddress = this.contractAdapter.getContractAddress('YieldVault');
  const yieldVaultAbi = this.contractAdapter.getContractAbi('YieldVault');
  const usdcAddress = this.contractAdapter.getContractAddress('USDC');
  const usdcAbi = this.contractAdapter.getContractAbi('USDC');

  // Step 1: Approve USDC for YieldVault to spend
  this.logger.log(`EVM: Approving YieldVault to spend ${usdcAmount} USDC...`);
  const approvalHash = await wallet.writeContract({
    address: usdcAddress as Address,
    abi: usdcAbi,
    functionName: 'approve',
    args: [yieldVaultAddress, BigInt(usdcAmount)],
  });
  await this.publicClient.waitForTransactionReceipt({ hash: approvalHash });

  // Step 2: Deposit yield to vault
  this.logger.log(`EVM: Depositing ${usdcAmount} USDC to YieldVault for token ${tokenIdentifier}...`);
  const depositHash = await wallet.writeContract({
    address: yieldVaultAddress as Address,
    abi: yieldVaultAbi,
    functionName: 'depositYield',
    args: [tokenIdentifier, BigInt(usdcAmount)],
  });
  await this.publicClient.waitForTransactionReceipt({ hash: depositHash });

  return { txId: depositHash };
}

async transferUSDC(recipientAddress: string, usdcAmount: string): Promise<{ txId: string }> {
  const wallet = this.walletAdapter.getPlatformWallet();
  const usdcAddress = this.contractAdapter.getContractAddress('USDC');
  const usdcAbi = this.contractAdapter.getContractAbi('USDC');

  this.logger.log(`EVM: Transferring ${usdcAmount} USDC to ${recipientAddress}...`);
  const hash = await wallet.writeContract({
    address: usdcAddress as Address,
    abi: usdcAbi,
    functionName: 'transfer',
    args: [recipientAddress as Address, BigInt(usdcAmount)],
  });
  await this.publicClient.waitForTransactionReceipt({ hash });

  return { txId: hash };
}
```

**Rationale:**
- Reuses existing EVM patterns (wallet, contract loader, viem clients)
- Maintains retry logic and timeout handling from current implementation
- Returns `txId` as string (compatible with network-agnostic return type)

---

### Phase 3: Implement Stellar Adapter Methods

**File:** `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts`

Implement Soroban-based yield deposit following the Stellar SDK patterns:

```typescript
async depositYieldToVault(tokenIdentifier: string, usdcAmount: string): Promise<{ txId: string }> {
  const platformKeypair = this.walletAdapter.getPlatformKeypair();
  const yieldVaultContractId = this.contractAdapter.getContractAddress('YieldVault');

  // Check if YieldVault is deployed
  if (!yieldVaultContractId) {
    throw new Error('Stellar YieldVault contract not deployed - cannot deposit yield');
  }

  const yieldVault = new Contract(yieldVaultContractId);
  const source = await this.sorobanServer.getAccount(platformKeypair.publicKey());

  // Build transaction to call deposit_yield on Soroban YieldVault
  const depositTx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: this.networkPassphrase,
  })
  .addOperation(
    yieldVault.call(
      'deposit_yield',  // Soroban contract function
      new Address(platformKeypair.publicKey()).toScVal(),  // sender (platform)
      xdr.ScVal.scvString(tokenIdentifier),  // token identifier (asset code or SAC ID)
      xdr.ScVal.scvI128(  // amount as i128 (Stellar's bigint type)
        new xdr.Int128Parts({
          lo: xdr.Uint64.fromString(usdcAmount),
          hi: xdr.Int64.fromString('0'),
        })
      ),
    )
  )
  .setTimeout(60)
  .build();

  // Simulate, assemble, sign, submit, confirm
  const simResult = await this.sorobanServer.simulateTransaction(depositTx);
  const preparedTx = rpc.assembleTransaction(depositTx, simResult).build();
  preparedTx.sign(platformKeypair);

  const response = await this.sorobanServer.sendTransaction(preparedTx);
  if (response.status !== 'PENDING') {
    throw new Error(`Stellar deposit failed: ${response.status}`);
  }

  await this.confirmTransaction(response.hash, 60000);  // Poll for up to 60s
  return { txId: response.hash };
}

async transferUSDC(recipientAddress: string, usdcAmount: string): Promise<{ txId: string }> {
  const platformKeypair = this.walletAdapter.getPlatformKeypair();

  // Use Circle's USDC on Stellar Testnet
  const circleUSDC = new Asset(
    'USDC',
    'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'  // Circle issuer
  );
  const usdcSacId = circleUSDC.contractId(this.networkPassphrase);
  const usdcContract = new Contract(usdcSacId);

  const source = await this.sorobanServer.getAccount(platformKeypair.publicKey());

  // Build USDC transfer transaction
  const transferTx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: this.networkPassphrase,
  })
  .addOperation(
    usdcContract.call(
      'transfer',
      new Address(platformKeypair.publicKey()).toScVal(),  // from
      new Address(recipientAddress).toScVal(),  // to
      xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          lo: xdr.Uint64.fromString(usdcAmount),
          hi: xdr.Int64.fromString('0'),
        })
      ),  // amount
    )
  )
  .setTimeout(60)
  .build();

  const simResult = await this.sorobanServer.simulateTransaction(transferTx);
  const preparedTx = rpc.assembleTransaction(transferTx, simResult).build();
  preparedTx.sign(platformKeypair);

  const response = await this.sorobanServer.sendTransaction(preparedTx);
  await this.confirmTransaction(response.hash, 60000);

  return { txId: response.hash };
}
```

**Rationale:**
- Follows existing Stellar adapter patterns (transaction builder, simulation, assembly)
- Uses Soroban i128 type for amounts (standard for Stellar token operations)
- Leverages Circle's USDC SAC (Stellar Asset Contract) for USDC transfers
- Robust confirmation with polling (reuses `confirmTransaction()` helper)

**Critical Note:** Stellar YieldVault contract must be deployed before this can work. If not deployed, the method will throw an explicit error.

---

### Phase 4: Extend NetworkRegistryService

**File:** `packages/backend/src/modules/blockchain/services/network-registry.service.ts`

Add orchestration methods for yield settlement with feature gating:

```typescript
async depositYieldToVault(
  tokenIdentifier: string,
  usdcAmount: string,
): Promise<{ txId: string; skipped?: boolean }> {
  if (!this.isAvailable('yield')) {
    return { txId: '', skipped: true };
  }
  const adapter = await this.getBlockchainAdapter();
  return await adapter.depositYieldToVault(tokenIdentifier, usdcAmount);
}

async transferUSDCForFee(
  recipientAddress: string,
  usdcAmount: string,
): Promise<{ txId: string; skipped?: boolean }> {
  if (!this.isAvailable('yield')) {
    return { txId: '', skipped: true };
  }
  const adapter = await this.getBlockchainAdapter();
  return await adapter.transferUSDC(recipientAddress, usdcAmount);
}
```

**Rationale:**
- Follows existing NetworkRegistryService pattern (feature check → adapter delegation)
- Returns `skipped: true` if yield feature is disabled for the network
- Consistent with other registry methods (e.g., `registerIdentityOnChain`, `deployAssetToken`)

---

### Phase 5: Extend IAdminDomainStrategy Interface

**File:** `packages/backend/src/modules/registry/interfaces/admin-domain.interface.ts`

Add high-level yield settlement method:

```typescript
interface IAdminDomainStrategy {
  // ... existing methods ...

  /**
   * Execute complete yield settlement workflow:
   * 1. Transfer platform fee to admin wallet (NEW)
   * 2. Deposit net yield to YieldVault
   * 3. Update settlement status
   * 4. Cascade settlements (leverage, solvency, P2P orders)
   * 5. Send notifications
   */
  supplyYieldSettlement(settlementId: string): Promise<{
    vaultDepositTxId: string;
    feeTransferTxId?: string;
    effectiveYield: string;
    leveragePositionsSettled: number;
  }>;
}
```

**Rationale:**
- Encapsulates complex orchestration logic
- Network-agnostic interface (txId is string, works for both EVM hash and Stellar hash)
- Returns structured result with all transaction IDs for audit trail

---

### Phase 6: Implement Strategy Methods

#### **File:** `packages/backend/src/modules/admin/implementations/mantle/mantle-admin-strategy.service.ts`

```typescript
async supplyYieldSettlement(settlementId: string): Promise<any> {
  const settlement = await this.settlementModel.findById(settlementId);
  if (!settlement) throw new NotFoundException('Settlement not found');
  if (settlement.status !== SettlementStatus.READY_FOR_DISTRIBUTION) {
    throw new Error('Settlement not ready for distribution');
  }

  const tokenAddress = settlement.tokenAddress;
  const platformFeeWei = Math.floor(settlement.platformFee * 1e6).toString(); // Convert USD to USDC wei
  const netDistributionWei = settlement.usdcAmount; // Already in USDC wei

  // Step 1: Transfer platform fee to admin wallet (FIXES THE GAP!)
  let feeTransferTxId: string | undefined;
  if (Number(platformFeeWei) > 0) {
    this.logger.log(`Transferring platform fee: ${settlement.platformFee} USD (${platformFeeWei} USDC wei)`);
    const adminWallet = this.configService.get<string>('blockchain.adminWallet'); // Admin wallet address
    const feeResult = await this.networkRegistryService.transferUSDCForFee(
      adminWallet,
      platformFeeWei,
    );
    feeTransferTxId = feeResult.txId;
    this.logger.log(`Platform fee transferred: ${feeTransferTxId}`);
  }

  // Step 2: Deposit net yield to YieldVault
  this.logger.log(`Depositing net yield: ${Number(netDistributionWei) / 1e6} USDC to YieldVault`);
  const depositResult = await this.networkRegistryService.depositYieldToVault(
    tokenAddress,
    netDistributionWei,
  );
  this.logger.log(`Yield deposited: ${depositResult.txId}`);

  // Step 3: Update settlement status
  settlement.status = SettlementStatus.DISTRIBUTED;
  settlement.distributedAt = new Date();
  settlement.vaultDepositTxHash = depositResult.txId;
  settlement.feeTransferTxHash = feeTransferTxId;
  await settlement.save();

  // Step 4: Return results (orchestration layer will handle notifications)
  return {
    vaultDepositTxId: depositResult.txId,
    feeTransferTxId,
    effectiveYield: settlement.amountRaised > 0
      ? `${(((settlement.netDistribution - settlement.amountRaised) / settlement.amountRaised) * 100).toFixed(2)}%`
      : 'N/A',
  };
}
```

#### **File:** `packages/backend/src/modules/admin/implementations/stellar/stellar-admin-strategy.service.ts`

(Same implementation as Mantle, but uses Stellar-specific config values)

**Rationale:**
- Implements BOTH fee transfer AND vault deposit in correct order
- Fixes the platform fee gap discovered during exploration
- Records both transaction hashes in settlement for audit trail
- Network-agnostic (both strategies use same NetworkRegistryService interface)

---

### Phase 7: Update YieldDistributionService

**File:** `packages/backend/src/modules/yield/services/yield-distribution.service.ts`

Replace direct `blockchainService` usage with `ModuleRegistryService` delegation:

**Changes:**
1. Remove `BlockchainService` injection (line 41)
2. Add `ModuleRegistryService` injection
3. Update `distributeYield()` method (lines 158-519)

```typescript
constructor(
  @InjectModel(Settlement.name) private settlementModel: Model<SettlementDocument>,
  // ... other dependencies ...
  private readonly moduleRegistryService: ModuleRegistryService,  // NEW
  // Remove: private blockchainService: BlockchainService
  @Inject(forwardRef(() => LeveragePositionService))
  private leveragePositionService: LeveragePositionService,
  // ... rest of dependencies ...
) {}

async distributeYield(settlementId: string) {
  const settlement = await this.settlementModel.findById(settlementId);
  if (!settlement) throw new NotFoundException('Settlement not found');
  if (settlement.status !== SettlementStatus.READY_FOR_DISTRIBUTION) {
    throw new Error('Settlement not ready for distribution');
  }

  // Delegate yield supply to admin strategy
  const strategy = this.moduleRegistryService.getAdminDomainStrategy();
  const supplyResult = await strategy.supplyYieldSettlement(settlementId);

  this.logger.log(
    `✅ Yield settlement completed!\n` +
    `Vault Deposit TX: ${supplyResult.vaultDepositTxId}\n` +
    `Fee Transfer TX: ${supplyResult.feeTransferTxId || 'N/A'}\n` +
    `Effective Yield: ${supplyResult.effectiveYield}`,
  );

  // Continue with cascade settlements (leverage, solvency, P2P orders)
  // [Lines 232-498 remain mostly unchanged - leverage/solvency settlement logic]

  // Asset status update
  await this.assetModel.updateOne(
    { assetId: settlement.assetId },
    { $set: { status: 'ENDED' } }
  );

  return {
    message: 'Settlement deposited to YieldVault - investors can now burn tokens to claim',
    totalDeposited: settlement.usdcAmount,
    tokenAddress: settlement.tokenAddress,
    effectiveYield: supplyResult.effectiveYield,
    vaultDepositTxId: supplyResult.vaultDepositTxId,
    feeTransferTxId: supplyResult.feeTransferTxId,
    leveragePositionsSettled: 0,  // Will be updated by cascade logic
  };
}
```

**Rationale:**
- Removes EVM-specific `BlockchainService` dependency
- Uses established admin strategy pattern (same as registerAsset, deployToken)
- Maintains all existing cascade settlement logic (leverage, solvency, P2P orders)
- Returns detailed results with all transaction IDs for transparency

---

### Phase 8: Update Settlement Schema

**File:** `packages/backend/src/database/schemas/settlement.schema.ts`

Add fields to track transaction hashes:

```typescript
@Schema({ timestamps: true })
export class Settlement {
  // ... existing fields ...

  @Prop()
  vaultDepositTxHash?: string;  // NEW: TX hash for YieldVault deposit

  @Prop()
  feeTransferTxHash?: string;   // NEW: TX hash for platform fee transfer

  // ... rest of schema ...
}
```

**Rationale:**
- Provides audit trail for both on-chain transactions
- Enables transaction verification and debugging
- Follows existing schema pattern (e.g., `transactionHash` in Asset schema)

---

### Phase 9: Update Network Config

**File:** `packages/backend/src/config/network.config.ts`

Ensure `yield` feature is enabled in network features map:

```typescript
export default registerAs('network', () => ({
  networkType: process.env.NETWORK_TYPE || 'mantle',
  networkName: process.env.NETWORK_TYPE === 'stellar' ? 'Stellar Testnet' : 'Mantle Sepolia',
  features: {
    kyc: true,
    assets: true,
    marketplace: true,
    yield: true,  // ENSURE THIS IS TRUE
    // ... other features ...
  },
  // ... rest of config ...
}));
```

**File:** `packages/backend/.env.example`

Document required environment variables:

```bash
# Yield Settlement
BLOCKCHAIN_ADMIN_WALLET=0x...  # EVM: Admin wallet address to receive platform fees
STELLAR_ADMIN_PUBLIC=G...      # Stellar: Admin public key to receive platform fees
STELLAR_YIELD_VAULT_CONTRACT_ID=C...  # Stellar YieldVault contract ID (if deployed)
```

**Rationale:**
- Feature flag ensures yield operations are available on both networks
- Environment variables provide flexibility for different deployments
- Clear documentation for operations team

---

## Critical Files to Modify

### Blockchain Layer
1. `packages/backend/src/modules/blockchain/adapters/blockchain-adapter.interface.ts` - Add `depositYieldToVault()`, `transferUSDC()`
2. `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts` - Implement EVM methods
3. `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts` - Implement Stellar methods
4. `packages/backend/src/modules/blockchain/services/network-registry.service.ts` - Add orchestration methods

### Admin Layer
5. `packages/backend/src/modules/registry/interfaces/admin-domain.interface.ts` - Add `supplyYieldSettlement()`
6. `packages/backend/src/modules/admin/implementations/mantle/mantle-admin-strategy.service.ts` - Implement strategy method
7. `packages/backend/src/modules/admin/implementations/stellar/stellar-admin-strategy.service.ts` - Implement strategy method

### Yield Layer
8. `packages/backend/src/modules/yield/services/yield-distribution.service.ts` - Update to use ModuleRegistryService

### Database
9. `packages/backend/src/database/schemas/settlement.schema.ts` - Add `vaultDepositTxHash`, `feeTransferTxHash`

### Configuration
10. `packages/backend/src/config/network.config.ts` - Verify `yield` feature enabled
11. `packages/backend/.env.example` - Document admin wallet env vars

---

## Existing Code to Reuse

### EVM Patterns
- **Transaction building:** `packages/backend/src/modules/blockchain/adapters/evm/evm-blockchain.adapter.ts`
  - `wallet.writeContract()` pattern (lines 200-250)
  - `publicClient.waitForTransactionReceipt()` pattern
  - Retry logic with `executeWithRetry()` helper

- **Contract loading:** `packages/backend/src/modules/blockchain/adapters/evm/evm-contract-loader.adapter.ts`
  - `getContractAddress()` - Loads addresses from `deployed_contracts.json`
  - `getContractAbi()` - Loads ABIs from Solidity artifacts

### Stellar Patterns
- **Transaction building:** `packages/backend/src/modules/blockchain/adapters/stellar/stellar-blockchain.adapter.ts`
  - `TransactionBuilder` pattern (lines 150-200)
  - `simulateTransaction` → `assembleTransaction` → `sign` → `sendTransaction` flow
  - `confirmTransaction()` helper with polling (lines 400-450)

- **USDC transfers:** `packages/backend/src/modules/blockchain/adapters/stellar/stellar-payment.adapter.ts`
  - Circle USDC SAC usage (lines 50-100)
  - i128 amount encoding for Soroban tokens

### Strategy Pattern
- **Admin operations:** `packages/backend/src/modules/admin/implementations/mantle/mantle-admin-strategy.service.ts`
  - `registerAsset()` - Shows NetworkRegistryService delegation pattern (lines 30-50)
  - `deployToken()` - Shows error handling and notification patterns (lines 60-120)
  - `listOnMarketplace()` - Shows transaction result recording (lines 130-180)

### Service Registry
- **Feature gating:** `packages/backend/src/modules/blockchain/services/network-registry.service.ts`
  - `isAvailable()` check pattern (line 42)
  - Skipped result pattern (lines 50-56)
  - Adapter resolution with `getBlockchainAdapter()` (lines 35-40)

---

## Verification Plan

### Phase 1: Unit Testing (Adapter Level)

**Test EVM Adapter:**
```bash
# Mock viem wallet and contract interactions
# Test depositYieldToVault() with mock YieldVault contract
# Test transferUSDC() with mock USDC contract
# Verify correct ABI calls and transaction confirmations
```

**Test Stellar Adapter:**
```bash
# Mock Soroban RPC server
# Test depositYieldToVault() with mock YieldVault Soroban contract
# Test transferUSDC() with mock USDC SAC
# Verify correct transaction building and simulation
```

### Phase 2: Integration Testing (Strategy Level)

**Test Mantle Strategy:**
```bash
# Use Mantle Sepolia testnet
# Execute supplyYieldSettlement() with real settlement record
# Verify both transactions (fee transfer + vault deposit) succeed
# Check settlement schema updates (vaultDepositTxHash, feeTransferTxHash)
```

**Test Stellar Strategy:**
```bash
# Use Stellar Testnet
# Prerequisites: Ensure Stellar YieldVault contract is deployed
# Execute supplyYieldSettlement() with real settlement record
# Verify Soroban transactions on Stellar explorer (stellarchain.io)
# Check settlement schema updates
```

### Phase 3: End-to-End Testing (Full Yield Flow)

**Mantle E2E:**
```bash
# 1. Create asset and deploy token
# 2. List on marketplace and complete sale
# 3. Record settlement: POST /admin/yield/settlement
# 4. Confirm USDC: POST /admin/yield/confirm-usdc
# 5. Distribute yield: POST /admin/yield/distribute
# 6. Verify:
#    - Platform fee arrives in admin wallet
#    - Net yield deposited to YieldVault
#    - Investor can burn tokens to claim USDC
#    - Settlement status = DISTRIBUTED
#    - Asset status = ENDED
```

**Stellar E2E:**
```bash
# Same flow as Mantle but on Stellar Testnet
# Verify transactions on Stellar explorer
# Check Soroban contract events for deposit_yield emission
```

### Phase 4: Platform Fee Validation

**Critical Test Cases:**
```bash
# Test Case 1: Zero fee scenario
Settlement: $100, Fee Rate: 0%
Expected: $0 fee transfer (skipped), $100 to vault

# Test Case 2: Standard fee scenario
Settlement: $100, Fee Rate: 1.5%
Expected: $1.50 fee to admin wallet, $98.50 to vault

# Test Case 3: Large settlement scenario
Settlement: $1,000,000, Fee Rate: 1.5%
Expected: $15,000 fee to admin wallet, $985,000 to vault

# Test Case 4: Rounding edge case
Settlement: $100.33, Fee Rate: 1.5%
Expected: $1.50 fee (rounded), $98.83 to vault
```

### Phase 5: Network Switching Validation

**Environment Variable Switch:**
```bash
# Switch NETWORK_TYPE between 'mantle' and 'stellar'
# Verify correct adapter is loaded (check logs for "EVM:" vs "Stellar:" prefixes)
# Ensure no EVM-specific errors on Stellar and vice versa
```

---

## Risks and Mitigations

### Risk 1: Stellar YieldVault Not Deployed
**Impact:** HIGH - Cannot execute yield settlements on Stellar
**Mitigation:** Stellar adapter throws explicit error if contract not found. Operations team must deploy Stellar YieldVault contract before enabling Stellar yield settlements. Add deployment check to pre-deployment testing.

### Risk 2: Platform Fee Calculation Precision
**Impact:** MEDIUM - Rounding errors could cause small fund discrepancies
**Mitigation:** Use `Math.floor()` for fee calculation to ensure vault always receives exact net amount. Log all amounts (fee, net) with high precision for audit trail.

### Risk 3: Transaction Confirmation Timeouts
**Impact:** MEDIUM - Settlement status not updated if confirmation fails
**Mitigation:** Both adapters use robust retry logic with 60s timeouts. Settlement remains in READY_FOR_DISTRIBUTION state on failure, allowing manual retry.

### Risk 4: Cascade Settlement Dependencies
**Impact:** LOW - Leverage/Solvency settlements depend on YieldVault deposit
**Mitigation:** Maintain existing error handling in YieldDistributionService. Log failures but don't throw (lines 403-407, 414-417).

### Risk 5: Configuration Mismatch
**Impact:** MEDIUM - Wrong admin wallet receives fees
**Mitigation:** Document required env vars clearly in .env.example. Add startup validation to check admin wallet configuration.

---

## Success Criteria

1. ✅ **Network Agnostic:** Yield settlement works on both Mantle and Stellar with only NETWORK_TYPE env var change
2. ✅ **Platform Fee Fixed:** 1.5% fee correctly transferred to admin wallet on both networks
3. ✅ **Audit Trail:** Both transaction hashes (fee + vault) recorded in settlement schema
4. ✅ **Backward Compatible:** Existing Mantle deployments work without code changes
5. ✅ **Zero Regressions:** All existing tests pass, cascade settlements (leverage, solvency) continue working
6. ✅ **Stellar Ready:** When Stellar YieldVault is deployed, settlements work immediately
7. ✅ **Clear Errors:** Explicit error messages if contracts not deployed or configuration missing

---

## Post-Implementation Tasks

1. **Deploy Stellar YieldVault Contract:** Smart contract team must deploy Soroban YieldVault with `deposit_yield()` and `claim_yield()` functions matching Mantle interface
2. **Update Operations Documentation:** Document yield settlement flow for both networks
3. **Admin Dashboard Update:** Show transaction links for both fee transfer and vault deposit
4. **Monitoring Alerts:** Add alerts for failed yield settlements (transaction failures, confirmation timeouts)
5. **Performance Testing:** Measure gas costs and transaction times on both networks for large settlements

---

## Timeline Estimate

- Phase 1-4 (Adapter + Registry): 2-3 hours
- Phase 5-7 (Strategy + Service): 2-3 hours
- Phase 8-9 (Schema + Config): 30 minutes
- Testing (Unit + Integration): 2-3 hours
- End-to-End Validation: 1-2 hours

**Total:** ~8-12 hours of focused development and testing

---

## Dependencies

**Before Implementation:**
- None - All required infrastructure exists (adapters, strategies, registry)

**Before Stellar Deployment:**
- Stellar YieldVault Soroban contract must be deployed
- Stellar admin wallet must have USDC balance for fees
- Stellar platform wallet must have USDC balance for vault deposits

**Before Production:**
- Admin wallet addresses configured in environment
- Platform fee rate confirmed (currently 1.5%)
- Operations team trained on new dual-transaction flow
