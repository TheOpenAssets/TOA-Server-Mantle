Claude’s Plan
Solvency Vault Implementation Plan
Overview
Implement a Solvency Vault feature that enables users to deposit RWA/Private Asset tokens as collateral, borrow USDC with LTV ratios, repay loans, and withdraw collateral. The system will introduce PrivateAssetToken for platform-minted tokens representing physical assets. Manual admin-triggered liquidation will sell tokens on marketplace to recover debt.
Architecture Summary
Smart Contracts (Phase 1)
SolvencyVault.sol - Core vault for collateral custody and USDC borrowing
PrivateAssetToken.sol - ERC-20 with compliance for private assets
OAID.sol (Optional) - Credit line issuance backed by private assets
Contract modifications to SeniorPool, PrimaryMarket, TokenFactory
Backend Services (Phase 2)
solvency module - Position tracking, blockchain interaction, liquidation
Database schemas - SolvencyPosition, PrivateAsset
API endpoints - User operations + admin liquidation
Key Design Decisions
Pool: Reuse SeniorPool at 5% APR
LTV: 70% for RWA tokens, 60% for private assets
Liquidation: Manual admin-triggered at 110% health threshold
Private Asset Valuation: Fixed at mint, admin-updatable
Liquidation Pricing: 10% discount from valuation
Phase 1: Smart Contracts
1.1 SolvencyVault.sol
Location: packages/contracts/contracts/core/SolvencyVault.sol Core Structure:

struct Position {
    address user;
    address collateralToken;      // RWA or PrivateAsset token
    uint256 collateralAmount;     // Token amount (18 decimals)
    uint256 usdcBorrowed;         // USDC borrowed (6 decimals)
    uint256 tokenValueUSD;        // Valuation (6 decimals)
    uint256 createdAt;
    bool active;
    TokenType tokenType;          // RWA or PRIVATE_ASSET
}

enum TokenType { RWA, PRIVATE_ASSET }
Key Parameters:
RWA_LTV: 7000 (70%)
PRIVATE_ASSET_LTV: 6000 (60%)
LIQUIDATION_THRESHOLD: 11000 (110%)
Core Functions:
depositCollateral(token, amount, valueUSD) - Accept tokens, validate approval
borrowUSDC(positionId, amount) - Validate LTV, borrow from SeniorPool
repayLoan(positionId, amount) - Accept USDC, repay SeniorPool
withdrawCollateral(positionId, amount) - Require full repayment, return tokens
liquidatePosition(positionId) - Admin-only, create marketplace listing
getHealthFactor(positionId) - Calculate (collateralValueUSD / debt) * 10000
Pattern: Reuse LeverageVault patterns for collateral custody, health calculation, settlement waterfall
1.2 PrivateAssetToken.sol
Location: packages/contracts/contracts/core/PrivateAssetToken.sol Extends: RWAToken with additional metadata Metadata Structure:

struct AssetMetadata {
    string assetType;        // "DEED", "BOND", "INVOICE", etc.
    string location;         // Physical location/jurisdiction
    uint256 valuation;       // USD value (6 decimals)
    uint256 valuationDate;   // Timestamp
    string documentHash;     // IPFS hash
    bool isActive;
}
Key Features:
Inherits compliance from RWAToken (KYC checks)
Platform mints 1 token = 1 physical asset
Admin can update valuation with timestamp
Document hash for off-chain verification
1.3 OAID.sol (Optional)
Location: packages/contracts/contracts/integrations/OAID.sol Purpose: Issue credit lines backed by private asset tokens in SolvencyVault Structure:

struct CreditLine {
    address user;
    address collateralToken;
    uint256 collateralAmount;
    uint256 creditLimit;        // 70% of collateral value
    uint256 creditUsed;
    uint256 solvencyPositionId;
    bool active;
}
Key Function:
issueCreditLine(user, token, amount, valueUSD, positionId) - Called by SolvencyVault
1.4 Contract Modifications
SeniorPool.sol:
Add solvencyVault address
Add setSolvencyVault() function
Update onlyLeverageVault → onlyAuthorizedVault modifier
Allow both LeverageVault and SolvencyVault to borrow
PrimaryMarket.sol:
Add authorizedVaults mapping
Add authorizeVault(address) function
Update createListing() to allow vaults (for liquidation listings)
TokenFactory.sol:
Add deployPrivateAssetTokenSuite() function
Support PrivateAssetToken deployment with metadata
Register in YieldVault (same as RWA tokens)
Phase 2: Backend Services
2.1 Module Structure
Location: packages/backend/src/modules/solvency/

