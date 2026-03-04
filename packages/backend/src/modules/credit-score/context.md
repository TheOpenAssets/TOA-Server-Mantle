# CreditScoreModule

## Responsibility
Owns all credit score computation for the Creditcoin credit system. Reads data only — never writes.

## Layers
- **Layer 1 (Platform Score):** Computed from SolvencyPosition repayment history in MongoDB.
- **Layer 2 (Protocol Score):** Fetched from Creditcoin Substrate chain via CreditcoinSubstrateService.
- **Composite:** Weighted blend (60% L1 + 40% L2). If L2 is unavailable (score = 0), 100% L1.

## Public API
- `CreditScoreService.getBorrowTerms(walletAddress)` — returns composite score, tier, and effective LTV basis points
- `CreditScoreService.getCompositeScore(walletAddress)` — returns raw layer scores and composite
- `CreditScoreService.getEffectiveLtv(walletAddress)` — convenience wrapper returning just the LTV number

## Dependencies
- `SolvencyPosition` Mongoose model (reads only)
- `CreditcoinSubstrateService` (from global BlockchainModule)

## Consumers
- `SolvencyModule` (injected for borrow LTV adjustment)
- `PartnersModule` (injected for partner borrow validation)
- `USCModule` (injected for cache invalidation after proof verification)
