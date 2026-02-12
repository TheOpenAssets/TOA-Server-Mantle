

# Type Inventory — Chain-Agnostic vs EVM/Mantle-Specific

**Purpose:** Map every type, enum, and DTO in the codebase into two buckets to guide extraction into a shared `packages/types/` repository.

**Key finding:** `packages/types/` is scaffolded but empty. All types currently live scattered across 28 MongoDB schemas and 37+ DTOs in the backend. Every schema conflates three concerns: domain interface, network-specific fields, and Mongoose document wrapper.

---

## Bucket 1 — EVM/Mantle-Specific Types

These cannot be shared as-is. They either use viem primitives directly or carry EVM-specific semantics (0x addresses, wei amounts, tx hashes, ECDSA signatures).

---

### Viem Primitive Types

Used directly across 18 service files. These are the root of the EVM coupling.

| Type | Origin | Used In |
|------|--------|---------|
| `Address` | viem | 12 service files |
| `Hash` | viem | 7 service files |
| `Hex` | viem | 3 service files |
| `PublicClient` | viem | 4 service files |
| `WalletClient` | viem | 1 service file |
| `Log` | viem | 2 service files |

---

### EVM-Specific Enums

| Enum | File | Reason |
|------|------|--------|
| `BidStatus` | `packages/backend/src/database/schemas/bid.schema.ts` | Tracks on-chain Dutch auction state machine |
| `PositionStatus` (Leverage) | `packages/backend/src/database/schemas/leverage-position.schema.ts` | mETH DeFi vault position states |
| `PositionStatus` (Solvency) | `packages/backend/src/database/schemas/solvency-position.schema.ts` | Solvency vault position states |
| `PositionHealth` | `packages/backend/src/database/schemas/leverage-position.schema.ts` | Health factor tracking (basis points, EVM convention) |

---

### EVM-Specific DTOs

| DTO | File | Why EVM-Specific |
|-----|------|-----------------|
| `LoginDto` | `packages/backend/src/modules/auth/dto/auth.dto.ts` | ECDSA `signature` field |
| `ChallengeDto` | `packages/backend/src/modules/auth/dto/auth.dto.ts` | `walletAddress` in 0x format |
| `NotifyBidDto` | `packages/backend/src/modules/marketplace/dto/notify-bid.dto.ts` | `txHash` + wei amounts |
| `NotifyPurchaseDto` | `packages/backend/src/modules/marketplace/dto/notify-purchase.dto.ts` | `txHash` + wei |
| `CreateOrderDto` | `packages/backend/src/modules/secondary-market/dto/create-order.dto.ts` | `tokenAddress`, wei amounts |
| `RegisterAssetDto` | `packages/backend/src/modules/blockchain/dto/register-asset.dto.ts` | Hex `payload` + `signature` |
| `DeployTokenDto` | `packages/backend/src/modules/blockchain/dto/deploy-token.dto.ts` | `issuer` address (0x) |
| `InitiateLeveragePurchaseDto` | `packages/backend/src/modules/leverage/dto/leverage.dto.ts` | `tokenAddress` + mETH collateral |
| `GetSwapQuoteDto` | `packages/backend/src/modules/leverage/dto/leverage.dto.ts` | mETH amounts (FluxionDEX) |
| `ClaimYieldFromBurnDto` | `packages/backend/src/modules/leverage/dto/leverage.dto.ts` | wei (18 decimals) |
| `ProcessSettlementDto` | `packages/backend/src/modules/leverage/dto/leverage.dto.ts` | USDC wei (6 decimals) |
| `PartnerBorrowDto` | `packages/backend/src/modules/partners/dto/partner-loan.dto.ts` | `@IsEthereumAddress()` validator |
| `PartnerRepayWithTransferDto` | `packages/backend/src/modules/partners/dto/partner-loan.dto.ts` | `txHash` regex `^0x[a-fA-F0-9]{64}$` |
| `RequestUsdcDto` | `packages/backend/src/modules/faucet/dto/request-usdc.dto.ts` | Mantle testnet faucet |
| `RequestMethDto` | `packages/backend/src/modules/faucet/dto/request-meth.dto.ts` | mETH — Mantle-only token |

---

### EVM-Specific Schema Fields

These schemas are partially domain-agnostic in concept but carry EVM-coupled fields. They need to be split.

