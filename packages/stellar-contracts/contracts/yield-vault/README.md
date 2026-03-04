# YieldVault - Stellar Soroban Contract

## Overview

The YieldVault is the financial settlement engine for the Open Assets platform on Stellar. It implements a **burn-to-claim** model where investors burn their RWA tokens to receive their proportional share of USDC settlement funds when invoices mature.

## Key Features

- **Pro-Rata Distribution**: Investors receive USDC proportional to their token holdings
- **Supply Snapshot**: Settlement amount is based on token supply at deposit time, not current supply
- **Native Burn Pattern**: Uses Stellar's native token burn (transfer to issuer)
- **TTL Management**: Automatic storage extension to prevent data expiry
- **Event Emission**: Publishes events for backend synchronization

## Contract Architecture

### Core Data Structures

**Settlement Record**:
- `asset_code`: The RWA asset identifier (e.g., "RWA-INV001")
- `asset_issuer`: The token issuer address
- `total_settlement_usdc`: Total USDC available for distribution (i128, in stroops)
- `total_supply_snapshot`: Token supply when settlement was deposited (i128)
- `claimed_tokens`: Cumulative tokens burned by all investors (i128)
- `claimed_usdc`: Cumulative USDC claimed (i128)
- `settled_at`: Unix timestamp of settlement

**SettlementInfo** (for queries):
- All settlement fields plus `remaining_usdc` and `yield_per_token` calculations

### Storage Model

- **Instance Storage**: Platform address, USDC asset address (immutable after init)
- **Persistent Storage**: Settlement records and user claim timestamps
- **TTL Strategy**: 30-day threshold, 90-day bump for settlements; 15-day/45-day for user claims

## Public Interface

### Initialization

```rust
fn init(env: Env, platform: Address, usdc_asset: Address)
```
Initialize the contract with platform admin address and USDC Stellar Asset Contract address.

### Admin Functions

```rust
fn deposit_settlement(
    env: Env,
    platform: Address,
    asset_code: String,
    asset_issuer: Address,
    settlement_amount: i128,
    total_supply: i128
)
```
Deposit settlement for an asset. Only callable by platform. Records the settlement and transfers USDC from platform to vault.

**Parameters**:
- `platform`: Must be the authorized platform address
- `asset_code`: Asset identifier (e.g., "RWA-INV001")
- `asset_issuer`: Token issuer address
- `settlement_amount`: USDC to distribute (in stroops, 7 decimals)
- `total_supply`: Current total token supply for pro-rata calculation

### Investor Functions

```rust
fn claim_yield(
    env: Env,
    asset_code: String,
    asset_issuer: Address,
    token_amount: i128,
    claimer: Address
) -> i128
```
Burn tokens to claim proportional USDC share.

**Formula**: `usdc_amount = (token_amount * total_settlement) / supply_snapshot`

**Returns**: Amount of USDC transferred to claimer

### Query Functions

```rust
fn get_claimable_amount(env: Env, asset_code: String, token_amount: i128) -> i128
```
Preview USDC amount for a given token burn (read-only, no state changes).

```rust
fn get_settlement_info(env: Env, asset_code: String) -> Option<SettlementInfo>
```
Get complete settlement status including claimed amounts, remaining USDC, and yield per token.

```rust
fn is_settled(env: Env, asset_code: String) -> bool
```
Check if settlement exists for an asset.

```rust
fn get_user_last_claim(env: Env, asset_code: String, user: Address) -> Option<u64>
```
Get user's last claim timestamp for analytics.

```rust
fn get_platform(env: Env) -> Address
fn get_usdc_asset(env: Env) -> Address
```
Utility functions to retrieve contract configuration.

## Events

### Settlement Deposited
**Topic**: `symbol_short!("deposit")`
**Data**: `(asset_code: String, settlement_amount: i128, supply_snapshot: i128, timestamp: u64)`

Published when admin deposits a settlement.

### Yield Claimed
**Topic**: `symbol_short!("claim")`
**Data**: `(claimer: Address, asset_code: String, token_amount: i128, usdc_amount: i128)`

Published when investor claims yield.

## Deployment

### Build

```bash
cd packages/stellar-contracts
cargo build --target wasm32-unknown-unknown --release --package yield-vault
```

Output: `target/wasm32-unknown-unknown/release/yield_vault.wasm` (~12KB)

### Deploy

```bash
# Deploy the settlement stack
STACK=settlement npm run deploy:stack
```

This will:
1. Build all contracts
2. Deploy YieldVault with platform address and USDC asset
3. Initialize the contract
4. Store the contract address in `deployed_contracts.json`

### Manual Deployment

```bash
# Deploy contract
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/yield_vault.wasm \
  --source <ACCOUNT> \
  --network testnet

# Initialize (use returned contract ID)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ACCOUNT> \
  --network testnet \
  -- init \
  --platform <PLATFORM_ADDRESS> \
  --usdc_asset <USDC_SAC_ADDRESS>
```

