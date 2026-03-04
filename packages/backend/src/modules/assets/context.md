# Assets Module Context

## Responsibilities
This module manages the complete lifecycle of Real-World Assets (RWAs) on the Open Assets platform, from origination through payout settlement.

## Core Components

### `AssetLifecycleService`
- **Core Asset Operations**:
  - Asset creation and origination
  - On-chain registration and token deployment
  - Marketplace listing (static and auction)
  - Purchase and bid placement verification
  - Auction settlement
  - **Originator Payout** (Network-Agnostic)

### Payout System (Network-Agnostic)
The payout system transfers raised USDC from the platform to originators after marketplace completion.

#### Flow:
1. **Calculate Total USDC Raised** (Database):
   - Query all confirmed PRIMARY_MARKET purchases (excludes P2P trades)
   - Include leverage positions holding the asset (USDC borrowed)
   - Total = purchase payments + leverage borrowed amounts

2. **Execute USDC Transfer** (Adapter-Based):
   - Uses `PaymentAdapter` for network-agnostic transfers
   - EVM: ethers.js with ERC-20 USDC contract
   - Stellar: Soroban token contract invocation
   - Validates sufficient platform balance before transfer

3. **Record Payout** (Database):
   - Creates `Payout` document with transaction details
   - Links to all contributing purchases and leverage positions
   - Stores transaction hash (network-specific format)

4. **Burn Unsold Tokens** (Adapter-Based):
   - Uses `BlockchainAdapter.burnUnsoldTokens()`
   - Queries custody wallet balance
   - Burns remaining unsold tokens
   - EVM: RWAToken.burn() or burnFrom()
   - Stellar: Soroban token contract burn()
   - 3-retry mechanism with exponential backoff (5s, 10s, 20s)
   - Updates asset's token supply in database

5. **Update Asset Status** (Database):
   - Sets status to `PAYOUT_COMPLETE`
   - Updates `listing.amountRaised`

6. **Send Notifications**:
   - Originator: Payout confirmation with amount and transaction hash
   - Admins: Token burn summary (if any unsold tokens)
   - Success case: All tokens sold notification

#### API Endpoint:
- `POST /assets/:assetId/payout` (Admin-only)
- Returns: Transaction hash, block number, amounts, payout ID

#### Dependencies:
- **PaymentAdapter** (Injected): Handles USDC transfers
- **BlockchainAdapter** (Injected): Handles token burning
- **NotificationService**: User notifications
- **Models**: Asset, Purchase, Payout, LeveragePosition

#### Error Handling:
- Insufficient balance: Throws before attempting transfer
- Transaction failure: Includes transaction hash in error
- Burn failure: Retries 3 times, then marks failed in notifications
- Notification failure: Logs but doesn't fail payout

#### Configuration Required:
**EVM/Mantle**:
- `PLATFORM_PRIVATE_KEY`: Platform wallet private key
- `blockchain.rpcUrl`: EVM RPC endpoint
- `blockchain.custodyAddress`: Custody wallet address
- `deployed_contracts.json`: USDC contract address

**Stellar**:
- `STELLAR_PLATFORM_SECRET`: Platform wallet secret key
- `network.stellar.rpcUrl`: Soroban RPC endpoint
- `network.stellar.contracts.usdcContract`: **Optional** (auto-derives Circle's USDC SAC if not set)
- Uses Circle's official USDC on testnet (auto-converted to Stellar Asset Contract)
- Custody wallet = Platform wallet (typical pattern)

### Network Compatibility
- **Mantle**: Fully implemented and tested
- **Stellar**: Fully implemented (adapter-based)
- All database operations are network-agnostic
- Transaction hashes and block numbers store in network-specific formats

## Network Scoping (Multi-Network)
All read and write operations in `AssetLifecycleService` that touch asset documents are scoped to the current request's network via `NetworkContextService.getNetwork()` (backed by `AsyncLocalStorage`). The following methods include `network` as a mandatory filter condition:
- `createAsset()` — stamps the asset document with `network` from context
- `getAsset()` — queries `{ assetId, network }`
- `getAssetsByOriginator()` — queries `{ originator, network }`
- `getAllAssets()` — queries include `{ network }` alongside optional status/originator filters
- `approveAsset()` — both the `findOne` and the `updateOne` use `{ assetId, network }`

**Note on decimal precision:** Several methods in this service apply decimal precision conditionally based on `asset.network === 'stellar'` to choose between 7 (Stellar) and 6 or 18 (EVM) decimal places. This assumes all non-Stellar networks use the same decimal conventions as Mantle (6 for USDC, 18 for ERC-20). This assumption is currently correct for Mantle, Arbitrum, and CreditCoin. If a future chain uses different precision, this logic must be extended.

## Invariants
- Payout can only be executed once per asset (status check)
- Only confirmed PRIMARY_MARKET purchases count toward payout
- Leverage positions must reference the exact asset token address
- Token burning is optional (skips if all tokens sold)
- Notification failures never block payout completion
- All asset queries are network-scoped; documents without a `network` field (pre-migration) will not appear in query results
