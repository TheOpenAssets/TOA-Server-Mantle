# Stellar YieldVault Implementation Plan

## Context: Why This Is Needed

The YieldVault is the financial settlement engine of the Open Assets platform. When an invoice matures and the debtor pays the face value, this contract holds the settlement funds (in USDC) and enables investors to claim their proportional share by burning their RWA tokens.

**Current State:**
- Mantle has a fully functional YieldVault using EVM/Solidity
- Implements burn-to-claim model (investors burn tokens to get USDC)
- Simple pro-rata distribution: your token share determines your USDC share
- Already deployed and working on Mantle Sepolia

**Problem:**
- No Stellar equivalent exists
- Admin yield settlement operations are blocked on Stellar
- Cannot complete full asset lifecycle on Stellar network
- Backend has network-agnostic code ready but no contract to call

**Business Flow:**
When an invoice with face value of one hundred dollars matures, the originator pays that amount off-system to the admin. The admin then supplies this settlement to the YieldVault (minus the 1.5% platform fee). Investors who hold RWA tokens representing this invoice can then burn their tokens to receive their proportional share of the USDC settlement. If you hold ten percent of the tokens, you can burn them all to receive ten percent of the settlement.

This plan details how to build the Stellar Soroban equivalent while leveraging Stellar's native features for better efficiency and security.

---

## Part 1: Core Design Philosophy

### Leverage Stellar Native Features

The Mantle YieldVault uses EVM patterns that require custom logic. Stellar has native features that make some operations simpler and cheaper:

**Token Burning:**
- Mantle: Contract calls custom burnFrom function on ERC-20 token
- Stellar: Transfer tokens back to the issuer account (this IS burning in Stellar)
- Benefit: No need for separate burn function, uses native transfer operation

**Asset References:**
- Mantle: Uses token contract addresses (Ethereum addresses)
- Stellar: Uses asset codes plus issuer accounts (like "RWA-INV001:GCZOJRJG...")
- Implication: Need both asset code and issuer public key to identify tokens

**Numeric Precision:**
- Mantle: Uses uint256 (effectively unlimited precision)
- Stellar: Uses i128 (128-bit signed integers) with proper overflow handling
- Requirement: Must use checked arithmetic for all calculations

**Storage Model:**
- Mantle: Permanent storage (pay once, store forever)
- Stellar: Time-to-live storage requiring periodic TTL extension
- Strategy: Settlement records should have multi-year TTL, extended when accessed

---

## Part 2: Settlement Data Model

### What Information Must Be Tracked

For each asset that receives a settlement, the vault needs to permanently record:

**Settlement Snapshot Data:**
- Which asset this settlement is for (asset code and issuer)
- How much USDC is available for distribution (total settlement amount in stroops)
- What was the total token supply when settlement was deposited (snapshot of supply)
- When the settlement was deposited (timestamp for audit trail)

**Claiming Progress Data:**
- How many tokens have been burned by all investors (cumulative burned amount)
- How much USDC has been claimed by all investors (cumulative claimed amount)
- These allow verification that math is correct (tokens burned proportional to USDC claimed)

**Why Snapshot the Supply:**
The critical insight from the Mantle implementation is that total supply must be captured at the MOMENT the settlement is deposited. This is because:
- After settlement, investors will burn tokens to claim
- Total supply will decrease as claims happen
- But the settlement distribution ratio is based on the ORIGINAL supply
- Example: If settlement is one thousand USDC for one hundred tokens, each token is worth ten USDC regardless of how many remain after others claim

**Storage Strategy:**
Settlement records should use persistent storage with a configurable (currently set to a month) TTL since:
- Invoices can mature over weeks currently we ar ein testing phase so this one ois fine
- Investors may delay claiming
- Extension happens automatically when records are accessed during claims

---

## Part 3: The Settlement Deposit Operation

### Who Calls This and When

Only the platform administrator account can deposit settlements. This happens after:
- Invoice has matured and debtor paid
- Admin recorded settlement in backend database
- Admin confirmed USDC conversion
- Backend calls the adapter's depositYieldToVault method
- Adapter invokes this Soroban contract function

### What Happens Step by Step

**Authorization Check:**
The contract must verify the caller is the authorized platform account. This uses Soroban's require_auth mechanism which validates the transaction was signed by the platform's private key. If not signed by platform, the entire transaction fails immediately.

