# KYC System Implementation Summary

**Date:** December 20, 2025
**Status:** Implemented & Verified (Upgraded with Real QR & OCR)

## Overview

The KYC (Know Your Customer) system is implemented as a dedicated `KycModule`. It handles multi-format document uploads, queue-based background processing, and robust verification using QR code decoding and OCR (Optical Character Recognition).

## Architecture

1.  **Document Upload:**
    *   **Endpoint:** `POST /api/kyc/upload`
    *   **Accepted Formats:** PDF, JPEG, JPG, PNG (Max 5MB).
    *   **Queue:** Jobs are offloaded to BullMQ (`kyc-verification` queue) for async processing.

2.  **Verification Pipeline (`VerificationProcessor`):**
    *   **PDF Processing:** Extracts raw text using `pdf-parse`.
    *   **Image Processing:**
        *   **QR Decoding:** Uses `jimp` and `jsqr` to extract and parse Aadhaar XML/Secure QR data.
        *   **OCR Extraction:** Uses `tesseract.js` to perform full-text extraction from images.
    *   **Cross-Verification Logic:**
        *   Extracts Name and UID from decoded QR XML.
        *   Matches QR data against OCR-extracted text (Fuzzy matching).
        *   Calculates a **Verification Score** (0-100).
        *   **Pass Threshold:** 80+ points.

3.  **Data Persistence:**
    *   **User Schema:** Stores document metadata, status (`VERIFIED`, `REJECTED`, `PROCESSING`), and detailed verification results (`verificationMeta`).

## File Structure

```text
packages/backend/src/modules/kyc/
├── kyc.module.ts                   # Module config (BullMQ, Mongoose, Providers)
├── controllers/
│   └── kyc.controller.ts           # API Endpoints with Multer interceptors
├── services/
│   ├── kyc.service.ts              # Business logic (Upload orchestration, Status)
│   └── document-storage.service.ts # Local filesystem storage abstraction
└── processors/
    └── verification.processor.ts   # Background worker (QR, OCR, Scoring)
```

## API Endpoints

| Method | Path | Protected | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/kyc/upload` | Yes (JWT) | Uploads PDF/Image. Returns `documentId`. |
| `GET` | `/kyc/status` | Yes (JWT) | Returns KYC status, score, and document details. |
| `DELETE` | `/kyc/documents` | Yes (JWT) | Deletes unverified documents and clears status. |

## Dependencies

*   `@nestjs/bullmq` & `bullmq`: Job queue management.
*   `jimp` & `jsqr`: Image processing and QR code decoding.
*   `tesseract.js`: Tesseract OCR engine for Node.js.
*   `pdf-parse`: Text extraction from PDF files.
*   `xml2js`: Parsing Aadhaar QR XML data.

## Security & Reliability

*   **Async Processing:** Heavy OCR/QR tasks don't block the main thread.
*   **Error Handling:** Documents are marked as `REJECTED` with specific reasons if processing fails.
*   **Decoupled Storage:** Storage is abstracted, allowing easy migration to AWS S3 or GridFS.