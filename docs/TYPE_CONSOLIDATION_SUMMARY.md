# Type Consolidation Summary

**Status:** Implemented ✅
**Base Package:** `packages/types/`
**Target Architecture:** Chain-Agnostic Core with Network-Specific Extensions

---

## 🏗️ New Type Architecture

The codebase has been refactored to separate pure business logic (Chain-Agnostic) from blockchain implementation details (EVM/Mantle).

### 1. File Structure (`packages/types/src/`)

```text
├── blockchain/
│   ├── addresses.ts           # WalletAddress (string alias)
│   ├── transactions.ts        # [Draft] Generic Tx types
│   └── events.ts              # [Draft] Unified event payloads
├── domain/                    # PURE Domain Types (Bucket 2)
│   ├── asset.types.ts         # IAsset, AssetStatus, AssetType
│   ├── user.types.ts          # IUser, UserRole, KycStatus
│   ├── marketplace.types.ts   # OrderStatus, ListingType
│   ├── settlement.types.ts    # SettlementStatus
│   ├── solvency.types.ts      # SolvencyPositionStatus, SolvencyHealthStatus
│   ├── leverage.types.ts      # LeveragePositionStatus, LeveragePositionHealth
│   ├── partner.types.ts       # PartnerStatus, PartnerTier, PartnerLoanStatus
│   ├── notification.types.ts  # NotificationType, NotificationSeverity
│   ├── announcement.types.ts  # AnnouncementType, AnnouncementStatus
│   └── compliance.types.ts    # ComplianceRequestStatus
├── network/                   # Network-Specific Extensions (Bucket 1)
│   └── evm.types.ts           # IAssetEVM (Extends IAsset with txHash, contractAddress, etc.)
└── zod/                       # Runtime validation (Work in Progress)
```

---

## 📋 Consolidated Types & Enums

### Chain-Agnostic (Shared via `@mantle/types`)

| Domain | Extracted Enums / Interfaces |
|:---|:---|
| **Identity** | `UserRole`, `KycStatus`, `IUser`, `IKycDocument` |
| **Assets** | `AssetStatus`, `AssetType`, `IAsset`, `IAssetMetadata`, `IAssetTokenParams`, `IAssetFiles` |
| **Marketplace**| `OrderStatus`, `ListingType` |
| **Solvency** | `SolvencyPositionStatus`*, `SolvencyHealthStatus`*, `TokenType` |
| **Leverage** | `LeveragePositionStatus`*, `LeveragePositionHealth`* |
| **Financial** | `SettlementStatus`, `PartnerLoanStatus`, `RepaymentSource`, `PartnerStatus`, `PartnerTier` |
| **Messaging** | `NotificationType`, `NotificationSeverity`, `NotificationAction`, `AnnouncementType`, `AnnouncementStatus` |
| **Compliance** | `ComplianceRequestStatus` |

*\*Renamed from generic `PositionStatus` / `HealthStatus` to prevent module collisions.*

### Network-Specific (Bucket 1)

| Type | Extension Logic |
|:---|:---|
| `IAssetEVM` | Extends `IAsset` with `contractAddress`, `transactionHash`, `merkleRoot`, `merkleProof`, `zkProof`, `eigenDA`. |
| `WalletAddress`| Currently a `string` alias to remain compatible with `0x` addresses while allowing future SSIs or Stellar keys. |

---

## 🚀 Impact on Backend

- **Schema Decoupling:** `User`, `Asset`, `Settlement`, and other core schemas now implement interfaces from `@mantle/types`.
- **Import Standardization:** Removed duplicate enum definitions across modules. Services now import from `@mantle/types` instead of relative paths to schemas.
- **Multi-Chain Readiness:** The `IAsset` (agnostic) vs `IAssetEVM` (extension) pattern is now the standard for all future network support (e.g., `IAssetStellar`).

---

## 🛠️ Implementation Details

### Renaming for Clarity
To support a modular architecture where multiple modules might have "Positions" or "Health", enums were qualified during extraction:
- `PositionStatus` (Leverage) → `LeveragePositionStatus`
- `PositionStatus` (Solvency) → `SolvencyPositionStatus`
- `HealthStatus` (Solvency) → `SolvencyHealthStatus`
- `PositionHealth` (Leverage) → `LeveragePositionHealth`

### Cross-Module Synchronization
All 17 modules were analyzed, and 15+ critical files (Services, Processors, Guards) were updated to point to the consolidated types, ensuring that a change in a domain status reflects across the entire system automatically.