**Retrieve Current Token Supply:**
Before recording anything, the contract must query the Stellar Asset Contract for the current total supply. This is done via cross-contract call to the SAC's total_supply function. The returned value is the snapshot supply that will be used for all future yield calculations.

**Transfer USDC to Vault:**
The settlement USDC must move from the platform custody account into the YieldVault contract's account. This uses Soroban's token transfer host function which internally calls the USDC SAC's transfer method. The platform must have previously approved this amount or the transfer will fail.

**Record Settlement:**
Store all settlement data in persistent storage keyed by the asset code. This creates the permanent record that investors will reference when claiming. The record includes:
- Asset identifier (code and issuer)
- Total settlement amount (in USDC stroops with seven decimals)
- Supply snapshot (in token units with seven decimals for RWA tokens)
- Settlement timestamp (Unix seconds from Stellar ledger)
- Initialization of claim tracking (zero tokens burned, zero USDC claimed)

**TTL Extension:**
Extend the time-to-live for this storage entry to three years (approximately ninety-four million seconds). This ensures the settlement record remains accessible even if no claims happen immediately.

**Event Emission:**
Publish a contract event logging the settlement deposit. This event should include the asset code, settlement amount, supply snapshot, and timestamp. The backend event listener will pick this up to update database records and trigger investor notifications.

### Edge Cases and Validations

**Cannot Deposit Twice:**
If a settlement already exists for an asset, attempting to deposit again must fail. This prevents accidental double-deposits which would corrupt the claim mathematics.

**Supply Cannot Be Zero:**
If the total supply query returns zero, something is wrong (tokens were somehow all burned before settlement). This indicates a critical error and deposit must fail.

**Settlement Must Be Positive:**
Cannot deposit zero or negative USDC. This validation catches misconfiguration or bugs in the calling code.

**Asset Must Exist:**
While not strictly required for storage, it's good practice to verify the asset exists by checking the AssetRegistry contract before accepting a settlement.

---

## Part 4: The Claim Operation

### Who Calls This and When

Any investor holding RWA tokens can call claim yield at any time after settlement is deposited. They specify:
- Which asset they're claiming for (asset code and issuer)
- How many tokens they want to burn
- Their account address (automatically from transaction signer)

### The Pro-Rata Calculation

This is the heart of the system and must be mathematically precise:

**Formula:**
Take the number of tokens being burned, multiply by total settlement amount, then divide by the supply snapshot. This gives the proportional USDC amount.

**Example:**
Settlement has one thousand USDC for one hundred tokens (supply snapshot). Investor burns ten tokens. Calculation: ten multiplied by one thousand divided by one hundred equals one hundred USDC claimed.

**Overflow Prevention:**
Must use checked multiplication to prevent overflow since token amounts multiplied by USDC amounts can exceed sixty-four bits. Soroban's i128 type handles this but arithmetic operations must explicitly check for overflow.

**Division Precision:**
Integer division truncates remainder. This means very small claims might lose fractions of a cent. This is acceptable since USDC has six decimals (stroops have seven in our system) and sub-cent amounts are not meaningful.

### What Happens Step by Step

**Authorization:**
Verify the transaction is signed by the claimer's account using require_auth. This proves the claimer actually controls the tokens being burned.

**Load Settlement Record:**
Fetch the settlement data from storage using the asset code as key. If no settlement exists, fail with descriptive error message.

**Calculate USDC Amount:**
Execute the pro-rata formula with checked arithmetic. If overflow occurs, fail transaction. If result is zero (claim too small), fail with minimum claim error.

**Verify Sufficient Funds:**
Check that the USDC amount doesn't exceed what's remaining in the vault. Calculate remaining as total settlement minus cumulative claimed. If insufficient, fail with vault depleted error.

**Burn Investor Tokens:**
Transfer the specified token amount from the investor to the issuer account. In Stellar, transferring to issuer is equivalent to burning - the tokens leave circulation permanently. This uses the token SAC's transfer function.

**Transfer USDC to Investor:**
Send the calculated USDC amount from the vault contract to the investor's account. This also uses the USDC SAC's transfer function. If this fails (insufficient balance, destination issues), entire transaction rolls back.

