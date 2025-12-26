# RWA Platform Pricing Model

## Overview
This document explains the pricing model for both STATIC and AUCTION asset types, including platform fees, yield margins, and quantile-based auction settlement.

## Business Model

### Platform Fee
- **Fee**: 1.5% of invoice face value
- **Deducted from**: Final raise amount
- **Purpose**: Platform operational costs

### Yield Margin
- **Minimum Margin**: 5% (including platform fee)
- **Purpose**: Ensure investors get returns on their investment
- **Calculation**: Face Value - Raised Amount = Yield Pool

## Pricing Calculations

### Example: $100,000 Invoice

```
Face Value:        $100,000
Platform Fee:      $1,500 (1.5%)
Max After Fee:     $98,500

With 5% Yield Margin:
Max Raise:         $95,000 (95%)
Min Raise:         $80,000 (80%) [originator's minimum acceptable]

For 100,000 tokens:
Max Price/Token:   $0.95 ($95,000 / 100,000)
Min Price/Token:   $0.80 ($80,000 / 100,000)
```

### Yield Distribution
```
If raised $95,000:
- Yield Pool:      $5,000 ($100,000 - $95,000)
- Platform Fee:    $1,500 (from yield pool)
- Investor Yield:  $3,500 (remaining)
- Yield %:         ~3.68% ($3,500 / $95,000)
```

## Asset Upload Parameters

### For BOTH Static and Auction

| Parameter | Type | Description | Example |
|-----------|------|-------------|---------|
| `faceValue` | string | Invoice face value in USD (no decimals) | "100000" |
| `totalSupply` | string | Total tokens with 18 decimals | "100000000000000000000000" |
| `minRaisePercentage` | string | Min % of face value to raise | "80" |
| `maxRaisePercentage` | string | Max % of face value (default 95%) | "95" |
| `minInvestment` | string | Minimum investment per user (18 decimals) | "1000000000000000000000" |

### STATIC Specific
- `pricePerToken`: Calculated automatically as `(faceValue * maxRaisePercentage / 100) / totalSupply`

### AUCTION Specific
- `auctionDuration`: Duration in seconds
- Price range calculated automatically:
  - Min Price = `(faceValue * minRaisePercentage / 100) / totalSupply`
  - Max Price = `(faceValue * maxRaisePercentage / 100) / totalSupply`

## Auction Mechanics

### Bidding Phase
1. Investors submit bids with:
   - Token quantity desired
   - Limit price per token (between min and max)
2. Bids are sealed (not visible to other bidders)
3. USDC is escrowed in the contract

### Price Discovery
1. After auction ends, system sorts bids by price (highest first)
2. Calculates clearing price where total tokens can be sold
3. All winning bids pay the same clearing price
4. Example:
```
Total Supply: 100,000 tokens

Bids:
- 21,000 tokens @ $0.90
- 15,000 tokens @ $0.85
- 30,000 tokens @ $0.87
- 40,000 tokens @ $0.80

Sorted:
- 21,000 @ $0.90 = 21,000 cumulative
- 30,000 @ $0.87 = 51,000 cumulative
- 15,000 @ $0.85 = 66,000 cumulative
- 40,000 @ $0.80 = 106,000 cumulative ✓ (exceeds 100,000)

Clearing Price: $0.80
All bids >= $0.80 win and pay $0.80/token
```

### Quantile-Based Settlement (Undersold Auctions)

If total bid quantity < total supply, use quantile approach:

| Tokens Bid | Quantile | Tokens Sold | Remaining |
|------------|----------|-------------|-----------|
| 75,000 - 99,999 | 75% | 75% of tokens | → Static listing |
| 50,000 - 74,999 | 50% | 50% of tokens | → Static listing |
| 25,000 - 49,999 | 25% | 25% of tokens | → Static listing |
| < 25,000 | 0% | Auction fails | All refunded |

#### Quantile Example
```
Total Supply: 100,000 tokens
Total Bids:   60,000 tokens (60%)

Quantile: 50% (since 60k is between 50k-75k)

Settlement:
- Sell: 50% of 100,000 = 50,000 tokens
- Remaining: 50,000 tokens → Static listing at the clearing price of auction 
```

#### Rationale
Prevents race to bottom pricing. If we're undersold, better to sell fewer tokens at better prices than all tokens at lowest bid.

## Settlement Logic

### Winning Bids
1. Calculate tokens to allocate (may be reduced by quantile)
2. Calculate cost: `clearingPrice * tokensAllocated`
3. Refund overpayment: `bidDeposit - cost`
4. Transfer tokens to bidder
5. Transfer payment to platform custody

### Losing Bids (price < clearingPrice)
1. Full refund of deposited USDC
2. No tokens allocated

### Oversubscription Protection
If allocated tokens > remaining supply (shouldn't happen with proper clearing calculation):
1. Reduce allocation to remaining supply
2. Refund accordingly

## Smart Contract Implementation Status

### ✅ Implemented
- Bid submission with USDC escrow
- Basic auction end with clearing price
- Settlement with refunds
- Oversubscription protection

### ❌ Not Yet Implemented
- **Quantile-based settlement logic**
- Platform fee calculation and distribution
- Automatic transfer of unsold tokens to static listing
- Yield pool tracking

## Next Steps

1. **Update Smart Contract** ([PrimaryMarket.sol](../../packages/contracts/contracts/marketplace/PrimaryMarket.sol)):
   - Implement quantile settlement logic
   - Add platform fee handling
   - Add transition to static listing for unsold tokens

2. **Update Auction Service** ([auction.service.ts](../../packages/backend/src/modules/marketplace/services/auction.service.ts)):
   - Implement quantile calculation in `calculateAndEndAuction()`
   - Handle partial settlement scenarios

3. **Add Tests**:
   - Contract tests for quantile scenarios
   - Service tests for price calculations
   - E2E tests for undersold auctions

## References
- Implementation: [asset-lifecycle.service.ts](../../packages/backend/src/modules/assets/services/asset-lifecycle.service.ts#L40-L130)
- Smart Contract: [PrimaryMarket.sol](../../packages/contracts/contracts/marketplace/PrimaryMarket.sol)
- Upload Script: [upload-auction-asset.sh](../../scripts/upload-auction-asset.sh)
