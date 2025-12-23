# KYC Module Testing Summary

**Date:** December 20, 2025
**Status:** Implemented & Verified

## Overview

This document summarizes the unit testing strategy and implementation for the KYC (Know Your Customer) module. The tests focus on the `KycService` orchestration and the `VerificationProcessor` image analysis logic, ensuring robust handling of uploads, verification algorithms, and status updates.

## Test Suites

### 1. KYC Service Tests
**File:** `packages/backend/src/modules/kyc/services/kyc.service.spec.ts`

**Tests:**
*   `uploadDocument`: 
    *   Verifies file storage call.
    *   Verifies DB update (status: PROCESSING).
    *   Verifies Queue job addition.
    *   Checks error handling for existing/verified users.
*   `getStatus`: Verifies data retrieval from User schema.
*   `deleteDocument`: Verifies file deletion and DB cleanup (checks Forbidden for verified docs).

### 2. Verification Processor Tests
**File:** `packages/backend/src/modules/kyc/processors/verification.processor.spec.ts`

**Mocks:**
*   `tesseract.js`: Mocked to return simulated OCR text.
*   `jsqr`: Mocked to return simulated QR code data (Aadhaar XML).
*   `jimp`: Mocked image loading.
*   `xml2js`: Mocked XML parsing.

**Tests:**
*   **Successful Verification (Image):**
    *   **Scenario:** Image contains a valid QR code (with Name/UID) and OCR text matching that data.
    *   **Action:** Mocks return matching data ("John Doe", "4701").
    *   **Result:** 
        *   Status: `VERIFIED`.
        *   Score: >= 80.
        *   DB Update: `kyc: true`.
*   **Rejection (Image):**
    *   **Scenario:** Image has no QR code and OCR text contains random noise.
    *   **Action:** Mocks return `null` for QR and random text for OCR.
    *   **Result:**
        *   Status: `REJECTED`.
        *   DB Update: `kyc: false`, rejection reason logged.

## Running Tests

To execute all tests:

```bash
yarn workspace @mantle/backend test
```

## Coverage

*   **Total Tests:** 16 tests across Auth, KYC Service, and Verification Processor.
*   **Status:** All Passing.