**Update Claim Tracking:**
Increment the cumulative tokens burned and cumulative USDC claimed in the settlement record. This maintains accounting consistency and enables auditing.

**Update User Last Claim:**
Record the timestamp of this claim in a separate user-specific storage entry. This helps backend track investor activity and can be used for analytics.

**Event Emission:**
Publish a claim event including investor address, asset code, tokens burned, USDC received, and timestamp. Backend uses this to update portfolio balances and send confirmation notifications.

### Edge Cases and Validations

**Cannot Claim Before Settlement:**
If trying to claim for an asset with no settlement record, fail with settlement not deposited error.

**Cannot Burn Zero Tokens:**
Burning zero tokens is meaningless and should fail validation immediately.

**Cannot Overclaim:**
The USDC calculation might theoretically exceed remaining funds due to rounding if multiple claims happen concurrently. The remaining funds check prevents this by rejecting any claim that would drain more than available.

**Partial Claims Allowed:**
Investors don't need to burn all their tokens at once. They can claim in portions as they need liquidity. The math works for any portion.

**Must Have Token Balance:**
If investor tries to burn more tokens than they hold, the burn transfer will fail automatically since SAC enforces balance checks.

---

## Part 5: Query Functions

### Get Claimable Amount

**Purpose:**
Allow anyone to preview how much USDC they would receive for burning a specific number of tokens WITHOUT executing the claim.

**Inputs:**
Asset code, asset issuer, and hypothetical token amount to burn.

**Logic:**
Load settlement record and apply the pro-rata formula. Return the USDC amount that would be received. This is a read-only operation with no state changes.

**Use Case:**
Frontend shows "You will receive X USDC if you burn Y tokens" before user confirms transaction.

### Get Settlement Information

**Purpose:**
Retrieve complete settlement status for an asset including all accounting data.

**Outputs:**
- Total settlement deposited
- Supply snapshot at settlement time
- Cumulative tokens burned so far
- Cumulative USDC claimed so far
- Remaining USDC available
- Yield per token (settlement divided by supply for display)

**Use Case:**
Admin dashboard showing settlement status, investor portfolio showing available claims, analytics tracking platform activity.

### Check If Settled

**Purpose:**
Simple boolean check if a settlement exists for an asset.

**Logic:**
Attempt to load settlement record, return true if exists, false otherwise.

**Use Case:**
Backend validation before allowing certain operations, frontend conditional rendering.

---

## Part 6: Access Control Model

### Platform Account Authority

The platform account is set during contract initialization and cannot change. This account has permission to:
- Deposit settlements for any asset
- This is the only privileged operation

All other operations (claiming, querying) are permissionless and can be called by anyone.

### Why No Multi-Admin

Unlike some other contracts, YieldVault doesn't need multiple admin roles because:
- Only one operation is privileged (deposit settlement)
- That operation should only happen after careful backend validation
- Platform account is multi-sig at the Stellar account level if needed
- Simpler is better for financial contracts

### Emergency Considerations

**No Pause Mechanism:**
Once settlement is deposited, claims should ALWAYS be allowed. There's no legitimate reason to prevent investors from claiming their yield. Adding pause functionality creates risk of fund lockup.

**No Withdrawal Function:**
Platform cannot withdraw USDC from vault except through investor claims. There's no "admin escape hatch" to drain funds. This protects investors.

**No Settlement Modification:**
Once deposited, settlement amount and supply snapshot are immutable. Cannot be updated, corrected, or adjusted. If there was an error, must resolve through customer service and manual compensation, not contract modification.

---

## Part 7: Integration with Other Contracts

### Cross-Contract Dependencies

**USDC Stellar Asset Contract:**
YieldVault must know the contract address (or asset identifier) for USDC on Stellar. This is configured at initialization. All USDC operations use Soroban's token interface host functions pointing to this address.

**RWA Token Stellar Asset Contracts:**
Each asset being settled has its own SAC. The vault doesn't need to know these addresses upfront - they're provided per-operation. Vault treats all assets uniformly using the same token interface.

**AssetRegistry (Optional):**
Could optionally verify asset existence before accepting settlement by calling AssetRegistry's get_asset_metadata function. This adds safety but also adds cross-contract call cost.

### Call Depth Considerations

**Deposit Settlement Flow:**
Platform calls vault → vault calls USDC SAC transfer → vault calls RWA SAC total_supply. This is three levels deep. Within Soroban's call depth limit.

