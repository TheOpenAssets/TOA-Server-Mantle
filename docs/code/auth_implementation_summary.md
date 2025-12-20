# Authentication System Implementation Summary

**Date:** December 20, 2025
**Status:** Implemented & Verified (Refactored for Schema Separation)

## Overview

This document summarizes the implementation of the authentication system for the Mantle RWA Platform's backend. The system uses a hybrid session management strategy combining **Redis** for fast, short-lived access tokens and **MongoDB** for persistent, revocable refresh tokens.

## Architecture Highlights

1.  **Hybrid Token Storage:**
    *   **Access Tokens (15 min):** Stored in **Redis**. This allows for quick verification and immediate revocation (e.g., on logout or security events).
    *   **Refresh Tokens (7 days):** Stored in **MongoDB** in a dedicated `UserSession` collection. This ensures persistence and supports token rotation while keeping the user profile clean.

2.  **Wallet-Based Authentication:**
    *   Uses **SIWE (Sign-In with Ethereum)** style flows.
    *   **Challenge-Response:** User requests a nonce, signs it, and sends it back.
    *   **Verification:** Uses `viem` to verify Ethereum signatures.

3.  **Security Measures:**
    *   **Nonce Validation:** Prevents replay attacks using Redis-backed nonces (60s TTL).
    *   **Refresh Token Rotation:** Every refresh request invalidates the old refresh token and issues a new pair.
    *   **Strict Typing:** Full TypeScript implementation with strict mode enabled.
    *   **Guards:**
        *   `JwtAuthGuard`: Checks JWT validity + existence in Redis.
        *   `KycAuthGuard`: Enforces `user.kyc === true`.

## Implementation Details

### 1. Dependencies Added
*   **Auth:** `@nestjs/passport`, `passport-jwt`, `@nestjs/jwt`
*   **Database:** `@nestjs/mongoose`, `mongoose`
*   **Cache:** `ioredis`
*   **Web3:** `viem` (for signature verification)
*   **Utils:** `uuid`, `class-validator`, `class-transformer`

### 2. File Structure

```text
packages/backend/src/
├── app.module.ts                   # Root module importing Auth, Redis, Mongo
├── config/
│   ├── database.config.ts          # MongoDB configuration
│   └── redis.config.ts             # Redis configuration
├── database/
│   └── schemas/
│       ├── user.schema.ts          # User profile data (wallet, role, kyc)
│       └── session.schema.ts       # Session data (refresh tokens, history)
└── modules/
    ├── auth/
    │   ├── auth.module.ts
    │   ├── controllers/
    │   │   └── auth.controller.ts  # Endpoints: /auth/challenge, login, refresh, logout, me
    │   ├── dto/
    │   │   └── auth.dto.ts         # Validation DTOs (Challenge, Login, Refresh)
    │   ├── guards/
    │   │   ├── jwt-auth.guard.ts   # Standard JWT check
    │   │   └── kyc-auth.guard.ts   # Checks user.kyc flag
    │   ├── services/
    │   │   ├── auth.service.ts     # Core logic (Token gen, Redis/Mongo ops)
    │   │   └── signature.service.ts# Viem verification wrapper
    │   └── strategies/
    │       └── jwt.strategy.ts     # Passport strategy with Redis lookup
    └── redis/
        ├── redis.module.ts         # Global Redis module
        └── redis.service.ts        # Redis client wrapper
```

### 3. Database Schemas

#### User Schema (`users`)
Stores core identity and compliance status.

```typescript
{
  _id: ObjectId,
  walletAddress: String (Unique, Indexed),
  role: Enum('INVESTOR', 'ORIGINATOR', 'ADMIN'),
  kyc: Boolean,
  timestamps: true
}
```

#### UserSession Schema (`usersessions`)
Stores ephemeral session state and audit trails, decoupled from the user profile.

```typescript
{
  _id: ObjectId,
  user: ObjectId (Reference to User),
  walletAddress: String (Indexed),
  currentRefreshToken: {
    jti: String,
    exp: Date,
    deviceHash: String,
    issuedAt: Date
  },
  sessionHistory: Array<{
    refreshTokenId: String,
    createdAt: Date,
    revokedAt?: Date,
    ipAddress?: String
  }>,
  timestamps: true
}
```

### 4. API Endpoints

| Method | Path | Protected | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/auth/challenge` | No | Generates a random nonce for signing. |
| `POST` | `/auth/login` | No | Verifies signature, creates user if new, issues tokens. |
| `POST` | `/auth/refresh` | No | Rotates refresh token, issues new access token. |
| `POST` | `/auth/logout` | **Yes** | Invalidates Access (Redis) and Refresh (Mongo) tokens. |
| `GET` | `/auth/me` | **Yes** | Returns current user profile. |

## Configuration Requirements

Ensure the following environment variables are set (or rely on defaults for local dev):

*   `JWT_SECRET`: Secret key for signing tokens.
*   `MONGODB_URI`: Connection string for MongoDB (default: `mongodb://localhost:27017/mantle-rwa`).
*   `REDIS_HOST`: Redis host (default: `localhost`).
*   `REDIS_PORT`: Redis port (default: `6379`).

## Next Steps

1.  **Frontend Integration:** Connect the frontend wallet provider (e.g., RainbowKit) to the `/auth/challenge` and `/auth/login` endpoints.
2.  **KYC Workflow:** Implement the logic (likely a webhook or admin endpoint) to flip the `user.kyc` boolean to `true` upon verification.