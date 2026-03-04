# Partners Module — Context

## Responsibilities

- Manages external partner integrations that allow licensed third-party lenders to originate loans against user OAID credit lines.
- Handles partner onboarding, API key issuance, tier management, and rate limiting.
- Orchestrates partner-initiated borrow flows: validating OAID ownership, checking credit limits, executing on-chain borrows via `SolvencyVault`, and transferring USDC net of platform fee to the partner's settlement address.
- Handles partner-initiated repayments including direct repay and repay-with-transfer-verification flows.
- Maintains per-loan records (`PartnerLoan` schema) and API call logs (`PartnerApiLog` schema).

## Partner Borrow Flow (credit-aware)

Partner borrow validation now includes a credit score LTV check via `CreditScoreService.getEffectiveLtv()`. After all standard validations (OAID check, partner limits, backing position lookup), the borrow method fetches the user's effective LTV. If the requested `borrowAmount` exceeds the credit-score-adjusted maximum (computed as `collateralValue * effectiveLtv / 10000`), the request is rejected with a `BadRequestException` that surfaces the user's current tier and their maximum borrowable amount. If `getEffectiveLtv()` fails, the default LTV of `7000` (70%) is used and the borrow proceeds normally — credit score failures never block partner borrows.

## Public Interfaces

- `PartnerService` — exported; CRUD for partner records, stat updates.
- `PartnerLoanService` — exported; borrow, repay, repay-with-transfer, loan queries.

## Dependencies

- `SolvencyModule` (via `forwardRef`) — for `SolvencyPositionService` and `SolvencyBlockchainService` (circular dependency).
- `BlockchainModule` (via `forwardRef`) — for `WalletService` and `ContractLoaderService`.
- `CreditScoreModule` — for credit-aware LTV enforcement in the borrow validation path.

## Invariants

- Partners authenticate via API key (verified by `PartnerAuthGuard`).
- A partner can only access loans belonging to their own `partnerId`.
- Platform fee is deducted before USDC is forwarded to the partner's settlement address.
- OAID ownership is verified on-chain before any borrow is executed.
- Credit score LTV ceiling is enforced before the on-chain borrow is dispatched; the check uses `creditLimit` as a proxy for collateral value when the raw collateral value is not directly available.