**Claim Yield Flow:**
Investor calls vault → vault calls RWA SAC transfer (burn) → vault calls USDC SAC transfer. Also three levels. No issues.

**No Recursive Concerns:**
YieldVault never calls back to itself. No reentrancy risk.

---

## Part 8: Storage Architecture

### Storage Type Selection

**Persistent Storage:**
Settlement records, user claim history, and configuration use persistent storage because:
- Must survive beyond temporary TTL
- Critical financial data requiring durability
- Accessed infrequently but must always be available

**Temporary Storage Not Used:**
Nothing in YieldVault is temporary. All state is permanent accounting data.

**Instance Storage:**
Contract configuration (platform account, USDC address) uses instance storage since it's initialized once and accessed frequently.

### Key Structures

**Settlement Key:**
Use asset code string as primary key. Simple and human-readable. Example: "RWA-INV001" maps to settlement record.

**User Claim Key:**
Use tuple of (asset code, user address) to track per-user last claim time. Example: ("RWA-INV001", "GCZOJRJG...") maps to timestamp.

**Iteration Not Required:**
Contract never needs to iterate all settlements or all users. Each operation knows exactly which key to load. This keeps gas costs predictable and low.

### TTL Management Strategy

**Settlement Records:**
Three-year default TTL. Extended on deposit and every claim. Rationale: invoices can be long-term and investors may claim slowly.

**User Claim Records:**
One-year default TTL. Extended on each claim. Rationale: less critical than settlement data, used mainly for analytics.

**Auto-Extension Pattern:**
Every time a storage entry is accessed for write, explicitly extend its TTL. This ensures frequently-used records never expire while inactive records eventually drop off.

---

## Part 9: Error Handling Strategy

### Descriptive Error Types

Define Rust enum for all error cases:
- Unauthorized (not platform account for deposit)
- Settlement already exists (double deposit attempt)
- Settlement not found (claim before deposit)
- Insufficient vault balance (trying to claim more than available)
- Invalid amount (zero or negative token burn)
- Supply is zero (snapshot found zero tokens)
- Overflow in calculation (multiplication overflow)
- Transfer failed (USDC or token transfer error)

### Error Messages

Each error should have clear message explaining what went wrong and potentially how to fix. This helps both developers debugging and customer support helping users.

Example: "Settlement not found for asset RWA-INV001. Ensure settlement has been deposited by admin before attempting to claim."

### Failure Atomicity

All operations are atomic. If any step fails, entire transaction rolls back. This prevents:
- USDC transferred but tokens not burned
- Tokens burned but USDC not received
- Settlement record created but USDC not deposited
- Partial claim updates leaving inconsistent state

---

## Part 10: Testing Strategy

### Unit Test Coverage

**Settlement Deposit Tests:**
- Happy path: deposit succeeds and records correct data
- Duplicate deposit: second deposit for same asset fails
- Zero amount: cannot deposit zero USDC
- Zero supply: fails if token supply is zero
- Unauthorized: non-platform account cannot deposit
- USDC transfer failure: rolls back if transfer fails

**Claim Yield Tests:**
- Happy path: correct USDC amount calculated and transferred
- Before settlement: fails if no settlement exists
- Overclaim: fails if trying to claim more than remaining
- Zero tokens: cannot burn zero tokens
- Insufficient balance: fails if user doesn't have tokens
- Rounding: verify small amounts round correctly
- Multiple claims: sequential claims by different users work correctly
- Partial claims: can claim in portions without issues

**Query Function Tests:**
- Get claimable: returns correct preview amount
- Get settlement info: returns accurate accounting data
- Non-existent asset: returns appropriate empty/error response

**Edge Case Tests:**
- Very large settlements (test overflow handling)
- Very small claims (test minimum thresholds)
- Concurrent claims (verify atomic updates)
- Token supply changes (verify snapshot is used not current supply)

### Integration Test Scenarios

**Full Lifecycle Test:**
Create asset → Issue tokens → Deposit settlement → Multiple investors claim → Verify all USDC distributed correctly → Verify all tokens burned

**Cross-Contract Test:**
Deploy YieldVault + mock USDC SAC + mock RWA SAC → Execute deposit and claim → Verify cross-contract calls work correctly

