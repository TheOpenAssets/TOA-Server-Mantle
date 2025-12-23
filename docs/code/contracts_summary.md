# RWA Smart Contracts Summary

## 📌 Status: Ready for Backend Integration

**Last Updated:** December 23, 2025
**Current Phase:** Phase 1 (Core Infrastructure)
**Deployment Status:** Verified locally, ready for Mantle Testnet

---

## 🏗 System Architecture

The system implements a modular ERC-3643 ecosystem for Real World Assets.

### 1. AttestationRegistry
**Address (Local):** `0x5FbDB2315678afecb367f032d93F642f64180aa3`
- **Purpose:** Canonical on-chain record of asset validity.
- **Key Function:** `registerAsset()` - Links assetId to off-chain data (EigenDA).
- **Security:** Requires ECDSA signature from a trusted attestor.

### 2. TrustedIssuersRegistry
**Address (Local):** `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
- **Purpose:** Controls who can authorize identity verifications.
- **Key Function:** `addTrustedIssuer()` - Admin only.

### 3. IdentityRegistry (ERC-3643)
**Address (Local):** `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
- **Purpose:** Stores KYC status of investors.
- **Key Function:** `registerIdentity()` - Whitelists a user wallet.
- **Integration:** Checked by `ComplianceModule` before every transfer.

### 4. YieldVault
**Address (Local):** `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`
- **Purpose:** Aggregates and distributes USDC yield to token holders.
- **Key Functions:**
  - `depositYield()`: Platform deposits profit.
  - `distributeYieldBatch()`: Platform distributes to holders.
  - `claimAllYield()`: User claims their aggregated share.

### 5. TokenFactory
**Address (Local):** `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`
- **Purpose:** Deploys new RWA tokens with their own Compliance modules.
- **Key Function:** `deployTokenSuite()` - Atomic deployment of Token + Compliance + Registry linkage.

### 6. PrimaryMarketplace
**Address (Local):** `0x0165878A594ca255338adfa4d48449f69242Eb8F`
- **Purpose:** Facilitates initial sale of RWA tokens.
- **Features:** Supports both fixed-price and Dutch auction mechanisms.
- **Key Function:** `buyTokens()` - Swaps USDC for RWA tokens (KYC checked automatically).

---

## 🛠 Recent Updates

1.  **Contract Implementation:** All 8 core contracts defined in the technical design are implemented.
2.  **Compilation:** Fixed all missing license and pragma warnings.
3.  **Testing:**
    - `AttestationRegistry`: Unit tests passed (Register, Revoke, Signature Verification).
    - `Deployment`: `deploy_all.ts` script verified on local Hardhat network.
4.  **Tooling:**
    - `packages/contracts/deployed_contracts.json`: Created to store deployment addresses for frontend/backend consumption.

## 🚀 Next Steps

1.  **Backend Integration:**
    - Generate TypeChain types (`yarn generate:types`).
    - Configure NestJS services to use the addresses from `deployed_contracts.json`.
    - Implement `BlockchainEventListener` to index `AssetRegistered` and `TokenSuiteDeployed` events.

2.  **Testnet Deployment:**
    - Fund deployer wallet with MNT.
    - Set `USDC_ADDRESS` in `.env` (Mantle Sepolia USDC).
    - Run `yarn hardhat run scripts/deploy/deploy_all.ts --network mantleTestnet`.
