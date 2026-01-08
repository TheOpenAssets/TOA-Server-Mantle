# Solvency Vault & Repayment Integration Guide

This document outlines the complete workflow for integrating the Solvency Vault, including depositing collateral, borrowing, tracking repayments, and handling liquidations.

## 1. Overview

The Solvency system allows investors to:
1.  **Deposit RWA Tokens** (or Private Assets) as collateral.
2.  **Borrow USDC** against that collateral with a fixed repayment schedule.
3.  **Track Repayments** via a detailed schedule.
4.  **Repay Loans** in installments.
5.  **Monitor Credit** via the OAID system.

## 2. Key Workflows & Endpoints


### B. Borrow USDC (with Schedule)
**User Action:** User chooses a loan amount, duration, and number of installments.

*   **Endpoint:** `POST /solvency/borrow`
*   **Payload:**
    ```json
    {
      "positionId": "1",
      "amount": "50000000", // 50 USDC (6 decimals)
      "loanDuration": 2592000, // Seconds (e.g., 30 days)
      "numberOfInstallments": 3
    }
    ```
*   **Response:** Updates position, initializes repayment schedule.
*   **Script:** `scripts/borrow-solvency-loan.js` (Auto-calculates duration from asset maturity).

### C. View Repayment Schedule
**User Action:** User views their active loan details.

*   **Endpoint:** `GET /solvency/position/:id/schedule`
*   **Response:**
    ```json
    {
      "success": true,
      "positionId": 1,
      "outstandingDebt": "50000027", // Total debt in Wei (Principal + Interest)
      "schedule": {
        "loanDuration": 2592000,
        "numberOfInstallments": 3,
        "installmentInterval": 864000,
        "nextPaymentDue": 1738972200, // Unix Timestamp
        "installmentsPaid": 0,
        "missedPayments": 0,
        "isActive": true,
        "details": [
          {
            "installmentNumber": 1,
            "dueDate": "2026-02-07T10:00:00.000Z",
            "amount": "16666666",
            "status": "PENDING"
          },
          ...
        ]
      }
    }
    ```

### D. Repay Loan
**User Action:** User makes a payment.

*   **Endpoint:** `POST /solvency/repay`
*   **Payload:**
    ```json
    {
      "positionId": "1",
      "amount": "16666666" // USDC amount to repay
    }
    ```
*   **Backend Logic:** 
    *   Accepts payment.
    *   Updates `installmentsPaid`.
    *   Marks next pending installment as `PAID`.
    *   Reduces `outstandingDebt`.
    *   Updates OAID credit usage.
*   **Script:** `scripts/repay-solvency-loan.js`

### E. Credit Monitoring (OAID)
**User Action:** User checks their credit score and utilization.

*   **Endpoint:** `GET /solvency/oaid/my-credit`
*   **Response:**
    ```json
    {
      "totalCreditLimit": "100000000",
      "totalCreditUsed": "50000000",
      "utilizationRate": "50.00%",
      "creditLines": [...]
    }
    ```
*   **Script:** `scripts/check-oaid-credit.js`

## 3. Administrative & Automation Workflows

### A. Repayment Monitor (Backend Cron)
*   **Function:** Runs every minute (for testing).
*   **Logic:**
    *   Checks active positions.
    *   If `now > nextPaymentDueDate`:
        *   Marks installment as `MISSED`.
        *   Increments `missedPayments`.
        *   Calls `SolvencyVault.markMissedPayment()` (On-Chain).
        *   Sends Notification (WARNING).
    *   If `missedPayments >= 3`:
        *   Marks position as `DEFAULTED`.
        *   Calls `SolvencyVault.markDefaulted()` (On-Chain).
        *   Sends Notification (CRITICAL - Liquidation Risk).

### B. Manual Default Trigger (Testing)
*   **Script:** `scripts/admin-mark-missed-payment.js <position_id>`
*   **Usage:** Run this 3 times to force a position into default state for testing liquidation.

### C. Liquidation
*   **Trigger:** Admin or Keeper calls `liquidatePosition`.
*   **Endpoint:** `POST /admin/solvency/liquidate/:id`
*   **Conditions:**
    *   Health Factor < 115% OR
    *   Position marked as `DEFAULTED` (via `markDefaulted`).
*   **Outcome:**
    *   Position status -> `LIQUIDATED`.
    *   Collateral is seized (locked in vault for settlement).
    *   OAID Credit Line revoked.

### D. Settlement (Yield Distribution)
*   **Trigger:** When the underlying Asset generates yield (e.g., Invoice paid).
*   **Action:** Admin distributes yield.
*   **Endpoint:** `POST /yield/distribute/:settlementId`
*   **Logic:**
    1.  Distributes yield to standard token holders.
    2.  **Auto-Detects Liquidated Positions:** Finds SolvencyVault positions holding this asset that are `LIQUIDATED`.
    3.  **Settles Position:**
        *   Burns RWA collateral.
        *   Uses yield to repay Senior Pool debt.
        *   Takes Liquidation Fee.
        *   Refunds excess USDC to borrower.
        *   Marks position as `SETTLED`.

## 4. Helper Scripts Reference

All scripts require `INVESTOR_KEY` (for user actions) or `ADMIN_KEY` (for admin actions) in `.env` or prepended.

| Script | Purpose | Usage |
|--------|---------|-------|
| `deposit-to-solvency-vault.js` | Create position & deposit tokens | `node scripts/deposit-to-solvency-vault.js <asset_id> <amount>` |
| `borrow-solvency-loan.js` | Borrow USDC (auto-calculates duration) | `node scripts/borrow-solvency-loan.js <pos_id> <amount> <installments>` |
| `repay-solvency-loan.js` | Repay loan installment | `node scripts/repay-solvency-loan.js <pos_id> [amount]` |
| `check-oaid-credit.js` | View OAID credit stats | `node scripts/check-oaid-credit.js <wallet>` |
| `admin-mark-missed-payment.js` | (Admin) Force missed payment | `node scripts/admin-mark-missed-payment.js <pos_id>` |

## 5. Contract Addresses (Mantle Sepolia)

*   **SolvencyVault:** `0x9019F4B9bBE67b27f6972019264655ef7a08298e`
*   **OAID:** `0x307cEEceB3A0ed74E4cE711C8b8033FCB2d635F0`
*   **SeniorPool:** `0xBb0EB3a41bC859dabd3386679d6368458525471E`
*   **LeverageVault:** `0xe2A3493DBD10701E642A76267Cc2C4e036D238d0`