**TTL Extension Test:**
Deposit settlement → Wait near TTL expiry → Claim yield → Verify TTL was extended → Verify settlement remains accessible

---

## Part 11: Migration from Mantle

### What Translates Directly

**Core Mathematics:**
The pro-rata formula is identical. Token proportion equals USDC proportion. This is network-agnostic math.

**Settlement Model:**
Burn-to-claim paradigm works same way. Investors burn tokens to get USDC. The business logic is unchanged.

**Accounting Structure:**
Track total settlement, supply snapshot, cumulative burned, cumulative claimed. Same fields, same purpose.

### What Must Change

**Token References:**
Mantle uses contract addresses (bytes20). Stellar uses asset codes (strings) plus issuer addresses. All interfaces must accept both pieces of information.

**Burn Mechanism:**
Mantle calls IBurnableToken.burnFrom. Stellar transfers to issuer. Implementation differs but outcome identical.

**Numeric Types:**
Mantle uses uint256 everywhere. Stellar uses i64 for amounts (representing stroop values) and must use i128 for intermediate calculations. All arithmetic needs overflow checks.

**Storage Costs:**
Mantle storage is one-time cost. Stellar storage requires ongoing TTL maintenance. Code must explicitly extend TTL.

### Verification Approach

**Compare Test Outputs:**
Run same test scenarios on both contracts. For given inputs (settlement amount, supply, burn amount), outputs should be identical within rounding differences.

**Parallel Backend:**
Backend can temporarily support both contracts during transition. Send test settlements to both and verify behaviors match.

---

## Part 12: Deployment Process

### Pre-Deployment Checklist

**Contract Compilation:**
Compile Soroban contract to WASM bytecode. Verify compilation succeeds with no warnings. Optimize for size since deployment cost scales with bytes.

**Security Audit:**
Independent review of contract code focusing on arithmetic overflow, access control, and atomicity. YieldVault handles investor funds so security is critical.

**Testnet Validation:**
Deploy to Stellar Testnet first. Execute comprehensive test suite. Verify all operations work correctly. Run stress tests with many settlements and claims.

### Deployment Steps

**Deploy to Testnet:**
Upload WASM to Stellar Testnet. Initialize with platform account and USDC SAC address. Record deployed contract ID.

**Backend Integration:**
Update network config with Testnet YieldVault address. Modify Stellar blockchain adapter to use new contract. Test backend can successfully call deposit settlement.

**End-to-End Testing:**
Create test asset. Deploy test tokens. Complete full yield cycle from deposit to claim. Verify events are received and database updates correctly.

**Mainnet Deployment:**
After Testnet validation, repeat deployment to Mainnet. Use same process but with Mainnet addresses for platform account and USDC.

**Configuration Update:**
Update production backend config with Mainnet YieldVault address. Deploy backend changes. Monitor first real settlement carefully.

### Post-Deployment Monitoring

**Event Monitoring:**
Ensure backend event listener captures all settlement deposits and yield claims. Verify notifications send correctly.

**Accounting Verification:**
After first few settlements, manually verify accounting matches expectations. Check cumulative claimed equals sum of individual claims.

**TTL Health:**
Monitor TTL remaining on settlement records. Verify auto-extension is working. Alert if any records approach expiry.

---

## Part 13: Backend Adapter Implementation

### Stellar Blockchain Adapter Changes

**depositYieldToVault Method:**
The adapter must construct a Soroban contract invocation transaction for the deposit_settlement function. This requires:
- Getting platform keypair from wallet adapter
- Getting YieldVault contract address from config
- Building transaction with contract call operation
- Passing asset code, asset issuer address, and settlement amount as parameters
- Simulating transaction to get resource costs
- Assembling transaction with simulation results
- Signing with platform keypair
- Submitting to Soroban RPC
- Polling for transaction confirmation
- Extracting transaction hash from result

**transferUSDC Method:**
Similar pattern but simpler - just invoke USDC SAC transfer function. Parameters are recipient address and amount. No cross-contract complexity.

**Error Handling:**
Wrap all Soroban RPC errors into adapter-specific error types. Translate Stellar error codes into human-readable messages. Distinguish between user errors (insufficient balance) and system errors (RPC timeout).

### Network Registry Integration

