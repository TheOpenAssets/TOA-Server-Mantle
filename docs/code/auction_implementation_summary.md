# Uniform Price Auction Implementation Summary

**Date:** December 25, 2025
**Status:** Implemented

## 1. Overview

This document summarizes the technical changes made to implement a **Uniform Price Auction** mechanism for primary token sales. This system replaces the previous Dutch Auction model and runs in parallel with the existing static price sale model.

## 2. Smart Contract Changes (`PrimaryMarket.sol`)

The `PrimaryMarket.sol` contract was significantly updated to facilitate the three-phase auction lifecycle (Bidding, Discovery, Settlement).

### Key Modifications:

1.  **Auction and Bid Structs:**
    *   Added a `Bid` struct to store bidder information, token amount, limit price, and USDC deposit.
    *   Updated the `Listing` struct to include auction-specific fields like `reservePrice`, `endTime`, `clearingPrice`, and `auctionPhase`.

2.  **State Management:**
    *   A new mapping `mapping(bytes32 => Bid[]) public bids;` was added to store all bids for a given auction.
    *   The `ListingType` enum is now used to differentiate between `STATIC` and `AUCTION` listings.

3.  **New Functions:**
    *   `submitBid(assetId, tokenAmount, price)`: Allows investors to submit bids. It validates the bid against auction rules, and escrows the required USDC amount directly within the contract.
    *   `endAuction(assetId, clearingPrice)`: An owner-only function to finalize the bidding phase. It sets the official `clearingPrice` calculated by the backend.
    *   `settleBid(assetId, bidIndex)`: Allows bidders to finalize their position post-auction. It handles the distribution of tokens to winners and issues refunds for failed bids or overpayments.

4.  **Event Emitters:**
    *   New events `BidSubmitted`, `AuctionEnded`, and `BidSettled` were added to provide off-chain services with the necessary data to track the auction's progress.

## 3. Backend Changes

The backend was updated to support the new auction logic, from creation and price calculation to event processing.

### 3.1. Database Schemas

*   **`bid.schema.ts` (New):**
    *   A new `Bid` schema was created to store a persistent, off-chain record of each bid, including its status (`PENDING`, `WON`, `LOST`, `SETTLED`). This allows for efficient querying and display on the frontend.
*   **`asset.schema.ts` (Updated):**
    *   The `listing` sub-document was updated to include `reservePrice` and `phase` ('BIDDING', 'ENDED') to track auction-specific data.

### 3.2. Services and Logic

*   **`AuctionService` (New):**
    *   `createAuction`: Orchestrates the creation of a new auction listing by calling the `listOnMarketplace` method in the `BlockchainService`.
    *   `calculateAndEndAuction`: Contains the core price discovery logic. It fetches all bids for a completed auction, sorts them by price, and calculates the `clearingPrice` at which the total supply is met or exceeded. It then calls the `endAuction` method on the smart contract.

*   **`BlockchainService` (Updated):**
    *   The `listOnMarketplace` function was updated to match the new `createListing` signature in the smart contract, removing the `endPrice` parameter.
    *   A new `endAuction` method was added to provide an interface for the `AuctionService` to submit the calculated `clearingPrice` to the blockchain.

*   **`EventListenerService` (Updated):**
    *   The `watchPrimaryMarketplace` method was expanded to listen for the new `BidSubmitted`, `AuctionEnded`, and `BidSettled` events, queuing them for processing.

*   **`EventProcessor` (Updated):**
    *   New handlers were added to process the auction-related events from the queue. This includes creating `Bid` documents in MongoDB, updating the auction's status in the `Asset` document, and marking bids as `WON`, `LOST`, or `SETTLED`.

### 3.3. API Endpoints

*   **`AssetOpsController` (Admin):**
    *   `POST /admin/assets/auctions/create`: A new endpoint for administrators to create a new auction listing.
    *   `POST /admin/assets/auctions/end`: A new endpoint for administrators to trigger the end of an auction, which initiates the price calculation and finalization on-chain.

## 4. Summary of Changes

The implementation of the Uniform Price Auction required a full-stack effort:
- **Contracts:** Re-architected the `PrimaryMarket` contract's auction logic.
- **Database:** Introduced a `Bid` schema and expanded the `Asset` schema.
- **Backend:** Added a new `AuctionService` for business logic, updated the `BlockchainService` for contract interaction, and expanded the event listening and processing capabilities.
- **API:** Exposed new admin endpoints for auction management.

This new auction system is now fully integrated with the existing platform architecture.