solvency/
├── controllers/
│   ├── solvency.controller.ts           # User endpoints
│   └── solvency-admin.controller.ts      # Admin endpoints
├── services/
│   ├── solvency-position.service.ts      # Position CRUD
│   ├── solvency-blockchain.service.ts    # Contract interaction
│   └── private-asset.service.ts          # Private asset management
├── dto/
│   ├── deposit-collateral.dto.ts
│   ├── borrow.dto.ts
│   ├── repay.dto.ts
│   └── mint-private-asset.dto.ts
└── solvency.module.ts
2.2 Database Schemas
SolvencyPosition (database/schemas/solvency-position.schema.ts):

{
  positionId: number;                    // On-chain ID
  userAddress: string;                   // Indexed
  collateralTokenAddress: string;
  collateralTokenType: 'RWA' | 'PRIVATE_ASSET';
  collateralAmount: string;              // Wei (18 decimals)
  tokenValueUSD: string;                 // Wei (6 decimals)
  usdcBorrowed: string;                  // Wei (6 decimals)
  initialLTV: number;                    // Basis points
  currentHealthFactor: number;           // Basis points
  healthStatus: 'HEALTHY' | 'WARNING' | 'LIQUIDATABLE';
  status: 'ACTIVE' | 'LIQUIDATED' | 'REPAID' | 'CLOSED';

  // Repayment tracking
  totalRepaid: string;
  lastRepaymentTime?: Date;

  // Liquidation details
  liquidationTimestamp?: Date;
  liquidationTxHash?: string;
  marketplaceListingId?: string;
  debtRecovered?: string;

  // OAID integration
  oaidCreditLineId?: number;
}
PrivateAsset (database/schemas/private-asset.schema.ts):