**depositYieldToVault Orchestration:**
Registry checks if yield feature is available on current network. If available, resolves blockchain adapter and delegates call. If unavailable, returns skipped result. Logs all operations for debugging.

**Feature Flag Check:**
Before calling adapter, verify network config has yield set to true. This prevents attempting operations on networks without deployed YieldVault.

---

## Part 14: Frontend Considerations

### Claiming User Interface

**Preview Before Burn:**
Before user confirms claim, frontend calls get_claimable_amount to show exactly how much USDC they'll receive. Prevents surprises.

**Partial Claim Option:**
Allow user to specify how many tokens to burn rather than forcing all-or-nothing. Slider interface showing USDC amount updates as token amount changes.

**Transaction Confirmation:**
Show clear confirmation modal: "You will burn X tokens and receive Y USDC. This cannot be reversed." User must acknowledge burning is permanent.

**Transaction Status:**
While transaction is pending (Stellar confirmation takes about five seconds), show spinner with status. Once confirmed, show success message with transaction hash link to explorer.

### Portfolio Display

**Claimable Yield Section:**
For each asset user holds, query settlement status and calculate their claimable amount. Display as "You can claim X USDC by burning your Y tokens."

**Settlement Status:**
Show if settlement has been deposited. If deposited, show total settlement amount, supply snapshot, how much has been claimed so far, and how much remains. This builds trust.

**Claim History:**
List user's past claims showing date, asset, tokens burned, USDC received, and transaction link. Helps users track their returns.

---

## Part 15: Success Criteria

### Functional Requirements

**Must Work:**
- Platform can deposit settlements for any asset
- Investors can claim yield by burning tokens
- USDC amounts calculated exactly match expected pro-rata share
- Query functions return accurate information
- All operations are atomic (no partial failures)
- Events publish correctly for backend monitoring

**Must Not Break:**
- Cannot deposit settlement twice for same asset
- Cannot claim before settlement deposited
- Cannot overclaim (drain more than available)
- Cannot bypass access control
- Cannot lose funds through calculation errors
- Cannot corrupt storage through concurrent operations

### Performance Requirements

**Transaction Costs:**
Deposit settlement should cost less than ten million stroops (roughly point zero one XLM at current prices). Claim yield should cost less than five million stroops.

**Confirmation Time:**
Both operations should confirm within ten seconds on testnet. Within five seconds on mainnet (once Stellar finality improves).

**Storage Efficiency:**
Settlement record should consume less than one kilobyte. Support at least one thousand settlements before hitting storage limits.

### Security Requirements

**No Vulnerability:**
Pass independent security audit with no critical findings. No arithmetic overflow possible. No reentrancy issues. No unauthorized access.

**Fund Safety:**
Every USDC deposited can be claimed by rightful token holders. No admin escape hatch. No way to drain funds except through legitimate claims.

---

## Part 16: Future Enhancements

### Not In Initial Version But Worth Considering

**Batch Claims:**
Allow user to claim yield for multiple assets in single transaction. Reduces transaction costs if holding several assets.

**Automatic Claiming:**
Contract-level subscription where claims execute automatically when settlement is deposited. Complex but great UX.

**Streaming Claims:**
Instead of lump sum, allow claiming yield gradually over time. Useful for tax optimization.

**Delegation:**
Allow token holders to delegate claim authority to another address. Useful for institutional custody.

**Emergency Withdrawal:**
After extremely long time (like five years with zero activity), allow platform to withdraw unclaimed funds. Prevents permanent lockup of abandoned funds. Highly controversial so not in v1.

**Settlement Amendments:**
Allow platform to adjust settlement amount if discovered error after deposit. Would require careful safeguards to prevent abuse. Not worth complexity for v1.

---

## Summary

The Stellar YieldVault is a direct translation of the Mantle implementation with careful attention to Stellar-specific patterns:
- Use native asset transfers instead of custom burn functions
- Use asset codes plus issuers instead of contract addresses
- Use checked arithmetic with i128 for safety
- Implement TTL management for long-term storage
- Leverage Soroban's token interface for USDC and RWA operations

The contract is simple by design - only two privileged operations (deposit) and one public operation (claim). No complex state machines, no multi-step workflows, no administrative complexities. This simplicity is a security feature.

Once deployed, this unblocks the complete asset lifecycle on Stellar and enables the backend's network-agnostic yield settlement to function on both chains.