## Security Features

### Access Control
- Only platform address can deposit settlements (enforced via `require_auth`)
- All claims require authorization from the claimer
- No admin escape hatch to withdraw funds

### Financial Safety
- **No Double-Deposit**: Cannot deposit settlement twice for same asset
- **No Pause**: Claims always proceed once settlement deposited
- **Checked Arithmetic**: All multiplication/division uses checked operations
- **Atomic Operations**: All transfers and updates succeed or fully revert

### Validation
- Settlement amount must be positive
- Token amount to burn must be positive
- Cannot claim more USDC than remaining in vault
- Cannot claim before settlement deposited

## Integration with Backend

### Stellar Blockchain Adapter

The backend adapter should implement:

```typescript
async depositYieldToVault(
  assetCode: string,
  assetIssuer: string,
  settlementAmount: bigint,
  totalSupply: bigint
): Promise<string> {
  const yieldVaultAddress = this.config.contracts.yieldVault;

  const tx = await this.stellarClient.contract(yieldVaultAddress)
    .call(
      'deposit_settlement',
      this.platformKeypair.publicKey(),
      assetCode,
      assetIssuer,
      settlementAmount,
      totalSupply
    )
    .sign(this.platformKeypair)
    .send();

  return tx.hash;
}
```

### Event Listening

The backend should monitor for:
- `deposit` events to update database settlement records
- `claim` events to update investor portfolio balances and send notifications

## Differences from EVM Implementation

| Aspect | EVM (Mantle) | Soroban (Stellar) |
|--------|--------------|-------------------|
| Burn Mechanism | `burnFrom()` custom function | Transfer to issuer (native) |
| Supply Snapshot | Query `totalSupply()` on-chain | Backend passes as parameter |
| Asset Identification | Single token address | `(asset_code, issuer)` tuple |
| Numeric Types | uint256 (unlimited) | i128 (checked arithmetic) |
| Storage | Permanent (pay once) | TTL-based (periodic extension) |
| Event System | Named events with fields | Symbol topics + data tuples |

### Why Backend Passes Supply

In Stellar, native assets don't expose `total_supply()` in the standard way. Having the backend pass it:
- ✅ Reduces gas cost (no cross-contract call)
- ✅ Simplifies contract logic
- ✅ Works with both SACs and native assets
- ✅ Backend already tracks this data

The backend is trusted (it's the platform admin), so this doesn't introduce new security risks.

## Example Usage Flow

### 1. Invoice Matures
```
- Originator pays face value off-chain
- Admin confirms payment in backend
- Backend calls depositYieldToVault
```

### 2. Deposit Settlement
```solidity
YieldVault.deposit_settlement(
  platform: GCZA...,
  asset_code: "RWA-INV001",
  asset_issuer: GDXY...,
  settlement_amount: 100_000_0000000,  // $100,000 USDC (7 decimals)
  total_supply: 100_0000000             // 100 tokens
)
// Result: 1000 USDC per token available for claim
```

### 3. Investor Claims
```solidity
// User holds 10 tokens, wants to claim all
YieldVault.claim_yield(
  asset_code: "RWA-INV001",
  asset_issuer: GDXY...,
  token_amount: 10_0000000,             // 10 tokens
  claimer: GBCD...                      // Investor address
)
// Result: 10,000 USDC transferred, 10 tokens burned
```

### 4. Preview Before Claiming
```solidity
// User wants to see potential claim amount
amount = YieldVault.get_claimable_amount(
  asset_code: "RWA-INV001",
  token_amount: 10_0000000
)
// Returns: 10,000 USDC (read-only, no state changes)
```

## Testing Checklist

- [x] Contract compiles without errors
- [ ] Unit tests for deposit_settlement
- [ ] Unit tests for claim_yield
- [ ] Unit tests for query functions
- [ ] Integration tests with mock USDC SAC
- [ ] Integration tests with mock RWA token SAC
- [ ] TTL extension verification
- [ ] Event emission verification
- [ ] Full lifecycle test (register → settle → claim)
- [ ] Overflow/underflow tests
- [ ] Access control tests

## Known Limitations

### Current Version (v0.1.0)
- Settlement cannot be amended after deposit (intentional for security)
- No batch claim support (one asset per transaction)
- No automatic claiming (must be manually triggered)
- No claim delegation

### Future Enhancements (Potential)
- Batch claims for multiple assets in one transaction
- Streaming claims (gradual distribution over time)
- Claim delegation for institutional custody
- Settlement amendments with multi-sig approval

## Performance Characteristics

- **WASM Size**: ~12KB (optimized for deployment cost)
- **Expected Gas**: ~5-10M stroops for deposit, ~3-5M stroops for claim
- **Storage**: ~1KB per settlement record
- **Scalability**: Can handle 1000+ settlements efficiently

## License

Part of the Open Assets platform.