| Schema | EVM-Specific Fields |
|--------|---------------------|
| `User` | `walletAddress` (0x format), Aadhaar KYC fields |
| `Asset` | `contractAddress`, `txHash`, `merkleRoot`, `merkleProof`, `zkProof`, attestation fields, EigenDA fields |
| `Purchase` | `txHash`, `tokenAddress`, wei amounts |
| `Bid` | `txHash`, `walletAddress`, wei amounts |
| `P2POrder` | `tokenAddress` |
| `YieldClaim` | `txHash`, wei amounts |
| `LeveragePosition` | mETH collateral (wei), USDC borrowed (wei), `txHash`, health factor in basis points |
| `SolvencyPosition` | `tokenAddress`, USDC wei, liquidation `txHash` |
| `PrivateAsset` | `tokenAddress`, `deploymentTxHash` |
| `Payout` | `transactionHash`, wei amounts |
| `Partner` | settlement `walletAddress` |

---

### EVM-Only Config / Services

| File | Reason |
|------|--------|
| `packages/backend/src/config/mantle-chain.ts` | Hardcoded `mantleSepolia` via viem `defineChain()` |
| `packages/backend/src/modules/leverage/` (entire module) | mETH collateral, FluxionDEX, HarvestKeeper — all Mantle-specific |
| `packages/backend/src/modules/faucet/` (entire module) | Mantle Sepolia testnet faucet |
| `packages/backend/src/modules/blockchain/services/blockchain.service.ts` | Core EVM service (viem wallet/public clients) |
| `packages/backend/src/modules/blockchain/services/wallet.service.ts` | EVM wallet client creation |
| `packages/backend/src/modules/blockchain/services/event-listener.service.ts` | EVM block polling via `getLogs` |
| `packages/backend/src/modules/blockchain/services/contract-loader.service.ts` | Solidity ABI loading |
| `packages/backend/src/modules/auth/services/signature.service.ts` | `verifyMessage` from viem |
| `packages/backend/src/modules/compliance-engine/services/attestation.service.ts` | `keccak256`, `toHex` from viem |
| `packages/backend/src/modules/assets/processors/asset.processor.ts` | `keccak256`, `toHex` from viem |

---

## Bucket 2 — Chain-Agnostic Types

These carry no viem imports and describe pure business domain concepts. Safe to extract into `packages/types/` or a shared repo.

---

### Pure Domain Enums (20 total)

#### Identity & Access
| Enum | File |
|------|------|
| `UserRole` | `packages/backend/src/database/schemas/user.schema.ts` |

#### Asset Lifecycle
| Enum | File |
|------|------|
| `AssetStatus` | `packages/backend/src/database/schemas/asset.schema.ts` |
| `AssetType` | `packages/backend/src/modules/assets/dto/create-asset.dto.ts` |
| `TokenType` | `packages/backend/src/database/schemas/solvency-position.schema.ts` |
| `PrivateAssetType` | `packages/backend/src/database/schemas/private-asset.schema.ts` |
| `PrivateAssetRequestStatus` | `packages/backend/src/database/schemas/private-asset-request.schema.ts` |

#### Marketplace & Trading
| Enum | File |
|------|------|
| `OrderStatus` | `packages/backend/src/database/schemas/p2p-order.schema.ts` |
| `ListingType` | `packages/backend/src/modules/blockchain/dto/list-on-marketplace.dto.ts` |

#### Financial & Risk
| Enum | File |
|------|------|
| `SettlementStatus` | `packages/backend/src/database/schemas/settlement.schema.ts` |
| `HealthStatus` | `packages/backend/src/database/schemas/solvency-position.schema.ts` |
| `PartnerLoanStatus` | `packages/backend/src/database/schemas/partner-loan.schema.ts` |
| `RepaymentSource` | `packages/backend/src/database/schemas/partner-loan.schema.ts` |

#### Partners
| Enum | File |
|------|------|
| `PartnerStatus` | `packages/backend/src/database/schemas/partner.schema.ts` |
| `PartnerTier` | `packages/backend/src/database/schemas/partner.schema.ts` |

#### Notifications & Announcements
| Enum | File |
|------|------|
| `NotificationType` | `packages/backend/src/modules/notifications/enums/notification-type.enum.ts` |
| `NotificationSeverity` | `packages/backend/src/modules/notifications/enums/notification-type.enum.ts` |
| `NotificationAction` | `packages/backend/src/modules/notifications/enums/notification-action.enum.ts` |
| `AnnouncementType` | `packages/backend/src/database/schemas/announcement.schema.ts` |
| `AnnouncementStatus` | `packages/backend/src/database/schemas/announcement.schema.ts` |

#### Compliance & Workflow
| Enum | File |
|------|------|
| `ComplianceRequestStatus` | `packages/backend/src/database/schemas/compliance-request.schema.ts` |

---

### Chain-Agnostic DTOs

