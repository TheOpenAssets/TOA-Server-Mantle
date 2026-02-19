# YieldVault Contract Context

## Responsibility

The YieldVault contract is the financial settlement engine for the Open Assets platform on Stellar. It implements a **burn-to-claim** model where investors burn their RWA tokens to receive their proportional share of USDC settlement funds when an invoice matures.

## Core Business Logic

### Settlement Deposit Flow
1. When an invoice matures, the originator pays the face value to the admin (off-chain)
2. Admin supplies the settlement amount (minus 1.5% platform fee) to the YieldVault
3. The contract snapshots the current total supply of the RWA token at that moment
4. Settlement USDC is transferred from the platform account to the YieldVault contract
5. Settlement record is created with: total amount, supply snapshot, timestamp

### Yield Claiming Flow
1. Investor (token holder) calls `claim_yield` with the number of tokens they want to burn
2. Contract calculates pro-rata USDC amount: `(tokens_to_burn * total_settlement) / supply_snapshot`
3. Investor's tokens are burned by transferring them to the issuer (Stellar's native burn pattern)
4. USDC is transferred from the contract to the investor
5. Settlement record is updated with cumulative claimed amounts

### Key Mathematical Invariant
- **Proportional Distribution**: If you hold 10% of the tokens, you can claim 10% of the settlement
- **Supply Snapshot**: The ratio is based on supply at settlement time, NOT current supply
- **Example**: 1000 USDC settlement for 100 tokens = 10 USDC per token, regardless of how many tokens remain after others claim

## Public Interface

### Admin Functions
- `init(platform, usdc_asset)` - Initialize contract with platform address and USDC SAC
- `deposit_settlement(platform, asset_code, asset_issuer, settlement_amount)` - Deposit settlement for an asset (platform-only)

### Investor Functions
- `claim_yield(asset_code, asset_issuer, token_amount, claimer)` - Burn tokens to claim USDC

### Query Functions (Read-Only)
- `get_claimable_amount(asset_code, token_amount)` - Preview USDC amount for given tokens
- `get_settlement_info(asset_code)` - Get complete settlement status
- `is_settled(asset_code)` - Check if settlement exists
- `get_user_last_claim(asset_code, user)` - Get user's last claim timestamp
- `get_platform()` - Get platform admin address
- `get_usdc_asset()` - Get USDC SAC address

## Storage Model

### Instance Storage
- `Platform` - Platform admin address (set at init, immutable)
- `UsdcAsset` - USDC Stellar Asset Contract address (set at init, immutable)

### Persistent Storage
- `Settlement(asset_code)` - Settlement record for each asset containing:
  - `total_settlement_usdc` - Total USDC available for distribution
  - `total_supply_snapshot` - Token supply when settlement was deposited
  - `claimed_tokens` - Cumulative tokens burned by all investors
  - `claimed_usdc` - Cumulative USDC claimed by all investors
  - `settled_at` - Unix timestamp of settlement deposit

- `UserLastClaim((asset_code, user))` - Timestamp of user's last claim for analytics

### TTL Strategy
- Settlement records: 30-day threshold, 90-day bump (extended on deposit and every claim)
- User claim records: 15-day threshold, 45-day bump (less critical, for analytics only)

## Dependencies on Other Modules

### Cross-Contract Calls
1. **USDC Stellar Asset Contract (SAC)**
   - `transfer()` - Used to transfer USDC from platform to vault, and from vault to investors

2. **RWA Token Stellar Asset Contract (SAC)**
   - `total_supply()` - Called during deposit to snapshot supply
   - `transfer()` - Used to burn tokens (transfer to issuer)

### Backend Integration
- Platform backend calls `deposit_settlement` after admin confirms payment
- Backend listens for `settlement_deposited` events to update database
- Backend listens for `yield_claimed` events to update investor portfolios

### External Modules (Future)
- Could be called by **AssetRegistry** to verify asset validity before accepting settlement
- Could integrate with **SolvencyVault** for liquidation settlement distribution

## Invariants

### Financial Invariants
1. **Conservation of Value**: Total USDC claimed can never exceed total settlement deposited
2. **Pro-Rata Accuracy**: Each claim must receive exactly `(tokens_burned / supply_snapshot) * total_settlement`
3. **No Double-Deposit**: Cannot deposit settlement twice for the same asset
4. **Supply Snapshot Immutability**: Supply snapshot never changes after settlement deposit

### Operational Invariants
1. **Platform-Only Deposits**: Only the platform address can deposit settlements
2. **Authorization Required**: All claims require `require_auth` from the claimer
3. **Positive Amounts**: All amounts (settlement, token burn, USDC claim) must be positive
4. **Atomic Operations**: All transfers and state updates must succeed or fully revert