{
  assetId: string;                       // bytes32 on-chain
  tokenAddress: string;                  // PrivateAssetToken address
  assetType: 'DEED' | 'BOND' | 'INVOICE' | 'EQUIPMENT' | 'OTHER';
  name: string;
  symbol: string;
  totalSupply: string;                   // Usually 1e18 for whole asset
  valuation: string;                     // USD (6 decimals)
  valuationDate: Date;
  location?: string;
  documentHash?: string;                 // IPFS
  issuer: string;
  isActive: boolean;
}
2.3 API Endpoints
User Endpoints (SolvencyController):
POST /solvency/deposit - Deposit collateral
POST /solvency/borrow - Borrow USDC
POST /solvency/repay - Repay loan
POST /solvency/withdraw - Withdraw collateral (after full repayment)
GET /solvency/positions/my - User's positions with health status
GET /solvency/position/:id - Position details + current health
Admin Endpoints (SolvencyAdminController):
POST /admin/solvency/liquidate/:id - Trigger liquidation
POST /admin/solvency/private-asset/mint - Mint PrivateAssetToken
GET /admin/solvency/liquidatable - All positions with health < 110%
POST /admin/solvency/approve-token - Approve token for vault
2.4 Service Responsibilities
SolvencyPositionService:
createPosition(), getPosition(), getUserPositions()
updateHealth(), recordRepayment(), markLiquidated()
getLiquidatablePositions()
SolvencyBlockchainService:
depositCollateral(), borrowUSDC(), repayLoan()
withdrawCollateral(), liquidatePosition()
getHealthFactor(), getOutstandingDebt()
PrivateAssetService:
mintPrivateAsset() - Deploy via TokenFactory
getPrivateAsset(), updateValuation()
getAllPrivateAssets()
Phase 3: Integration Points
3.1 SeniorPool Integration
Deploy SolvencyVault
Call SeniorPool.setSolvencyVault(solvencyVaultAddress)
Test borrowing from both vaults
3.2 Marketplace Integration
Add authorizedVaults mapping to PrimaryMarket
Update createListing() to allow vaults
Call PrimaryMarket.authorizeVault(solvencyVaultAddress)
Implement listing callback for settlement
Liquidation Flow:
Calculate discount price (90% of valuation)
Create static listing on PrimaryMarket
Track listingId in SolvencyPosition
Monitor listing sales (via event listener)
On sale: Apply settlement waterfall, update position
3.3 TokenFactory Integration
Import PrivateAssetToken contract
Add deployPrivateAssetTokenSuite() function
Test deployment with metadata
Register in YieldVault
3.4 Notifications
New Types:
Position created
USDC borrowed
Loan repayment received
Liquidation warning (health < 125%)
Liquidation executed
Collateral withdrawn
Phase 4: Testing Strategy
4.1 Contract Tests
Deposit RWA/PrivateAsset tokens
Borrow with LTV validation (70% RWA, 60% private)
Repay partial/full loans
Withdraw after repayment
Liquidate position with health < 110%
Health factor calculation
Settlement waterfall
4.2 Backend Tests
Position lifecycle via API
Private asset minting
Liquidation flow end-to-end
Database record verification
4.3 End-to-End Scenarios
Scenario 1: RWA Token Flow
Deposit 100 RWA tokens ($10k value)
Borrow $7k USDC (70% LTV)
Accrue interest (30 days @ 5% APR = $28.77)
Repay $7,028.77
Withdraw 100 tokens
Verify position closed
Scenario 2: Private Asset Liquidation
Mint DEED token ($50k value)
Deposit 1 DEED, borrow $30k (60% LTV)
Value drops to $32k (health = 106.7% < 110%)
Admin liquidates → marketplace listing at $28.8k
Sale completes → $28.8k to SeniorPool (shortfall $1.2k)
Verify liquidation recorded
Scenario 3: OAID Credit (Optional)
Deposit BOND token ($100k)
Request OAID credit → $70k limit issued
External protocol verifies credit
Credit active while collateral locked
Phase 5: Deployment
5.1 Contract Deployment Order
Deploy PrivateAssetToken implementation
Deploy SolvencyVault
Deploy OAID (optional)
Configure SeniorPool: setSolvencyVault()
Configure PrimaryMarket: authorizeVault()
Update TokenFactory with PrivateAsset support
Update deployed_contracts.json
5.2 Backend Deployment
Register SolvencyModule in app.module.ts
Update ContractLoader with new ABIs
Build and deploy backend
Verify API endpoints
Implementation Order
Week 1: Core Contracts
Day 1-3: SolvencyVault.sol
Day 4-5: PrivateAssetToken.sol
Day 6: Update SeniorPool + PrimaryMarket
Day 7: Contract unit tests
Week 2: Backend Services
Day 1: Database schemas
Day 2-3: SolvencyPositionService
Day 4-5: SolvencyBlockchainService
Day 6: PrivateAssetService
Day 7: Service tests
Week 3: API & Integration
Day 1-2: Controllers (user + admin)
Day 3-4: Marketplace liquidation integration
Day 5-7: Integration tests
Week 4: OAID & Polish
Day 1-2: OAID contract (optional)
Day 3-5: End-to-end testing
Day 6-7: Bug fixes, optimization
Critical Files
Must Create
packages/contracts/contracts/core/SolvencyVault.sol
packages/contracts/contracts/core/PrivateAssetToken.sol
packages/backend/src/modules/solvency/services/solvency-blockchain.service.ts
packages/backend/src/database/schemas/solvency-position.schema.ts
packages/backend/src/database/schemas/private-asset.schema.ts
Must Modify
packages/contracts/contracts/core/SeniorPool.sol - Add SolvencyVault authorization
packages/contracts/contracts/marketplace/PrimaryMarket.sol - Add vault authorization
packages/contracts/contracts/core/TokenFactory.sol - Add PrivateAsset deployment
Risk Mitigation
Valuation Risk: Conservative LTV (60%), regular revaluation, document verification
Liquidation Risk: 10% discount, manual review, waterfall prioritizes debt
Integration Risk: Comprehensive error handling, circuit breakers
Compliance Risk: Inherit ComplianceModule, verify KYC, audit trail
Success Metrics
Total Value Locked (TVL)
Loan Utilization Rate
Liquidation Rate
Bad Debt Amount
Private Asset Adoption
User Retention
OAID Issuance (if implemented)