| DTO | File | Notes |
|-----|------|-------|
| `CreateAssetDto` | `packages/backend/src/modules/assets/dto/create-asset.dto.ts` | Pure metadata — invoice, face value, dates, risk tier |
| `RefreshDto` | `packages/backend/src/modules/auth/dto/auth.dto.ts` | Just a refresh token string |
| `ListOnMarketplaceDto` | `packages/backend/src/modules/blockchain/dto/list-on-marketplace.dto.ts` | `assetId` + optional `duration` |
| `RecordSettlementDto` | `packages/backend/src/modules/yield/dto/yield-ops.dto.ts` | Settlement amount + asset ref |
| `ConfirmUSDCDto` | `packages/backend/src/modules/yield/dto/yield-ops.dto.ts` | Confirms off-chain conversion |
| `DistributeDto` | `packages/backend/src/modules/yield/dto/yield-ops.dto.ts` | Trigger distribution |
| `BorrowDto` | `packages/backend/src/modules/solvency/dto/borrow.dto.ts` | positionId, amount, duration, installments |
| `UnwindPositionDto` | `packages/backend/src/modules/leverage/dto/leverage.dto.ts` | Just a positionId |
| `CreateNotificationDto` | `packages/backend/src/modules/notifications/dto/create-notification.dto.ts` | userId, header, detail, type, severity |
| `CommitQueryDto` | `packages/backend/src/modules/changelog/dto/changelog-query.dto.ts` | GitHub changelog queries |
| `PullRequestQueryDto` | `packages/backend/src/modules/changelog/dto/changelog-query.dto.ts` | GitHub PR queries |
| `TimelineQueryDto` | `packages/backend/src/modules/changelog/dto/changelog-query.dto.ts` | Timeline queries |
| `MetricsQueryDto` | `packages/backend/src/modules/changelog/dto/changelog-query.dto.ts` | Metrics queries |
| `TypeformWebhookDto` | `packages/backend/src/modules/typeform/dto/typeform-webhook.dto.ts` | Third-party webhook format |
| `UploadPrivateAssetRequestDto` | `packages/backend/src/modules/solvency/dto/upload-private-asset-request.dto.ts` | Asset request submission |
| `PartnerBorrowDto` (partial) | `packages/backend/src/modules/partners/dto/partner-loan.dto.ts` | Needs `@IsEthereumAddress()` stripped |

---

## The Core Problem: Schema Conflation

Every MongoDB schema bundles three concerns that need to be separated for a multi-chain architecture:

```
Current (conflated):
  AssetDocument = domain fields + EVM fields + Mongoose Document

Target (separated):
  IAsset          = pure domain interface (uuid, status, metadata, timestamps)
  IAssetEVM       = extends IAsset, adds (contractAddress, txHash, merkleRoot)
  IAssetStellar   = extends IAsset, adds (sorobanContractId, ledgerHash)
  AssetDocument   = IAssetEVM & mongoose.Document  ← backend only
```

This split is the prerequisite for everything else. Until schemas are split this way, the "shared types" package cannot be genuinely shared — any consumer importing it would pull in EVM assumptions.

---

## What `packages/types/` Should Contain

The scaffolded structure already hints at the right layout:

```
packages/types/src/
├── domain/
│   ├── asset.types.ts         ← IAsset, AssetStatus, AssetType
│   ├── user.types.ts          ← IUser, UserRole
│   ├── marketplace.types.ts   ← IOrder, OrderStatus, ListingType
│   ├── settlement.types.ts    ← ISettlement, SettlementStatus
│   ├── notification.types.ts  ← INotification, NotificationType, NotificationSeverity
│   ├── announcement.types.ts  ← IAnnouncement, AnnouncementType
│   ├── compliance.types.ts    ← IComplianceRequest, ComplianceRequestStatus
│   ├── partner.types.ts       ← IPartner, PartnerStatus, PartnerTier, PartnerLoanStatus
│   └── private-asset.types.ts ← IPrivateAsset, PrivateAssetType
├── blockchain/
│   ├── addresses.ts           ← WalletAddress (network-agnostic string alias)
│   ├── transactions.ts        ← TxHash, TxResult (network-agnostic)
│   └── events.ts              ← Unified event payloads (adapter output types)
├── network/
│   ├── evm.types.ts           ← EVM extensions to domain types
│   └── stellar.types.ts       ← Stellar extensions to domain types
└── zod/
    └── *.schema.ts            ← Runtime validation schemas for shared types
```

---

## Summary Counts

| Category | Total | Chain-Agnostic | EVM-Specific |
|----------|-------|---------------|--------------|
| Enums | 24 | 20 | 4 |
| Schema files | 28 | 0 (all conflated) | 28 |
| DTO files | 37+ | ~18 | ~19 |
| Service files w/ viem | 18 | 0 | 18 |
| Config files | 1 | 0 | 1 |

The 28 schemas being "0 chain-agnostic" is the crux — they all need splitting before any clean extraction is possible.
