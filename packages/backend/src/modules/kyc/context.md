# KYC Module

## Responsibilities
- Handle investor identity verification through document upload (currently Aadhaar)
- Process KYC documents asynchronously via BullMQ verification queue
- Verify document authenticity through PDF text extraction, QR decoding, and scoring algorithms
- Register verified investors on-chain via blockchain identity registry
- Initialize investor portfolios when KYC is approved
- Send notifications to investors at each verification stage (processing, verified, rejected)

## Public Interfaces

### KycController
- `POST /kyc/upload`: Upload KYC document (PDF) for verification. Requires JWT authentication.
- `GET /kyc/status`: Check current KYC verification status for authenticated user.
- `DELETE /kyc/document`: Delete uploaded document (only if not yet verified).
- `GET /kyc/document`: Retrieve uploaded document (development only).
- `POST /kyc/manual-approve`: (Testing) Manually approve KYC without full verification.

### KycService
- `uploadDocument(user: UserDocument, file: Express.Multer.File)`: Accepts document, stores locally, and queues verification job.
- `getStatus(user: UserDocument)`: Returns current KYC status and metadata.
- `deleteDocument(user: UserDocument)`: Removes KYC document and resets status.
- `manualApprove(user: UserDocument)`: Manually approve KYC for testing purposes.

### VerificationProcessor
- Worker process that handles `kyc-verification` queue jobs
- Extracts text and QR data from PDFs
- Calculates verification score based on required fields and data quality
- Updates user record with verification results
- Triggers blockchain identity registration on successful verification
- Initializes user portfolio after blockchain registration
- Sends notifications to user on verification completion

## Invariants
- User can only upload one document at a time
- Document cannot be deleted once verified
- Verification scoring algorithm requires name, DOB/age, UID, and address fields (minimum 60% score to pass)
- Blockchain registration is non-blocking - KYC approval proceeds even if on-chain registration fails
- Portfolio initialization is non-blocking - KYC approval proceeds even if portfolio creation fails
- All user wallet addresses are normalized to lowercase before processing

## Dependencies
- `BlockchainModule`: To register verified investors on-chain via `BlockchainService.registerIdentity()` (EVM/Mantle only)
- `SolvencyModule`: To register investors in OAID credit system via `SolvencyBlockchainService.registerUserInOAID()` (EVM/Mantle only)
- `NotificationsModule`: To send KYC status update notifications (all networks)
- `UserPortfolioModule`: To initialize empty portfolio document when investor is verified via `UserPortfolioService.initializePortfolio()` (all networks)

## Configuration
- `NETWORK` environment variable determines deployment type:
  - `'mantle'` or `'evm'`: Full on-chain identity registration
  - `'stellar'`: Trustline-based compliance, no on-chain identity registration

## Verification Flow
1. User uploads KYC document (PDF)
2. Document stored locally at `local-storage/kyc-documents/{walletAddress}/{documentId}.pdf`
3. Verification job added to BullMQ queue
4. Background worker processes document:
   - Extract text via pdf-parse
   - Decode QR codes (if present) via jsQR
   - Calculate verification score
   - Update user record with VERIFIED or REJECTED status
5. If VERIFIED:
   - **EVM/Mantle Network:**
     - Register user identity on blockchain (IdentityRegistry)
     - Register user in OAID system (if not already registered)
     - Initialize user portfolio with empty holdings
     - Send success notification with on-chain transaction details
   - **Stellar Network:**
     - **Skip on-chain identity registration** (Stellar uses trustline-based compliance via SAC)
     - Initialize user portfolio with empty holdings
     - Send success notification (investor can now request trustline approvals)
6. User can now make purchases (protected by KycAuthGuard)

## Network-Specific Behavior

### EVM/Mantle Network
- Full on-chain identity registration via `BlockchainService.registerIdentity()`
- OAID credit system registration via `SolvencyBlockchainService.registerUserInOAID()`
- Investor immediately eligible to purchase after KYC approval
- Identity recorded in on-chain IdentityRegistry contract

### Stellar Network
- **No on-chain identity registration** (trustlines provide native compliance)
- Investor must request trustline approval for each asset (separate workflow)
- Portfolio initialized to track asset holdings
- KYC document stored for compliance records only

## Storage
- Local filesystem in development: `process.cwd()/local-storage/kyc-documents/`
- URI format: `file://kyc-documents/{walletAddress}/{documentId}.pdf`
- Production: Migrate to cloud storage (S3/GCS) via DocumentStorageService

## Testing Notes
- `manualApprove` endpoint bypasses verification for rapid testing
- Should be disabled in production environment
