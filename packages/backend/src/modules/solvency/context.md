# Solvency Module — Context

## Responsibilities

- Manages the full lifecycle of collateral-backed USDC borrowing via the SolvencyVault on-chain contract.
- Supports two collateral token types: `RWA` (standard tokenized real-world assets) and `PRIVATE_ASSET` (off-chain assets tokenized by admin).
- Orchestrates: collateral deposit, USDC borrowing, loan repayment, collateral withdrawal, and position liquidation.
- Maintains a MongoDB-backed mirror of on-chain positions (`SolvencyPosition` schema) for fast queries.
- Manages private asset requests: user-submitted deed/bond/invoice documents for admin verification before tokenization.
- Runs a scheduled repayment monitor (`RepaymentMonitorService`) to detect missed installments.
- Exposes admin endpoints for liquidation, settlement, marking missed payments, and verifying private asset requests.

## Borrow Flow (credit-aware)

Borrow flow now calls `CreditScoreService.getBorrowTerms()` to determine effective LTV before on-chain execution. The effective LTV is passed to `SolvencyBlockchainService.borrowUSDC()` as an optional parameter. If `getBorrowTerms()` fails for any reason, the borrow proceeds with the default LTV of `7000` (70%) — credit score failures NEVER block a borrow. The borrow response includes a `creditBoost` field with `{ score, tier, appliedLtv, standardLtv, boosted }` so the frontend can surface the user's tier and whether they received a boost.

## Public Interfaces

- `SolvencyPositionService` — exported; used by PartnersModule and UserPortfolioModule.
- `SolvencyBlockchainService` — exported; used by PartnersModule.
- `PrivateAssetService` — exported; used by admin controllers.

## Dependencies

- `BlockchainModule` (via `forwardRef`) — for `WalletService` and `ContractLoaderService`.
- `PartnersModule` (via `forwardRef`) — for `PartnerLoanService` (circular dependency).
- `NotificationsModule` — for sending repayment notifications.
- `UserPortfolioModule` — for portfolio updates on borrow/repay events.
- `CreditScoreModule` — for credit-aware LTV resolution in the borrow flow.

## Invariants

- A user can only borrow against positions they own (wallet address check enforced in controller).
- Credit score LTV adjustments are advisory — the on-chain contract enforces its own LTV ceiling as final authority.
- `SolvencyPosition` records are always synced after on-chain state changes (record-borrow, record-repay, record-withdrawal).
- OAID credit lines are managed on-chain; the backend does not store credit line state, only references them by ID.
