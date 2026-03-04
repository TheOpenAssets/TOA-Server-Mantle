# CLAUDE.md — Open Assets Backend

## Project Summary

Open Assets is a Real-World Asset (RWA) tokenization platform that enables the full lifecycle of bringing real-world assets on-chain — from originator onboarding and KYC verification, through asset attestation and token deployment, to primary marketplace listing (static pricing and auctions), secondary P2P trading, yield distribution, and settlement.

The platform is built as a NestJS monorepo with three packages: a backend REST API, Solidity smart contracts, and shared TypeScript types. The backend orchestrates 17 domain modules — Auth, Admin, Assets, Blockchain, KYC, Marketplace, Secondary Market, Yield, Leverage, Solvency, Partners, Notifications, Announcements, Changelog, Compliance Engine, Faucet, and Typeform — all communicating through NestJS dependency injection with MongoDB for persistence, Redis/BullMQ for async event processing, and a global Blockchain module that handles all on-chain interactions.

The on-chain layer consists of 17 deployed smart contracts on Mantle Sepolia covering asset attestation (AttestationRegistry), identity verification (IdentityRegistry, OAID), token lifecycle (TokenFactory, RWAToken, PrivateAssetToken), marketplace operations (PrimaryMarket, SecondaryMarket), financial infrastructure (YieldVault, SolvencyVault, LeverageVault, SeniorPool), and integrations (FluxionDEX, MockUSDC, MockMETH, Faucet). The backend listens for contract events via block polling every 3 seconds, processes them through BullMQ queues, and synchronizes on-chain state with the MongoDB database.

Key platform capabilities include: originator-driven asset creation with admin approval workflows, ERC-20 token deployment per asset, dual marketplace model (fixed-price and Dutch auctions), investor KYC with on-chain identity registration, automated yield distribution to token holders, a leverage system allowing mETH-collateralized positions for amplified RWA exposure, a solvency vault for borrowing against RWA collateral with OAID credit lines, partner API integrations for external lending, and a secondary P2P order book for token trading.

Currently, every blockchain interaction is tightly coupled to the Mantle/EVM ecosystem through the `viem` library and a hardcoded Mantle Sepolia chain definition imported across 5 service files. This plan introduces a network-agnostic architecture to support Stellar (and future networks) alongside Mantle through adapter patterns, a config-driven service registry, and conditional module loading — all without code changes between deployments.

---

## Tech Stack

* Framework: NestJS (TypeScript)
* Database: MongoDB (Mongoose)
* API Style: REST 
* Validation: class-validator
* Linting/Formatting: ESLint + Prettier

## Core Principles

### 1. Modular Architecture

* Each domain must be isolated in its own module
* No cross-module direct DB access
* Communicate via services and DTOs

### 2. Separation of Concerns

* Controllers: HTTP layer only
* Services: Business logic only
* Repositories/Models: Data access only
* Guards/Interceptors/Middleware: Cross-cutting concerns


### 4. Explicit Domain Boundaries

Core domains:

* Auth
* Admin
* Assets
* Blockchain
* Changelog
* kyc
* leverage
* marketplace
* notifs and anouncements
* partners
* secondary marketplace
* solvency 
* yield

Each domain:

* Owns its schemas
* Owns its DTOs
* Owns its services


### 6. Data Integrity

* Use enums for statuses
* Validate all input with DTOs
* Never trust OAuth profile data blindly

### 7. Observability

* Centralized logging
* Request IDs
* Structured logs


### 8. Identifiers

* Use UUID v4 for all public-facing identifiers
* MongoDB `_id` (ObjectId) is for internal use only
* APIs must return and accept `uuid` strings
* `uuid` fields must be indexed and unique

---


# Status Enums (Example)

* DRAFT
* PENDING_APPROVAL
* APPROVED
* REJECTED
* ARCHIVED

---

# Naming Conventions

* DTOs: CreateEventDto, UpdateHackathonDto
* Schemas: event.schema.ts
* Enums: *.enum.ts
* Services: Single responsibility

---

# Example Approval Flow

1. Organizer creates Hackathon
2. Status = PENDING_APPROVAL
3. Admin reviews
4. Admin sets APPROVED or REJECTED
5. Only APPROVED is publicly visible

---

# Folder Context Rules (context.md)

Every domain/module folder MUST contain a `context.md` file.

## Purpose

* `context.md` is the source of truth for that folder
* It explains:

  * Responsibilities
  * Public interfaces
  * Invariants
  * Dependencies on other modules

## Rule of Exploration (Mandatory)

* Any engineer or AI agent MUST read `context.md` before:

  * Modifying code in that folder
  * Adding new files
  * Refactoring logic

## Rule of Modification (Mandatory)

* If any code in a folder is changed, the corresponding `context.md` MUST be updated to reflect:

  * New responsibilities
  * Changed APIs
  * New invariants or assumptions
  * Deprecated behavior

## Enforcement

* PRs without updated `context.md` (when applicable) should be rejected
* Code reviewers must verify `context.md` accuracy

---

# Philosophy

This backend is a long-term ecosystem which currenlty is on evm but ewe are not only making it chain agnostic but also network agnostic . So We will be working to support stellar.
Design for:

* Clarity over cleverness
* Strong domain modeling
* Clean audit trails


### RULES 

## Rule of plans

Plans should be human readable high level docs containing all the nitty gritties about how the work will be done but not the code, no pointers. Be as expressive as u can while planning but with words not with code .

## Rule of Package Manager

Our package  wil be mantained by the bun intrinsically

## Rule of build 

Anyone is not allowed to run build .

## Rule of paths

PAths shall now look like ../../../service 
but shall look like @/src/module/service for clear readability This will enhance our code readability a lot.

## Rule of API logging 

Every route shall be documented by swagger response , payload and everything