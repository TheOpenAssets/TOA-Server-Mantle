# Partner Platform Integration Plan
## OAID Credit Line Integration for External Lending Platforms

**Version:** 1.0
**Date:** 2026-01-05
**Status:** Planning Phase

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [System Overview](#system-overview)
3. [Architecture Design](#architecture-design)
4. [Database Schema](#database-schema)
5. [Partner Configuration](#partner-configuration)
6. [Authentication System](#authentication-system)
7. [API Endpoints](#api-endpoints)
8. [Business Logic Flows](#business-logic-flows)
9. [Security Considerations](#security-considerations)
10. [Integration Examples](#integration-examples)
11. [Testing Strategy](#testing-strategy)
12. [Monitoring & Observability](#monitoring--observability)
13. [Partner Documentation](#partner-documentation)
14. [Implementation Roadmap](#implementation-roadmap)
15. [Key Design Decisions](#key-design-decisions)

---

## Executive Summary

### Vision

Enable partner platforms to offer USDC loans to users with OAIDs (On-chain Asset Identifiers) while maintaining security and custody control. Partners authenticate via API keys, can verify credit lines on-chain, but must route all borrow/repay operations through our backend API to maintain security.

### Security Model

- ✅ **Partners CAN**: Read public contract functions (check credit lines, position details)
- ✅ **Partners CAN**: Authenticate via API Key (not wallet signatures)
- ❌ **Partners CANNOT**: Call borrow/repay functions directly on contracts
- ✅ **All Operations**: Route through backend API with partner authentication
- ✅ **User Custody**: Users maintain custody of their collateral (non-custodial)

### Key Benefits

1. **Expanded Reach**: Users can access credit across multiple platforms
2. **Security**: Centralized control prevents unauthorized contract interactions
3. **Auditability**: Complete visibility into all partner operations
4. **Flexibility**: Can modify contract logic without breaking partner integrations
5. **Revenue**: Platform fees on partner-originated loans

---

## System Overview

### Current OAID Solvency Vault System

```
┌─────────────────────────────────────────────────────────┐
│ USER                                                    │
│  ├─ Deposits RWA/Private Asset tokens                   │
│  ├─ Receives OAID (On-chain Asset Identifier)          │
│  ├─ OAID has credit line (70% LTV for RWA)             │
│  ├─ Can borrow USDC against collateral                  │
│  └─ Repays loans + interest                             │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ SMART CONTRACTS (Mantle Sepolia)                        │
│  ├─ SolvencyVault.sol                                   │
│  │   ├─ Manages collateral positions                    │
│  │   ├─ Enforces LTV limits (70% RWA, 60% Private)     │
│  │   ├─ Tracks debt per position                        │
│  │   └─ Handles liquidations                            │
│  │                                                       │
│  ├─ SeniorPool.sol                                      │
│  │   ├─ USDC lending pool                               │
│  │   ├─ Interest accrual                                │
│  │   └─ Debt tracking                                   │
│  │                                                       │
│  └─ OAID.sol (ERC-721)                                  │
│      ├─ Issues credit line NFTs                         │
│      ├─ Tracks credit limit & usage                     │
│      └─ Public view functions for credit checks         │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ BACKEND API (NestJS)                                    │
│  ├─ JWT Authentication (wallet signatures)              │
│  ├─ Position tracking (MongoDB)                         │
│  ├─ Sync on-chain positions to database                 │
│  ├─ User management & KYC                               │
│  └─ Asset marketplace integration                       │
└─────────────────────────────────────────────────────────┘
```

### Proposed Partner Integration

```
┌─────────────────────────────────────────────────────────┐
│ USER JOURNEY                                            │
└─────────────────────────────────────────────────────────┘
      │
      │ 1. Deposits collateral via YOUR platform
      ▼
┌─────────────────┐
│ Your Platform   │ → Creates position, issues OAID
│ (Primary)       │
└─────────────────┘
      │
      │ 2. User visits partner platform
      ▼
┌─────────────────┐
│ Partner Platform│
│ (XYZ Lending)   │
└────────┬────────┘
         │
         │ 3. Check user's credit (on-chain, public)
         │    OAID.getCreditLine(tokenId) → view function
         │
         │ 4. User requests loan
         ▼
    ┌────────────────────────────┐
    │ POST /partners/borrow       │
    │ Auth: Bearer pk_xyz_live... │ ← Partner API Key
    │ Body: {                     │
    │   oaidTokenId: 123,         │
    │   userWallet: "0x...",      │
    │   borrowAmount: "5000",     │
    │   partnerLoanId: "loan_123" │
    │ }                           │
    └────────┬───────────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │ Your Backend                │
    │  ├─ Validates API key       │
    │  ├─ Verifies OAID ownership │
    │  ├─ Checks credit available │
    │  ├─ Enforces partner limits │
    │  ├─ Borrows from vault      │ ← Platform wallet signs TX
    │  ├─ Transfers USDC          │
    │  ├─ Records partner loan    │
    │  └─ Returns success         │
    └────────┬───────────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │ Partner receives USDC       │
    │ Partner disburses to user   │
    │ Partner tracks loan         │
    └─────────────────────────────┘

REPAYMENT FLOW:

┌─────────────────┐
│ User repays     │
│ @ Partner       │
└────────┬────────┘
         │
         ▼
┌────────────────────────────┐
│ POST /partners/repay        │
│ Auth: Bearer pk_xyz_live... │
│ Body: {                     │
│   partnerLoanId: "loan_123",│
│   repaymentAmount: "5000"   │
│ }                           │
└────────┬───────────────────┘
         │
         ▼
┌────────────────────────────┐
│ Your Backend                │
│  ├─ Receives USDC from      │
│  │   partner                │
│  ├─ Repays to SolvencyVault │ ← Platform wallet signs TX
│  ├─ Updates position        │
│  ├─ Marks loan repaid       │
│  └─ Returns success         │
└─────────────────────────────┘
```

---

## Architecture Design

### High-Level Components

```
┌───────────────────────────────────────────────────────────────┐
│                    PARTNER INTEGRATION LAYER                  │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────┐      ┌──────────────────────┐      │
│  │ Authentication      │      │ Partner Management   │      │
│  │ ────────────────    │      │ ──────────────────   │      │
│  │ • API Key Guard     │      │ • Create partners    │      │
│  │ • Rate Limiting     │      │ • Manage limits      │      │
│  │ • Request Signing   │      │ • Analytics          │      │
│  │ • Audit Logging     │      │ • Fee configuration  │      │
│  └─────────────────────┘      └──────────────────────┘      │
│                                                               │
│  ┌─────────────────────┐      ┌──────────────────────┐      │
│  │ Loan Operations     │      │ Integration Tools    │      │
│  │ ────────────────    │      │ ──────────────────   │      │
│  │ • Borrow endpoint   │      │ • Partner SDK        │      │
│  │ • Repay endpoint    │      │ • Webhooks           │      │
│  │ • Loan queries      │      │ • Documentation      │      │
│  │ • Status tracking   │      │ • Sandbox            │      │
│  └─────────────────────┘      └──────────────────────┘      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│                    EXISTING SYSTEM                            │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Database (MongoDB)                                  │    │
│  │ ────────────────                                    │    │
│  │ • SolvencyPosition (updated)                        │    │
│  │ • Partner (new)                                     │    │
│  │ • PartnerLoan (new)                                 │    │
│  │ • PartnerApiLog (new)                               │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Smart Contracts (Mantle Sepolia)                    │    │
│  │ ────────────────                                    │    │
│  │ • SolvencyVault.sol                                 │    │
│  │ • SeniorPool.sol                                    │    │
│  │ • OAID.sol                                          │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### 1. Partner Schema

**File:** `/packages/backend/src/database/schemas/partner.schema.ts`

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerDocument = Partner & Document;

export enum PartnerStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  INACTIVE = 'INACTIVE',
}

export enum PartnerTier {
  BASIC = 'BASIC',
  PREMIUM = 'PREMIUM',
  ENTERPRISE = 'ENTERPRISE',
}

@Schema({ timestamps: true })
export class Partner {
  // Identifiers
  @Prop({ required: true, unique: true })
  partnerId!: string;                 // UUID, unique partner identifier

  @Prop({ required: true })
  partnerName!: string;               // "XYZ Lending", "ABC Finance"

  // Authentication
  @Prop({ required: true, unique: true })
  apiKey!: string;                    // SHA-256 hashed API key (never store plaintext!)

  @Prop({ required: true })
  apiKeyPrefix!: string;              // First 8 chars for identification (e.g., "pk_live_")

  @Prop()
  publicKey?: string;                 // Optional: Partner's Ethereum address

  // Configuration
  @Prop({ required: true, enum: PartnerStatus, default: PartnerStatus.ACTIVE })
  status!: PartnerStatus;

  @Prop({ required: true, enum: PartnerTier, default: PartnerTier.BASIC })
  tier!: PartnerTier;

  // Limits & Quotas (all in 6 decimals - USDC format)
  @Prop({ required: true })
  dailyBorrowLimit!: string;          // Max USDC per day

  @Prop({ required: true })
  totalBorrowLimit!: string;          // Max outstanding USDC

  @Prop({ required: true, default: '0' })
  currentOutstanding!: string;        // Current borrowed amount

  // Financial Terms
  @Prop({ required: true, default: 50 })
  platformFeePercentage!: number;     // Basis points (e.g., 50 = 0.5%)

  @Prop({ required: true })
  settlementAddress!: string;         // Where to send/receive USDC

  // Webhook Integration (Optional)
  @Prop()
  webhookUrl?: string;                // For notifications

  @Prop()
  webhookSecret?: string;             // HMAC secret for webhook verification

  // Metadata
  @Prop({ required: true })
  contactEmail!: string;

  @Prop()
  contactWallet?: string;

  @Prop({ default: false })
  kycVerified!: boolean;

  @Prop({ default: false })
  contractSigned!: boolean;

  // Audit
  @Prop({ required: true })
  createdBy!: string;                 // Admin wallet who created this partner

  @Prop()
  lastUsedAt?: Date;

  @Prop({ default: '0' })
  totalBorrowed!: string;             // Lifetime borrowed amount

  @Prop({ default: '0' })
  totalRepaid!: string;               // Lifetime repaid amount

  // Timestamps
  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const PartnerSchema = SchemaFactory.createForClass(Partner);

// Indexes
PartnerSchema.index({ partnerId: 1 }, { unique: true });
PartnerSchema.index({ apiKey: 1 }, { unique: true });
PartnerSchema.index({ status: 1 });
```

### 2. PartnerLoan Schema

**File:** `/packages/backend/src/database/schemas/partner-loan.schema.ts`

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerLoanDocument = PartnerLoan & Document;

export enum PartnerLoanStatus {
  ACTIVE = 'ACTIVE',
  REPAID = 'REPAID',
  DEFAULTED = 'DEFAULTED',
  LIQUIDATED = 'LIQUIDATED',
}

export enum RepaymentSource {
  USER = 'USER',
  PARTNER = 'PARTNER',
  LIQUIDATION = 'LIQUIDATION',
}

@Schema({ timestamps: true })
export class PartnerLoan {
  // Identifiers
  @Prop({ required: true, unique: true })
  partnerLoanId!: string;             // Partner's internal loan ID

  @Prop({ required: true, unique: true })
  internalLoanId!: string;            // Your UUID for this loan

  @Prop({ required: true, index: true })
  partnerId!: string;                 // Reference to Partner

  @Prop({ required: true })
  partnerName!: string;               // Cached for queries

  // User & Position
  @Prop({ required: true, index: true })
  userWallet!: string;                // Borrower's wallet

  @Prop({ required: true, index: true })
  oaidTokenId!: number;               // OAID used for credit line

  @Prop({ required: true })
  solvencyPositionId!: number;        // Position backing this loan

  // Loan Details (all amounts in 6 decimals - USDC format)
  @Prop({ required: true })
  principalAmount!: string;           // Original borrowed amount

  @Prop({ required: true })
  remainingDebt!: string;             // Current outstanding

  @Prop({ default: 0 })
  interestRate!: number;              // Annual rate in basis points

  @Prop({ required: true })
  borrowedAt!: Date;

  // Repayment Tracking
  @Prop({ default: '0' })
  totalRepaid!: string;               // Total repaid so far

  @Prop()
  lastRepaymentAt?: Date;

  @Prop({ type: [Object], default: [] })
  repaymentHistory!: Array<{
    amount: string;                   // USDC amount (6 decimals)
    timestamp: Date;
    txHash?: string;                  // If on-chain proof provided
    repaidBy: RepaymentSource;
  }>;

  // Status
  @Prop({ required: true, enum: PartnerLoanStatus, default: PartnerLoanStatus.ACTIVE })
  status!: PartnerLoanStatus;

  // On-chain References
  @Prop()
  borrowTxHash?: string;              // Your platform's borrow transaction

  @Prop()
  repayTxHash?: string;               // Final repayment transaction

  // Platform Fees
  @Prop({ default: '0' })
  platformFeeCharged!: string;        // Fee charged to partner (6 decimals)

  @Prop({ default: false })
  platformFeePaid!: boolean;

  // Metadata
  @Prop({ type: Object })
  metadata?: {
    partnerUserId?: string;           // Partner's internal user ID
    loanPurpose?: string;
    customFields?: any;
  };

  // Timestamps
  @Prop()
  createdAt?: Date;

  @Prop()
  updatedAt?: Date;
}

export const PartnerLoanSchema = SchemaFactory.createForClass(PartnerLoan);

// Indexes
PartnerLoanSchema.index({ partnerLoanId: 1 }, { unique: true });
PartnerLoanSchema.index({ internalLoanId: 1 }, { unique: true });
PartnerLoanSchema.index({ partnerId: 1, status: 1 });
PartnerLoanSchema.index({ userWallet: 1, status: 1 });
PartnerLoanSchema.index({ oaidTokenId: 1 });
```

### 3. PartnerApiLog Schema

**File:** `/packages/backend/src/database/schemas/partner-api-log.schema.ts`

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PartnerApiLogDocument = PartnerApiLog & Document;

@Schema({ timestamps: true })
export class PartnerApiLog {
  @Prop({ required: true, index: true })
  partnerId!: string;

  @Prop({ required: true })
  partnerName!: string;

  // Request Details
  @Prop({ required: true })
  endpoint!: string;                  // "/partners/borrow"

  @Prop({ required: true })
  method!: string;                    // "POST"

  @Prop({ required: true })
  ipAddress!: string;

  @Prop()
  userAgent?: string;

  // Request Data (sanitized - no sensitive info)
  @Prop({ type: Object })
  requestPayload?: any;

  // Response
  @Prop({ required: true })
  statusCode!: number;                // 200, 400, 401, etc.

  @Prop({ required: true })
  responseTime!: number;              // Milliseconds

  @Prop({ required: true })
  success!: boolean;

  @Prop()
  errorMessage?: string;

  // Context
  @Prop()
  userWallet?: string;                // If related to user operation

  @Prop()
  oaidTokenId?: number;

  @Prop()
  loanId?: string;

  // Timestamp
  @Prop({ required: true, index: true })
  timestamp!: Date;
}

export const PartnerApiLogSchema = SchemaFactory.createForClass(PartnerApiLog);

// Indexes
PartnerApiLogSchema.index({ partnerId: 1, timestamp: -1 });
PartnerApiLogSchema.index({ success: 1, timestamp: -1 });
```

### 4. Update SolvencyPosition Schema

**File:** `/packages/backend/src/database/schemas/solvency-position.schema.ts`

Add partner loan tracking to existing schema:

```typescript
// Add these fields to existing SolvencyPosition class

@Prop({ type: [Object], default: [] })
partnerLoans!: Array<{
  partnerId: string;
  partnerLoanId: string;              // Reference to PartnerLoan.internalLoanId
  borrowedAmount: string;             // USDC borrowed via this partner
  active: boolean;
}>;

@Prop({ default: '0' })
totalPartnerDebt!: string;            // Sum of all active partner loans (6 decimals)
```

---

## Partner Configuration

### Partner Config File

**File:** `/packages/backend/configs/partner_platforms.json`

```json
{
  "partners": [
    {
      "partnerId": "partner_xyz_lending_001",
      "partnerName": "XYZ Lending",
      "apiKeyPrefix": "pk_xyz_live_",
      "publicKey": "0x1234567890123456789012345678901234567890",
      "status": "ACTIVE",
      "tier": "PREMIUM",
      "dailyBorrowLimit": "100000000000",
      "totalBorrowLimit": "500000000000",
      "platformFeePercentage": 50,
      "settlementAddress": "0xPartnerSettlementWallet1234567890123456",
      "webhookUrl": "https://xyz-lending.com/api/webhooks/mantle-rwa",
      "contactEmail": "api@xyz-lending.com",
      "kycVerified": true,
      "contractSigned": true
    },
    {
      "partnerId": "partner_abc_finance_002",
      "partnerName": "ABC Finance",
      "apiKeyPrefix": "pk_abc_live_",
      "status": "ACTIVE",
      "tier": "BASIC",
      "dailyBorrowLimit": "50000000000",
      "totalBorrowLimit": "200000000000",
      "platformFeePercentage": 75,
      "settlementAddress": "0xABCSettlementWallet1234567890123456789",
      "contactEmail": "dev@abc-finance.com",
      "kycVerified": true,
      "contractSigned": true
    }
  ]
}
```

**Note:** Actual API keys are NEVER in this file. They're generated separately and stored hashed in the database.

### API Key Format

```
pk_{partner}_{env}_{random32chars}

Examples:
- pk_xyz_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
- pk_abc_live_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4
- pk_def_sandbox_j1k2l3m4n5o6p7q8r9s0t1u2v3w4x5y6

Storage:
- Database: SHA-256 hash only
- Partner receives plaintext ONCE during creation
```

---

## Authentication System

### Partner API Key Guard

**File:** `/packages/backend/src/modules/partners/guards/partner-api-key.guard.ts`

```typescript
import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { PartnerService } from '../services/partner.service';

@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(private partnerService: PartnerService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // Extract API key from header
    // Format: "Authorization: Bearer pk_xyz_live_..."
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing API key');
    }

    const apiKey = authHeader.substring(7);

    // Validate API key
    const partner = await this.partnerService.validateApiKey(apiKey);
    if (!partner) {
      throw new UnauthorizedException('Invalid API key');
    }

    // Check partner status
    if (partner.status !== 'ACTIVE') {
      throw new ForbiddenException(`Partner account is ${partner.status.toLowerCase()}`);
    }

    // Attach partner to request for use in controllers
    request.partner = partner;

    return true;
  }
}
```

### Partner Service - API Key Validation

```typescript
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createHash } from 'crypto';
import { Partner, PartnerDocument } from '../../database/schemas/partner.schema';

@Injectable()
export class PartnerService {
  constructor(
    @InjectModel(Partner.name) private partnerModel: Model<PartnerDocument>,
  ) {}

  async validateApiKey(apiKey: string): Promise<PartnerDocument | null> {
    // Hash the incoming API key
    const hashedKey = createHash('sha256').update(apiKey).digest('hex');

    // Find partner by hashed key
    const partner = await this.partnerModel.findOne({ apiKey: hashedKey });

    if (partner) {
      // Update last used timestamp
      partner.lastUsedAt = new Date();
      await partner.save();
    }

    return partner;
  }

  generateApiKey(partnerPrefix: string, environment: 'live' | 'sandbox'): { apiKey: string; hashedKey: string; prefix: string } {
    // Generate random 32 character string
    const randomBytes = require('crypto').randomBytes(16).toString('hex');

    // Format: pk_{partner}_{env}_{random}
    const apiKey = `pk_${partnerPrefix}_${environment}_${randomBytes}`;

    // Hash for storage
    const hashedKey = createHash('sha256').update(apiKey).digest('hex');

    // Prefix for identification (first 16 chars)
    const prefix = apiKey.substring(0, 16);

    return { apiKey, hashedKey, prefix };
  }
}
```

### Rate Limiting

**Implementation:** Use Redis-based rate limiting with different limits per tier

```typescript
// Rate limits by tier
const RATE_LIMITS = {
  BASIC: 100,      // requests per minute
  PREMIUM: 500,
  ENTERPRISE: 2000,
};

// Redis key: ratelimit:partner:{partnerId}:{currentMinute}
// Increment on each request, expire after 60 seconds
```

---

## API Endpoints

### Public Endpoints (No Authentication)

Partners can read public on-chain data without authentication (anyone can call view functions on the blockchain).

#### 1. Get OAID Credit Line

```
GET /partners/public/oaid/:oaidTokenId/credit-line
```

**Response:**
```json
{
  "oaidTokenId": 123,
  "creditLimit": "10000000000",
  "creditUsed": "2000000000",
  "availableCredit": "8000000000",
  "active": true,
  "owner": "0xUserWalletAddress..."
}
```

#### 2. Get Position Details

```
GET /partners/public/position/:positionId/details
```

**Response:**
```json
{
  "positionId": 42,
  "user": "0xUserWallet...",
  "collateralToken": "0xTokenAddress...",
  "collateralAmount": "50000000000000000000",
  "collateralValueUSD": "4000000",
  "usdcBorrowed": "2000000",
  "healthFactor": 2.0,
  "active": true,
  "tokenType": "RWA"
}
```

---

### Authenticated Endpoints (Require Partner API Key)

All endpoints require:
```
Authorization: Bearer pk_xyz_live_a1b2c3d4...
Content-Type: application/json
```

#### 3. Borrow on Behalf of User

```
POST /partners/borrow
```

**Request Body:**
```json
{
  "oaidTokenId": 123,
  "userWallet": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
  "borrowAmount": "5000000000",
  "partnerLoanId": "xyz_loan_12345",
  "metadata": {
    "partnerUserId": "user_xyz_456",
    "loanPurpose": "working_capital"
  }
}
```

**Response (Success - 201):**
```json
{
  "success": true,
  "internalLoanId": "uuid-1234-5678-90ab-cdef",
  "borrowedAmount": "5000000000",
  "netAmountTransferred": "4975000000",
  "platformFee": "25000000",
  "remainingCredit": "3000000000",
  "txHash": "0xabc123def456...",
  "message": "Loan successfully processed"
}
```

**Response (Error - 400):**
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Insufficient credit. Available: $3000",
  "error": "Bad Request"
}
```

#### 4. Repay Loan

```
POST /partners/repay
```

**Request Body:**
```json
{
  "partnerLoanId": "xyz_loan_12345",
  "repaymentAmount": "5000000000",
  "repaymentTxHash": "0xdef789abc012..."
}
```

**Response (Success - 200):**
```json
{
  "success": true,
  "remainingDebt": "0",
  "loanStatus": "REPAID",
  "txHash": "0xghi345jkl678...",
  "message": "Loan fully repaid"
}
```

#### 5. Get Loan Details

```
GET /partners/loan/:partnerLoanId
```

**Response:**
```json
{
  "partnerLoanId": "xyz_loan_12345",
  "internalLoanId": "uuid-1234-5678-90ab-cdef",
  "userWallet": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
  "oaidTokenId": 123,
  "principalAmount": "5000000000",
  "remainingDebt": "0",
  "totalRepaid": "5000000000",
  "status": "REPAID",
  "borrowedAt": "2026-01-05T10:30:00Z",
  "repaymentHistory": [
    {
      "amount": "5000000000",
      "timestamp": "2026-01-10T15:20:00Z",
      "txHash": "0xghi345jkl678...",
      "repaidBy": "PARTNER"
    }
  ]
}
```

#### 6. Get User's Loans (Through This Partner)

```
GET /partners/user/:userWallet/loans?status=ACTIVE&limit=10&offset=0
```

**Response:**
```json
{
  "total": 3,
  "limit": 10,
  "offset": 0,
  "loans": [
    {
      "partnerLoanId": "xyz_loan_12345",
      "principalAmount": "5000000000",
      "remainingDebt": "3000000000",
      "status": "ACTIVE",
      "borrowedAt": "2026-01-05T10:30:00Z"
    },
    ...
  ]
}
```

#### 7. Get Partner Stats

```
GET /partners/my/stats
```

**Response:**
```json
{
  "partnerId": "partner_xyz_lending_001",
  "partnerName": "XYZ Lending",
  "tier": "PREMIUM",
  "status": "ACTIVE",
  "limits": {
    "dailyBorrowLimit": "100000000000",
    "totalBorrowLimit": "500000000000",
    "currentOutstanding": "25000000000"
  },
  "usage": {
    "dailyBorrowed": "5000000000",
    "dailyRemaining": "95000000000",
    "totalRemaining": "475000000000",
    "utilizationRate": "5.0%"
  },
  "lifetime": {
    "totalBorrowed": "150000000000",
    "totalRepaid": "125000000000",
    "activeLoans": 12,
    "repaidLoans": 87
  }
}
```

#### 8. Get Transaction History

```
GET /partners/my/transactions?startDate=2026-01-01&endDate=2026-01-31&limit=50&offset=0
```

**Response:**
```json
{
  "total": 234,
  "transactions": [
    {
      "timestamp": "2026-01-05T10:30:00Z",
      "type": "BORROW",
      "partnerLoanId": "xyz_loan_12345",
      "amount": "5000000000",
      "userWallet": "0x580F5b09765E71D64613c8F4403234f8790DD7D3",
      "txHash": "0xabc123...",
      "status": "SUCCESS"
    },
    ...
  ]
}
```

---

### Admin Endpoints (Require JWT + AdminRoleGuard)

All require existing JWT authentication with ADMIN role.

#### 9. Create Partner

```
POST /admin/partners/create
```

**Request Body:**
```json
{
  "partnerName": "New Lending Platform",
  "apiKeyPrefix": "nlp",
  "tier": "BASIC",
  "dailyBorrowLimit": "50000000000",
  "totalBorrowLimit": "200000000000",
  "platformFeePercentage": 75,
  "settlementAddress": "0xSettlementAddress...",
  "contactEmail": "api@newplatform.com",
  "webhookUrl": "https://newplatform.com/webhooks"
}
```

**Response:**
```json
{
  "success": true,
  "partner": {
    "partnerId": "partner_nlp_003",
    "partnerName": "New Lending Platform",
    "status": "ACTIVE",
    "tier": "BASIC"
  },
  "apiKey": "pk_nlp_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "warning": "Save this API key securely. It will not be shown again!"
}
```

#### 10. Regenerate API Key

```
POST /admin/partners/:partnerId/regenerate-api-key
```

**Response:**
```json
{
  "success": true,
  "apiKey": "pk_nlp_live_x9y8z7w6v5u4t3s2r1q0p9o8n7m6l5k4",
  "warning": "Old API key has been invalidated. Save this new key securely!"
}
```

#### 11. Update Partner

```
PATCH /admin/partners/:partnerId
```

**Request Body:**
```json
{
  "dailyBorrowLimit": "75000000000",
  "totalBorrowLimit": "300000000000",
  "tier": "PREMIUM"
}
```

#### 12. Suspend Partner

```
POST /admin/partners/:partnerId/suspend
```

#### 13. Activate Partner

```
POST /admin/partners/:partnerId/activate
```

#### 14. List All Partners

```
GET /admin/partners?status=ACTIVE&tier=PREMIUM
```

#### 15. Get Partner Analytics

```
GET /admin/partners/:partnerId/analytics?period=30d
```

**Response:**
```json
{
  "partnerId": "partner_xyz_lending_001",
  "period": "30 days",
  "metrics": {
    "totalBorrowed": "50000000000",
    "totalRepaid": "45000000000",
    "newLoans": 123,
    "repaidLoans": 117,
    "activeLoans": 6,
    "defaultRate": "0.5%",
    "averageLoanSize": "406504065",
    "platformFeesEarned": "250000000"
  },
  "trends": {
    "dailyVolume": [...],
    "repaymentRate": [...]
  }
}
```

#### 16. View Partner Audit Logs

```
GET /admin/partners/audit-logs?partnerId=partner_xyz_001&startDate=2026-01-01&limit=100
```

---

## Business Logic Flows

### Borrow Flow - Detailed Implementation

**File:** `/packages/backend/src/modules/partners/services/partner-loan.service.ts`

```typescript
async partnerBorrow(
  partner: Partner,
  borrowDto: PartnerBorrowDto
): Promise<BorrowResponse> {

  // ═══════════════════════════════════════════════════════
  // STEP 1: VALIDATION
  // ═══════════════════════════════════════════════════════

  // 1a. Verify user owns the OAID
  const oaidOwner = await this.oaidContract.ownerOf(borrowDto.oaidTokenId);
  if (oaidOwner.toLowerCase() !== borrowDto.userWallet.toLowerCase()) {
    throw new ForbiddenException('User does not own this OAID');
  }

  // 1b. Get OAID credit line from contract
  const creditLine = await this.oaidContract.getCreditLine(borrowDto.oaidTokenId);
  if (!creditLine.active) {
    throw new BadRequestException('OAID credit line is not active');
  }

  // 1c. Check available credit
  const availableCredit = BigInt(creditLine.limit) - BigInt(creditLine.used);
  if (BigInt(borrowDto.borrowAmount) > availableCredit) {
    throw new BadRequestException(
      `Insufficient credit. Available: $${ethers.formatUnits(availableCredit, 6)}`
    );
  }

  // 1d. Check partner daily limit
  const partnerDailyUsage = await this.getPartnerDailyUsage(partner.partnerId);
  const dailyRemaining = BigInt(partner.dailyBorrowLimit) - partnerDailyUsage;
  if (BigInt(borrowDto.borrowAmount) > dailyRemaining) {
    throw new ForbiddenException(
      `Partner daily limit exceeded. Remaining: $${ethers.formatUnits(dailyRemaining, 6)}`
    );
  }

  // 1e. Check partner total limit
  const totalRemaining = BigInt(partner.totalBorrowLimit) - BigInt(partner.currentOutstanding);
  if (BigInt(borrowDto.borrowAmount) > totalRemaining) {
    throw new ForbiddenException(
      `Partner total limit exceeded. Remaining: $${ethers.formatUnits(totalRemaining, 6)}`
    );
  }

  // 1f. Check for duplicate loan ID
  const existingLoan = await this.partnerLoanModel.findOne({
    partnerId: partner.partnerId,
    partnerLoanId: borrowDto.partnerLoanId
  });
  if (existingLoan) {
    throw new ConflictException('Partner loan ID already exists');
  }

  // ═══════════════════════════════════════════════════════
  // STEP 2: FIND BACKING POSITION
  // ═══════════════════════════════════════════════════════

  const position = await this.solvencyPositionService.findActivePositionByOAID(
    borrowDto.userWallet,
    borrowDto.oaidTokenId
  );
  if (!position) {
    throw new BadRequestException('No active collateral position found for this OAID');
  }

  // ═══════════════════════════════════════════════════════
  // STEP 3: EXECUTE ON-CHAIN BORROW
  // ═══════════════════════════════════════════════════════

  const platformWallet = new ethers.Wallet(
    this.configService.get('PLATFORM_PRIVATE_KEY'),
    this.provider
  );

  const solvencyVault = new ethers.Contract(
    this.configService.get('SOLVENCY_VAULT_ADDRESS'),
    SOLVENCY_VAULT_ABI,
    platformWallet
  );

  // Call borrowUSDC on SolvencyVault
  const borrowTx = await solvencyVault.borrowUSDC(
    position.positionId,
    borrowDto.borrowAmount
  );

  const receipt = await borrowTx.wait();

  // ═══════════════════════════════════════════════════════
  // STEP 4: CALCULATE AND TRANSFER USDC TO PARTNER
  // ═══════════════════════════════════════════════════════

  const usdcContract = new ethers.Contract(
    this.configService.get('USDC_ADDRESS'),
    ['function transfer(address to, uint256 amount) returns (bool)'],
    platformWallet
  );

  // Deduct platform fee
  const feeAmount = (BigInt(borrowDto.borrowAmount) * BigInt(partner.platformFeePercentage)) / BigInt(10000);
  const netAmount = BigInt(borrowDto.borrowAmount) - feeAmount;

  // Transfer net amount to partner
  const transferTx = await usdcContract.transfer(
    partner.settlementAddress,
    netAmount
  );
  await transferTx.wait();

  // ═══════════════════════════════════════════════════════
  // STEP 5: CREATE DATABASE RECORDS
  // ═══════════════════════════════════════════════════════

  const internalLoanId = uuidv4();

  const partnerLoan = await this.partnerLoanModel.create({
    partnerLoanId: borrowDto.partnerLoanId,
    internalLoanId,
    partnerId: partner.partnerId,
    partnerName: partner.partnerName,
    userWallet: borrowDto.userWallet,
    oaidTokenId: borrowDto.oaidTokenId,
    solvencyPositionId: position.positionId,
    principalAmount: borrowDto.borrowAmount,
    remainingDebt: borrowDto.borrowAmount,
    interestRate: 0, // TODO: Fetch from SeniorPool
    borrowedAt: new Date(),
    totalRepaid: '0',
    repaymentHistory: [],
    status: PartnerLoanStatus.ACTIVE,
    borrowTxHash: receipt.hash,
    platformFeeCharged: feeAmount.toString(),
    platformFeePaid: true,
    metadata: borrowDto.metadata,
  });

  // ═══════════════════════════════════════════════════════
  // STEP 6: UPDATE POSITION
  // ═══════════════════════════════════════════════════════

  await this.solvencyPositionService.addPartnerLoan(position._id, {
    partnerId: partner.partnerId,
    partnerLoanId: internalLoanId,
    borrowedAmount: borrowDto.borrowAmount,
    active: true,
  });

  // ═══════════════════════════════════════════════════════
  // STEP 7: UPDATE PARTNER STATS
  // ═══════════════════════════════════════════════════════

  await this.partnerModel.findByIdAndUpdate(partner._id, {
    $inc: {
      currentOutstanding: borrowDto.borrowAmount,
      totalBorrowed: borrowDto.borrowAmount,
    },
    lastUsedAt: new Date(),
  });

  // ═══════════════════════════════════════════════════════
  // STEP 8: LOG OPERATION
  // ═══════════════════════════════════════════════════════

  await this.logPartnerApiCall(partner, 'POST /partners/borrow', {
    userWallet: borrowDto.userWallet,
    oaidTokenId: borrowDto.oaidTokenId,
    amount: borrowDto.borrowAmount,
    success: true,
    loanId: internalLoanId,
  });

  // ═══════════════════════════════════════════════════════
  // STEP 9: RETURN RESPONSE
  // ═══════════════════════════════════════════════════════

  return {
    success: true,
    internalLoanId,
    borrowedAmount: borrowDto.borrowAmount,
    netAmountTransferred: netAmount.toString(),
    platformFee: feeAmount.toString(),
    remainingCredit: (availableCredit - BigInt(borrowDto.borrowAmount)).toString(),
    txHash: receipt.hash,
    message: 'Loan successfully processed',
  };
}
```

### Repay Flow - Detailed Implementation

```typescript
async partnerRepay(
  partner: Partner,
  repayDto: PartnerRepayDto
): Promise<RepayResponse> {

  // ═══════════════════════════════════════════════════════
  // STEP 1: FIND LOAN
  // ═══════════════════════════════════════════════════════

  const loan = await this.partnerLoanModel.findOne({
    partnerId: partner.partnerId,
    partnerLoanId: repayDto.partnerLoanId,
  });

  if (!loan) {
    throw new NotFoundException('Loan not found');
  }

  if (loan.status === PartnerLoanStatus.REPAID) {
    throw new BadRequestException('Loan already fully repaid');
  }

  // ═══════════════════════════════════════════════════════
  // STEP 2: VALIDATE REPAYMENT AMOUNT
  // ═══════════════════════════════════════════════════════

  const repayAmount = BigInt(repayDto.repaymentAmount);
  const remainingDebt = BigInt(loan.remainingDebt);

  if (repayAmount > remainingDebt) {
    throw new BadRequestException(
      `Repayment exceeds remaining debt of $${ethers.formatUnits(remainingDebt, 6)}`
    );
  }

  // ═══════════════════════════════════════════════════════
  // STEP 3: VERIFY USDC TRANSFER (if txHash provided)
  // ═══════════════════════════════════════════════════════

  if (repayDto.repaymentTxHash) {
    const tx = await this.provider.getTransactionReceipt(repayDto.repaymentTxHash);
    // TODO: Verify transaction details (to address, amount, etc.)
  }

  // ═══════════════════════════════════════════════════════
  // STEP 4: EXECUTE ON-CHAIN REPAYMENT
  // ═══════════════════════════════════════════════════════

  const platformWallet = new ethers.Wallet(
    this.configService.get('PLATFORM_PRIVATE_KEY'),
    this.provider
  );

  const solvencyVault = new ethers.Contract(
    this.configService.get('SOLVENCY_VAULT_ADDRESS'),
    SOLVENCY_VAULT_ABI,
    platformWallet
  );

  const usdcContract = new ethers.Contract(
    this.configService.get('USDC_ADDRESS'),
    ['function approve(address spender, uint256 amount) returns (bool)'],
    platformWallet
  );

  // Approve USDC spending
  const approveTx = await usdcContract.approve(
    solvencyVault.address,
    repayAmount
  );
  await approveTx.wait();

  // Call repayLoan on SolvencyVault
  const repayTx = await solvencyVault.repayLoan(
    loan.solvencyPositionId,
    repayAmount
  );

  const receipt = await repayTx.wait();

  // ═══════════════════════════════════════════════════════
  // STEP 5: UPDATE LOAN RECORD
  // ═══════════════════════════════════════════════════════

  const newRemainingDebt = remainingDebt - repayAmount;
  const newStatus = newRemainingDebt === 0n
    ? PartnerLoanStatus.REPAID
    : PartnerLoanStatus.ACTIVE;

  await this.partnerLoanModel.findByIdAndUpdate(loan._id, {
    remainingDebt: newRemainingDebt.toString(),
    totalRepaid: (BigInt(loan.totalRepaid) + repayAmount).toString(),
    lastRepaymentAt: new Date(),
    status: newStatus,
    repayTxHash: newStatus === PartnerLoanStatus.REPAID ? receipt.hash : loan.repayTxHash,
    $push: {
      repaymentHistory: {
        amount: repayAmount.toString(),
        timestamp: new Date(),
        txHash: receipt.hash,
        repaidBy: RepaymentSource.PARTNER,
      },
    },
  });

  // ═══════════════════════════════════════════════════════
  // STEP 6: UPDATE POSITION
  // ═══════════════════════════════════════════════════════

  if (newStatus === PartnerLoanStatus.REPAID) {
    await this.solvencyPositionService.markPartnerLoanRepaid(
      loan.solvencyPositionId,
      loan.internalLoanId
    );
  }

  // ═══════════════════════════════════════════════════════
  // STEP 7: UPDATE PARTNER STATS
  // ═══════════════════════════════════════════════════════

  await this.partnerModel.findByIdAndUpdate(partner._id, {
    $inc: {
      currentOutstanding: (-repayAmount).toString(),
      totalRepaid: repayAmount.toString(),
    },
  });

  // ═══════════════════════════════════════════════════════
  // STEP 8: LOG OPERATION
  // ═══════════════════════════════════════════════════════

  await this.logPartnerApiCall(partner, 'POST /partners/repay', {
    loanId: loan.partnerLoanId,
    amount: repayAmount.toString(),
    success: true,
  });

  // ═══════════════════════════════════════════════════════
  // STEP 9: WEBHOOK NOTIFICATION (if configured)
  // ═══════════════════════════════════════════════════════

  if (partner.webhookUrl && newStatus === PartnerLoanStatus.REPAID) {
    await this.sendWebhook(partner, 'loan.repaid', {
      partnerLoanId: loan.partnerLoanId,
      internalLoanId: loan.internalLoanId,
      totalRepaid: (BigInt(loan.totalRepaid) + repayAmount).toString(),
      timestamp: new Date().toISOString(),
    });
  }

  // ═══════════════════════════════════════════════════════
  // STEP 10: RETURN RESPONSE
  // ═══════════════════════════════════════════════════════

  return {
    success: true,
    remainingDebt: newRemainingDebt.toString(),
    loanStatus: newStatus,
    txHash: receipt.hash,
    message: newStatus === PartnerLoanStatus.REPAID
      ? 'Loan fully repaid'
      : 'Partial repayment processed',
  };
}
```

---

## Security Considerations

### 1. API Key Security

**Generation:**
```typescript
const crypto = require('crypto');

// Generate random API key
const randomPart = crypto.randomBytes(16).toString('hex');
const apiKey = `pk_${partnerPrefix}_live_${randomPart}`;

// Hash for storage (SHA-256)
const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');

// Store only hash in database
// Show plaintext to partner ONCE during creation
```

**Validation:**
```typescript
const crypto = require('crypto');

// Hash incoming key
const inputHash = crypto.createHash('sha256').update(incomingApiKey).digest('hex');

// Compare with stored hash
const partner = await partnerModel.findOne({ apiKey: inputHash });
```

**Best Practices:**
- Never log API keys
- Never return API keys in GET requests
- Show plaintext only once during creation
- Support key rotation via regeneration endpoint
- Expire old keys after rotation grace period

### 2. Request Signing (Optional Enhancement)

For extra security, partners can sign requests using HMAC:

```typescript
// Partner generates signature
const payload = JSON.stringify(requestBody);
const timestamp = Date.now();
const signature = crypto
  .createHmac('sha256', apiKeySecret)
  .update(`${timestamp}.${payload}`)
  .digest('hex');

// Headers
Authorization: Bearer pk_xyz_live_...
X-Timestamp: 1704567890123
X-Signature: a1b2c3d4e5f6...

// Backend validates
const expectedSignature = crypto
  .createHmac('sha256', partner.apiKeySecret)
  .update(`${timestamp}.${payload}`)
  .digest('hex');

if (signature !== expectedSignature) {
  throw new UnauthorizedException('Invalid signature');
}

// Check timestamp freshness (prevent replay attacks)
if (Date.now() - timestamp > 300000) { // 5 minutes
  throw new UnauthorizedException('Request expired');
}
```

### 3. IP Whitelisting (Optional)

```typescript
// In partner config
{
  "ipWhitelist": ["203.0.113.0/24", "198.51.100.5"]
}

// Validation in guard
const clientIP = request.ip;
if (!partner.ipWhitelist.some(range => ipInRange(clientIP, range))) {
  throw new ForbiddenException('IP not whitelisted');
}
```

### 4. Webhook Security

When sending webhooks to partners:

```typescript
const crypto = require('crypto');

const payload = JSON.stringify(webhookData);
const signature = crypto
  .createHmac('sha256', partner.webhookSecret)
  .update(payload)
  .digest('hex');

// HTTP headers
X-Webhook-Signature: sha256=a1b2c3d4...
X-Webhook-Event: loan.borrowed | loan.repaid | loan.defaulted
X-Webhook-Timestamp: 1704567890123

// Partner validates
const expectedSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex');

if (`sha256=${expectedSignature}` !== headers['x-webhook-signature']) {
  // Invalid webhook, reject
}
```

### 5. Rate Limiting

```typescript
import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class RateLimitService {
  constructor(private redisService: RedisService) {}

  async checkRateLimit(partnerId: string, tier: string): Promise<boolean> {
    const limits = {
      BASIC: 100,
      PREMIUM: 500,
      ENTERPRISE: 2000,
    };

    const limit = limits[tier];
    const currentMinute = Math.floor(Date.now() / 60000);
    const key = `ratelimit:partner:${partnerId}:${currentMinute}`;

    const current = await this.redisService.incr(key);

    if (current === 1) {
      // Set expiry on first request
      await this.redisService.expire(key, 60);
    }

    return current <= limit;
  }
}
```

### 6. Input Validation

```typescript
import { IsString, IsNumber, IsEthereumAddress, IsPositive, Matches } from 'class-validator';

export class PartnerBorrowDto {
  @IsNumber()
  @IsPositive()
  oaidTokenId!: number;

  @IsEthereumAddress()
  userWallet!: string;

  @IsString()
  @Matches(/^\d+$/) // Must be numeric string (for BigInt)
  borrowAmount!: string;

  @IsString()
  @Matches(/^[a-zA-Z0-9_-]+$/)
  partnerLoanId!: string;

  @IsOptional()
  metadata?: any;
}
```

---

## Integration Examples

### Partner SDK (JavaScript/TypeScript)

**File:** `partner-sdk/index.ts`

```typescript
import axios, { AxiosInstance } from 'axios';

export interface CreditLineResponse {
  oaidTokenId: number;
  creditLimit: string;
  creditUsed: string;
  availableCredit: string;
  active: boolean;
  owner: string;
}

export interface BorrowRequest {
  oaidTokenId: number;
  userWallet: string;
  borrowAmount: string;
  partnerLoanId: string;
  metadata?: any;
}

export interface BorrowResponse {
  success: boolean;
  internalLoanId: string;
  borrowedAmount: string;
  netAmountTransferred: string;
  platformFee: string;
  remainingCredit: string;
  txHash: string;
  message: string;
}

export interface RepayRequest {
  partnerLoanId: string;
  repaymentAmount: string;
  repaymentTxHash?: string;
}

export interface RepayResponse {
  success: boolean;
  remainingDebt: string;
  loanStatus: string;
  txHash: string;
  message: string;
}

export class MantleRWAPartnerSDK {
  private client: AxiosInstance;

  constructor(
    private apiKey: string,
    baseUrl = 'https://api.mantle-rwa.com'
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Get user's credit line (public, no auth needed)
   */
  async getCreditLine(oaidTokenId: number): Promise<CreditLineResponse> {
    const response = await this.client.get(
      `/partners/public/oaid/${oaidTokenId}/credit-line`
    );
    return response.data;
  }

  /**
   * Borrow on behalf of user (requires API key)
   */
  async borrow(params: BorrowRequest): Promise<BorrowResponse> {
    const response = await this.client.post(
      '/partners/borrow',
      params,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  }

  /**
   * Report repayment (requires API key)
   */
  async repay(params: RepayRequest): Promise<RepayResponse> {
    const response = await this.client.post(
      '/partners/repay',
      params,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  }

  /**
   * Get loan details
   */
  async getLoan(partnerLoanId: string) {
    const response = await this.client.get(
      `/partners/loan/${partnerLoanId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  }

  /**
   * Get user's loans through your platform
   */
  async getUserLoans(
    userWallet: string,
    status?: 'ACTIVE' | 'REPAID'
  ) {
    const response = await this.client.get(
      `/partners/user/${userWallet}/loans`,
      {
        params: { status },
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  }

  /**
   * Get partner statistics
   */
  async getStats() {
    const response = await this.client.get(
      '/partners/my/stats',
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      }
    );
    return response.data;
  }
}

// Usage example
const sdk = new MantleRWAPartnerSDK('pk_xyz_live_a1b2c3d4...');

// Check user's credit
const credit = await sdk.getCreditLine(123);
console.log(`Available: $${Number(credit.availableCredit) / 1e6}`);

// Borrow for user
const loan = await sdk.borrow({
  oaidTokenId: 123,
  userWallet: '0xUser...',
  borrowAmount: '5000000000', // $5000 USDC
  partnerLoanId: 'our_loan_12345',
  metadata: {
    partnerUserId: 'user_xyz_456',
    loanPurpose: 'invoice_financing',
  },
});

console.log(`Borrowed! TX: ${loan.txHash}`);
```

### Integration Flow Example

```typescript
// Partner platform integration example

import { MantleRWAPartnerSDK } from '@mantle-rwa/partner-sdk';

const mantleSDK = new MantleRWAPartnerSDK(process.env.MANTLE_API_KEY);

// When user requests a loan on partner platform
app.post('/api/loans/create', async (req, res) => {
  const { userId, oaidTokenId, amount } = req.body;

  // 1. Get user details from your database
  const user = await db.users.findOne({ id: userId });

  // 2. Check available credit on Mantle RWA
  const credit = await mantleSDK.getCreditLine(oaidTokenId);

  if (BigInt(credit.availableCredit) < BigInt(amount)) {
    return res.status(400).json({
      error: 'Insufficient credit available',
    });
  }

  // 3. Create loan record in your database
  const partnerLoan = await db.loans.create({
    userId,
    oaidTokenId,
    amount,
    status: 'PENDING',
  });

  try {
    // 4. Borrow from Mantle RWA
    const result = await mantleSDK.borrow({
      oaidTokenId,
      userWallet: user.walletAddress,
      borrowAmount: amount,
      partnerLoanId: partnerLoan.id,
      metadata: {
        partnerUserId: userId,
        loanPurpose: req.body.purpose,
      },
    });

    // 5. Update your database
    await db.loans.update(partnerLoan.id, {
      status: 'ACTIVE',
      mantleTxHash: result.txHash,
      mantleLoanId: result.internalLoanId,
      disbursedAmount: result.netAmountTransferred,
      platformFee: result.platformFee,
    });

    // 6. Disburse to user (your platform's logic)
    await disburseFundsToUser(userId, result.netAmountTransferred);

    res.json({
      success: true,
      loanId: partnerLoan.id,
      amount: result.borrowedAmount,
      txHash: result.txHash,
    });
  } catch (error) {
    // Handle error
    await db.loans.update(partnerLoan.id, { status: 'FAILED' });
    res.status(500).json({ error: error.message });
  }
});

// When user repays loan on partner platform
app.post('/api/loans/:loanId/repay', async (req, res) => {
  const { loanId } = req.params;
  const { amount } = req.body;

  const loan = await db.loans.findOne({ id: loanId });

  try {
    // 1. Collect repayment from user (your platform's logic)
    await collectRepaymentFromUser(loan.userId, amount);

    // 2. Report repayment to Mantle RWA
    const result = await mantleSDK.repay({
      partnerLoanId: loanId,
      repaymentAmount: amount,
    });

    // 3. Update your database
    await db.loans.update(loanId, {
      remainingDebt: result.remainingDebt,
      status: result.loanStatus === 'REPAID' ? 'REPAID' : 'ACTIVE',
      repayTxHash: result.txHash,
    });

    res.json({
      success: true,
      remainingDebt: result.remainingDebt,
      status: result.loanStatus,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## Testing Strategy

### Unit Tests

```typescript
// partner-auth.guard.spec.ts
describe('PartnerApiKeyGuard', () => {
  it('should reject requests without API key');
  it('should reject invalid API key');
  it('should reject suspended partner');
  it('should allow valid active partner');
  it('should attach partner to request');
});

// partner-loan.service.spec.ts
describe('PartnerLoanService - Borrow', () => {
  it('should reject borrow for non-owned OAID');
  it('should reject borrow with inactive credit line');
  it('should reject borrow exceeding credit limit');
  it('should reject borrow exceeding partner daily limit');
  it('should reject borrow exceeding partner total limit');
  it('should reject duplicate loan ID');
  it('should successfully process valid borrow');
  it('should charge correct platform fee');
  it('should update all relevant database records');
  it('should transfer correct amount to partner');
});

describe('PartnerLoanService - Repay', () => {
  it('should reject repayment for non-existent loan');
  it('should reject repayment for already repaid loan');
  it('should reject overpayment');
  it('should successfully process partial repayment');
  it('should successfully process full repayment');
  it('should update loan status correctly');
  it('should send webhook on full repayment');
});
```

### Integration Tests

```typescript
// partner-integration.e2e.spec.ts
describe('Partner Integration E2E', () => {
  let partnerApiKey: string;
  let userWallet: Wallet;
  let oaidTokenId: number;

  beforeAll(async () => {
    // Setup: Create partner, deposit collateral, mint OAID
  });

  it('should allow partner to check credit line without auth', async () => {
    const response = await request(app.getHttpServer())
      .get(`/partners/public/oaid/${oaidTokenId}/credit-line`)
      .expect(200);

    expect(response.body.oaidTokenId).toBe(oaidTokenId);
    expect(response.body.active).toBe(true);
  });

  it('should reject borrow without API key', async () => {
    await request(app.getHttpServer())
      .post('/partners/borrow')
      .send({
        oaidTokenId,
        userWallet: userWallet.address,
        borrowAmount: '1000000000',
        partnerLoanId: 'test_001',
      })
      .expect(401);
  });

  it('should allow partner to borrow on behalf of user', async () => {
    const response = await request(app.getHttpServer())
      .post('/partners/borrow')
      .set('Authorization', `Bearer ${partnerApiKey}`)
      .send({
        oaidTokenId,
        userWallet: userWallet.address,
        borrowAmount: '1000000000',
        partnerLoanId: 'test_001',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.txHash).toBeDefined();

    // Verify on-chain
    const position = await solvencyVault.positions(positionId);
    expect(position.usdcBorrowed.toString()).toBe('1000000000');

    // Verify database
    const loan = await partnerLoanModel.findOne({ partnerLoanId: 'test_001' });
    expect(loan).toBeDefined();
    expect(loan.status).toBe('ACTIVE');
  });

  it('should allow partner to report repayment', async () => {
    const response = await request(app.getHttpServer())
      .post('/partners/repay')
      .set('Authorization', `Bearer ${partnerApiKey}`)
      .send({
        partnerLoanId: 'test_001',
        repaymentAmount: '1000000000',
      })
      .expect(200);

    expect(response.body.loanStatus).toBe('REPAID');

    // Verify database
    const loan = await partnerLoanModel.findOne({ partnerLoanId: 'test_001' });
    expect(loan.status).toBe('REPAID');
    expect(loan.remainingDebt).toBe('0');
  });

  it('should enforce partner daily limits', async () => {
    // TODO: Test daily limit enforcement
  });

  it('should enforce partner total limits', async () => {
    // TODO: Test total limit enforcement
  });
});
```

### Load Testing

```javascript
// k6 load test script
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 50 },   // Ramp up
    { duration: '3m', target: 100 },  // Steady state
    { duration: '1m', target: 0 },    // Ramp down
  ],
};

const API_KEY = __ENV.PARTNER_API_KEY;
const BASE_URL = 'https://api.mantle-rwa.com';

export default function () {
  // Test borrow endpoint
  const borrowPayload = JSON.stringify({
    oaidTokenId: 123,
    userWallet: '0x...',
    borrowAmount: '1000000000',
    partnerLoanId: `load_test_${__VU}_${__ITER}`,
  });

  const borrowRes = http.post(
    `${BASE_URL}/partners/borrow`,
    borrowPayload,
    {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  check(borrowRes, {
    'borrow status is 201': (r) => r.status === 201,
    'borrow response has txHash': (r) => JSON.parse(r.body).txHash !== undefined,
  });
}
```

---

## Monitoring & Observability

### Metrics to Track

**Prometheus Metrics:**

```typescript
import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class PartnerMetricsService {
  private readonly apiRequestsTotal: Counter;
  private readonly apiRequestDuration: Histogram;
  private readonly borrowTotalUsdc: Counter;
  private readonly repayTotalUsdc: Counter;
  private readonly outstandingDebtUsdc: Gauge;
  private readonly dailyLimitUsage: Gauge;
  private readonly apiErrorsTotal: Counter;

  constructor() {
    this.apiRequestsTotal = new Counter({
      name: 'partner_api_requests_total',
      help: 'Total number of partner API requests',
      labelNames: ['partner_id', 'endpoint', 'status_code'],
    });

    this.apiRequestDuration = new Histogram({
      name: 'partner_api_request_duration_seconds',
      help: 'Partner API request duration',
      labelNames: ['partner_id', 'endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5],
    });

    this.borrowTotalUsdc = new Counter({
      name: 'partner_borrow_total_usdc',
      help: 'Total USDC borrowed by partner',
      labelNames: ['partner_id'],
    });

    this.repayTotalUsdc = new Counter({
      name: 'partner_repay_total_usdc',
      help: 'Total USDC repaid through partner',
      labelNames: ['partner_id'],
    });

    this.outstandingDebtUsdc = new Gauge({
      name: 'partner_outstanding_debt_usdc',
      help: 'Current outstanding debt for partner',
      labelNames: ['partner_id'],
    });

    this.dailyLimitUsage = new Gauge({
      name: 'partner_daily_limit_usage',
      help: 'Partner daily limit usage ratio',
      labelNames: ['partner_id'],
    });

    this.apiErrorsTotal = new Counter({
      name: 'partner_api_errors_total',
      help: 'Total number of partner API errors',
      labelNames: ['partner_id', 'error_type'],
    });
  }

  recordRequest(partnerId: string, endpoint: string, statusCode: number, duration: number) {
    this.apiRequestsTotal.inc({ partner_id: partnerId, endpoint, status_code: statusCode });
    this.apiRequestDuration.observe({ partner_id: partnerId, endpoint }, duration);
  }

  recordBorrow(partnerId: string, amount: bigint) {
    this.borrowTotalUsdc.inc({ partner_id: partnerId }, Number(amount) / 1e6);
  }

  recordRepay(partnerId: string, amount: bigint) {
    this.repayTotalUsdc.inc({ partner_id: partnerId }, Number(amount) / 1e6);
  }

  updateOutstandingDebt(partnerId: string, amount: bigint) {
    this.outstandingDebtUsdc.set({ partner_id: partnerId }, Number(amount) / 1e6);
  }

  updateDailyLimitUsage(partnerId: string, usage: number) {
    this.dailyLimitUsage.set({ partner_id: partnerId }, usage);
  }

  recordError(partnerId: string, errorType: string) {
    this.apiErrorsTotal.inc({ partner_id: partnerId, error_type: errorType });
  }
}
```

### Alerts

```yaml
# Prometheus alert rules
groups:
  - name: partner_platform
    interval: 30s
    rules:
      - alert: PartnerDailyLimitApproaching
        expr: partner_daily_limit_usage > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Partner {{ $labels.partner_id }} approaching daily limit"
          description: "Daily limit usage is at {{ $value | humanizePercentage }}"

      - alert: PartnerApiErrorRateHigh
        expr: rate(partner_api_errors_total[5m]) > 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate for partner {{ $labels.partner_id }}"
          description: "Error rate is {{ $value | humanize }} errors/second"

      - alert: PartnerOutstandingDebtHigh
        expr: partner_outstanding_debt_usdc / partner_total_limit > 0.9
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Partner {{ $labels.partner_id }} near total limit"
          description: "Outstanding debt is {{ $value | humanizePercentage }} of total limit"

      - alert: UnauthorizedApiKeyAttempts
        expr: rate(partner_api_requests_total{status_code="401"}[1m]) > 10
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "High rate of unauthorized API attempts"
          description: "Possible security breach or misconfigured client"

      - alert: PartnerApiSlowResponse
        expr: histogram_quantile(0.95, partner_api_request_duration_seconds) > 5
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Slow API response for partner {{ $labels.partner_id }}"
          description: "95th percentile response time is {{ $value | humanizeDuration }}"
```

### Dashboard (Grafana)

```json
{
  "dashboard": {
    "title": "Partner Platform Analytics",
    "panels": [
      {
        "title": "Active Partners",
        "type": "stat",
        "targets": [
          {
            "expr": "count(count by (partner_id) (partner_api_requests_total))"
          }
        ]
      },
      {
        "title": "Total Outstanding Debt",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(partner_outstanding_debt_usdc)"
          }
        ]
      },
      {
        "title": "Daily Borrow Volume",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(partner_borrow_total_usdc[1d])) by (partner_id)"
          }
        ]
      },
      {
        "title": "API Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(partner_api_requests_total[5m])) by (endpoint, status_code)"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(partner_api_errors_total[5m])) by (partner_id, error_type)"
          }
        ]
      },
      {
        "title": "Response Time (P95)",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(partner_api_request_duration_seconds_bucket[5m]))"
          }
        ]
      }
    ]
  }
}
```

---

## Partner Documentation

### Quick Start Guide

**File:** `/docs/partner-integration-guide.md`

```markdown
# Mantle RWA Partner Integration Guide

## Getting Started

### 1. Request Partner Account

Contact: partnerships@mantle-rwa.com

Provide:
- Company name
- Use case description
- Expected monthly volume
- Business registration documents

### 2. Complete KYC

Submit:
- Business registration
- Compliance documentation
- Beneficial ownership information

### 3. Receive API Credentials

You'll receive:
- **Partner ID**: `partner_xyz_001`
- **API Key**: `pk_xyz_live_a1b2c3d4...` ⚠️ Store securely!
- **Sandbox URL**: `https://sandbox-api.mantle-rwa.com`
- **Production URL**: `https://api.mantle-rwa.com`
- **Documentation**: https://docs.mantle-rwa.com

### 4. Integration

#### Install SDK

```bash
npm install @mantle-rwa/partner-sdk
```

#### Basic Usage

```javascript
import { MantleRWAPartnerSDK } from '@mantle-rwa/partner-sdk';

const sdk = new MantleRWAPartnerSDK(
  'pk_xyz_live_...',
  'https://api.mantle-rwa.com'
);

// Check user's credit (no auth needed)
const credit = await sdk.getCreditLine(123);
console.log(`Available: $${Number(credit.availableCredit) / 1e6}`);

// Borrow for user
const loan = await sdk.borrow({
  oaidTokenId: 123,
  userWallet: '0xUser...',
  borrowAmount: '5000000000', // $5000
  partnerLoanId: 'your_loan_id',
});

console.log(`Success! TX: ${loan.txHash}`);
```

## API Reference

### Authentication

All authenticated endpoints require:

```
Authorization: Bearer YOUR_API_KEY
Content-Type: application/json
```

### Endpoints

#### GET /partners/public/oaid/:id/credit-line

Check user's credit line (no auth required).

**Response:**
```json
{
  "oaidTokenId": 123,
  "creditLimit": "10000000000",
  "creditUsed": "2000000000",
  "availableCredit": "8000000000",
  "active": true
}
```

#### POST /partners/borrow

Borrow on behalf of user.

**Request:**
```json
{
  "oaidTokenId": 123,
  "userWallet": "0x...",
  "borrowAmount": "5000000000",
  "partnerLoanId": "your_loan_id"
}
```

**Response:**
```json
{
  "success": true,
  "internalLoanId": "uuid-...",
  "borrowedAmount": "5000000000",
  "netAmountTransferred": "4975000000",
  "platformFee": "25000000",
  "txHash": "0x...",
  "message": "Loan successfully processed"
}
```

## Error Handling

| Code | Error | Description |
|------|-------|-------------|
| 401 | Unauthorized | Invalid API key |
| 403 | Forbidden | Partner suspended or limit exceeded |
| 400 | Bad Request | Invalid parameters or insufficient credit |
| 404 | Not Found | OAID or loan not found |
| 429 | Too Many Requests | Rate limit exceeded |

## Rate Limits

| Tier | Requests/Minute |
|------|-----------------|
| BASIC | 100 |
| PREMIUM | 500 |
| ENTERPRISE | 2000 |

## Best Practices

1. **API Key Security**
   - Store API keys in environment variables
   - Never commit to version control
   - Rotate keys periodically

2. **Error Handling**
   - Implement retry logic with exponential backoff
   - Log all API calls for debugging
   - Monitor error rates

3. **Testing**
   - Use sandbox environment for development
   - Test edge cases thoroughly
   - Verify webhook signatures

## Support

- **Documentation**: https://docs.mantle-rwa.com
- **API Status**: https://status.mantle-rwa.com
- **Support Email**: support@mantle-rwa.com
- **Emergency**: security@mantle-rwa.com
```

---

## Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Tasks:**
- [x] Create database schemas (Partner, PartnerLoan, PartnerApiLog)
- [x] Update SolvencyPosition schema with partner loan tracking
- [x] Create partner config system (`partner_platforms.json`)
- [x] Implement API key generation utility
- [x] Set up database migrations

**Deliverables:**
- Database schemas implemented
- Config system ready
- API key generation working

---

### Phase 2: Core API (Week 2)

**Tasks:**
- [x] Implement PartnerService (API key validation)
- [x] Implement PartnerApiKeyGuard
- [x] Create PartnerLoanService (borrow logic)
- [x] Create PartnerLoanService (repay logic)
- [x] Implement PartnerController (borrow, repay endpoints)
- [ ] Add rate limiting (Redis-based)
- [x] Add audit logging

**Deliverables:**
- Borrow endpoint functional
- Repay endpoint functional
- Authentication working
- Rate limiting active

---

### Phase 3: Admin Tools (Week 3)

**Tasks:**
- [x] Implement PartnerAdminController
- [x] Create partner endpoint
- [x] Regenerate API key endpoint
- [x] Update partner endpoint
- [ ] Suspend/activate partner endpoints
- [ ] Partner analytics endpoint
- [ ] Audit log viewer

**Deliverables:**
- Admin panel for partner management
- Analytics dashboard
- Complete audit trail

---

### Phase 4: Security & Polish (Week 4)

**Tasks:**
- [ ] Implement request signing (optional)
- [ ] Add IP whitelisting (optional)
- [ ] Implement webhook system
- [ ] Webhook signature verification
- [ ] Enhanced error handling
- [ ] Input validation refinement
- [ ] Security audit

**Deliverables:**
- Enhanced security features
- Webhook system operational
- Production-ready error handling

---

### Phase 5: Documentation & SDK (Week 5)

**Tasks:**
- [ ] Write partner integration guide
- [ ] Create API documentation (Swagger/OpenAPI)
- [ ] Build JavaScript/TypeScript SDK
- [ ] Create integration examples
- [ ] Write testing guide
- [ ] Create troubleshooting guide

**Deliverables:**
- Complete documentation
- Partner SDK published
- Integration examples

---

### Phase 6: Testing & Launch (Week 6)

**Tasks:**
- [ ] Unit tests (services, guards, controllers)
- [ ] Integration tests (E2E flows)
- [ ] Load testing (k6)
- [ ] Security testing
- [ ] Set up monitoring (Prometheus, Grafana)
- [ ] Configure alerts
- [ ] Sandbox environment launch
- [ ] Partner onboarding process

**Deliverables:**
- Complete test coverage
- Monitoring dashboard
- Sandbox environment live
- Ready for production

---

## Key Design Decisions

### 1. Why API Keys Instead of Wallet Signatures?

**Rationale:**
- Partners are platforms/companies, not individual users
- Easier integration with existing backend systems
- Standard HTTP Bearer token authentication
- Better suited for high-frequency operations
- No need for wallet management on partner side

**Alternative Considered:** Wallet-based authentication like user authentication
**Rejected Because:** Would require partners to manage private keys, sign every request, not suitable for automated systems

---

### 2. Why Route Through Backend Instead of Direct Contract Calls?

**Rationale:**
- **Security**: Partners can't directly manipulate positions they don't own
- **Control**: Enforce limits, fees, compliance checks
- **Audit Trail**: Complete visibility into all operations
- **Flexibility**: Can change contract logic without breaking integrations
- **Fee Collection**: Automatic platform fee deduction

**Alternative Considered:** Allow partners to call contract functions directly
**Rejected Because:** Security risk, no fee enforcement, difficult to audit, hard to change

---

### 3. Why Track Partner Loans Separately?

**Rationale:**
- Clear attribution of debt source (our platform vs partners)
- Different repayment flows per partner
- Partner-specific analytics and reporting
- Easier reconciliation and settlement
- Support for multi-partner loans per position

**Alternative Considered:** Just add partner field to existing position
**Rejected Because:** Can't support multiple partners per position, harder to track, poor separation of concerns

---

### 4. Platform Fee Structure

**Rationale:**
- Fees charged to partner (not end user) - partner chooses how to pass through
- Basis points allow flexible pricing (50 bps = 0.5%)
- Deducted at borrow time before USDC transfer
- Different tiers get different rates (incentivize volume)
- Fair compensation for providing infrastructure

**Alternative Considered:** Charge end users directly
**Rejected Because:** Complicates user experience, partners can't set their own margins

---

### 5. Database Over Smart Contract for Partner Loans

**Rationale:**
- Off-chain tracking more flexible (can add fields without contract upgrades)
- Cheaper (no gas costs for tracking)
- Faster queries for analytics
- Eventual consistency with on-chain state acceptable
- Can support complex repayment scenarios

**Alternative Considered:** Store all partner loan data on-chain
**Rejected Because:** Expensive, inflexible, harder to query, overkill for this use case

---

## Next Steps

Once you approve this plan, we can proceed with implementation in phases. I recommend:

1. **Review this document** - Add any missing requirements
2. **Prioritize features** - Decide which are MVP vs nice-to-have
3. **Set up infrastructure** - Redis, monitoring, etc.
4. **Begin Phase 1** - Start with database schemas and config

Would you like to proceed with implementation, or do you have any questions/changes to the plan?

---

**Document Version:** 1.0
**Last Updated:** 2026-01-05
**Status:** Awaiting Approval