## Stellar-Specific Implementation Details

### Native Burn Pattern
Unlike EVM where tokens have a custom `burn()` function, Stellar treats transferring tokens to the issuer as burning:
```rust
// EVM Pattern (NOT used)
token.burn(user, amount);

// Stellar Pattern (USED)
token_client.transfer(&user, &issuer, &amount);
```
This is more gas-efficient and uses Stellar's native asset semantics.

### Numeric Precision
- All amounts are i64 in stroops (7 decimal places)
- Arithmetic uses checked operations to prevent overflow
- Integer division truncates (acceptable for sub-cent rounding)

### TTL Management
- Settlement records are extended on every access to prevent expiry during active claiming
- Backend should monitor TTL health and alert if records approach expiry

## Security Considerations

### No Admin Escape Hatch
- Platform cannot withdraw USDC from vault except through investor claims
- This protects investor funds from admin misuse
- If there's an error, resolution must happen through customer service, not contract modification

### No Pause Mechanism
- Once settlement is deposited, claims can ALWAYS proceed
- No legitimate reason to prevent investors from claiming their yield
- This prevents fund lockup scenarios

### Checked Arithmetic
- All multiplication and division operations use checked variants
- Prevents overflow/underflow vulnerabilities
- Transactions fail safely rather than producing incorrect results

### Atomicity Guarantees
- If token burn fails, USDC transfer doesn't happen (and vice versa)
- If settlement deposit fails, no state is modified
- Soroban's transaction model ensures all-or-nothing execution

## Testing Requirements

### Unit Tests
- [x] Successful settlement deposit
- [x] Cannot deposit settlement twice
- [x] Cannot deposit zero or negative amounts
- [x] Unauthorized user cannot deposit
- [x] Successful yield claim with correct USDC amount
- [x] Cannot claim before settlement deposited
- [x] Cannot overclaim (attempt to drain more than available)
- [x] Multiple sequential claims by different investors
- [x] Partial claims (burn some tokens, keep rest)
- [x] Query functions return accurate data

### Edge Cases
- [ ] Very large settlements (test overflow handling)
- [ ] Very small claims (test minimum thresholds)
- [ ] Concurrent claims (verify atomic updates)
- [ ] Token supply changes after settlement (verify snapshot is used, not current supply)

### Integration Tests
- [ ] Full lifecycle: register asset → issue tokens → deposit settlement → multiple investors claim
- [ ] Cross-contract integration with USDC SAC and RWA token SAC
- [ ] TTL extension verification (settlement remains accessible after near-expiry)

## Migration Notes

### Differences from Mantle YieldVault
1. **Burn Mechanism**: Transfer to issuer instead of `burnFrom()`
2. **Asset Identification**: Uses `(asset_code, asset_issuer)` instead of single token address
3. **Numeric Types**: i64 instead of uint256, requires checked arithmetic
4. **Storage Costs**: TTL management needed for long-term storage
5. **Event System**: Different event emission pattern in Soroban

### Behavioral Parity
- Pro-rata calculation formula is identical
- Settlement model (deposit → claim) is identical
- Supply snapshot timing is identical
- Access control model is identical

## Known Limitations

### Current Version
- Settlement cannot be amended after deposit (intentional for security)
- No batch claim support (claim multiple assets in one transaction)
- No automatic claiming (must be manually triggered)
- No delegation (cannot authorize another address to claim on your behalf)

### Future Enhancements (Not in V1)
- Batch claims for multiple assets
- Streaming claims (gradual distribution over time)
- Claim delegation for institutional custody
- Settlement amendments with multi-sig approval (highly controversial)

## Deployment Information

### Stack
- Part of the **settlement** stack
- Deployed after **issuance** stack (requires AssetRegistry for validation)
- Deploy command: `STACK=settlement npm run deploy:stack`

### Initialization Parameters
- `platform` - Platform admin address (usually deployer account)
- `usdc_asset` - USDC Stellar Asset Contract address (must be valid SAC)

### Post-Deployment Configuration
- Record YieldVault address in `deployed_contracts.json`
- Update backend network config with YieldVault address
- Configure backend adapter to use YieldVault for settlement deposits

## Event Emission

### settlement_deposited
Published when admin deposits a settlement:
- `asset_code` - The asset code
- `settlement_amount` - Total USDC deposited
- `supply_snapshot` - Token supply at settlement time
- `timestamp` - When settlement was deposited

### yield_claimed
Published when investor claims yield:
- `claimer` - Investor address
- `asset_code` - The asset code
- `token_amount` - Tokens burned
- `usdc_amount` - USDC received
