# USCModule

## Responsibility
Owns USC (Universal Smart Contract) cross-chain proof submission and verification on Creditcoin EVM.

## How it works
1. `UscProofService` submits proofs to `USCCreditVerifier` contract on Creditcoin testnet
2. The contract calls the 0x0FD2 precompile which verifies the STARK proof
3. On success, emits `CrossChainEventVerified` event
4. `UscEventListenerService` polls for this event every 5 seconds
5. Events are enqueued to `usc-events` BullMQ queue
6. `UscEventProcessor` saves the event, clears credit score cache, notifies the user

## Public API
- `POST /usc/submit-proof` — submit a cross-chain proof
- `GET /usc/events/:walletAddress` — get verified events for a wallet

## Dependencies
- `USCCreditVerifier` contract on Creditcoin testnet (address in deployed_contracts_creditcoin.json)
- `CreditcoinSubstrateService` (from global BlockchainModule) for cache clearing
- `NotificationService` for user notifications

## Note
If `USCCreditVerifier` address is zero (placeholder), the listener won't start and submissions return `verified: false`. Safe for testnet dev.
