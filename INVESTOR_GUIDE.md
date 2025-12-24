# Investor Guide: How to Buy RWA Tokens

This guide walks you through the process of purchasing Real World Asset (RWA) tokens on the Mantle RWA Platform.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Step 1: Get KYC Verified](#step-1-get-kyc-verified)
- [Step 2: Fund Your Wallet with USDC](#step-2-fund-your-wallet-with-usdc)
- [Step 3: Browse Marketplace Listings](#step-3-browse-marketplace-listings)
- [Step 4: Purchase Tokens](#step-4-purchase-tokens)
- [After Purchase](#after-purchase)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you can purchase RWA tokens, you need:

1. **A Web3 Wallet** (e.g., MetaMask) configured for Mantle Sepolia Testnet
   - Network Name: `Mantle Sepolia`
   - RPC URL: `https://rpc.sepolia.mantle.xyz`
   - Chain ID: `5003`
   - Currency Symbol: `MNT`
   - Block Explorer: `https://explorer.sepolia.mantle.xyz`

2. **MNT tokens** for gas fees (available from Mantle Sepolia faucet)

3. **USDC tokens** for purchasing (Mock USDC on testnet)

---

## Step 1: Get KYC Verified

Before purchasing tokens, your wallet address must be registered and KYC verified.

### Option A: Self-Registration (If Available)
```bash
# Contact platform admin to register your wallet address
# Provide: Your wallet address for KYC verification
```

### Option B: Admin Registration
The platform admin will register your wallet address:

```javascript
// Admin runs:
node scripts/register-investor.js <YOUR_WALLET_ADDRESS>
```

**Verification:**
You can check if you're verified by calling the Identity Registry contract:
```javascript
// Contract: IdentityRegistry
// Function: isVerified(address wallet) returns (bool)
```

---

## Step 2: Fund Your Wallet with USDC

You need USDC (stablecoin) to purchase RWA tokens.

### On Testnet (Mock USDC)
```bash
# Get Mock USDC from admin or faucet
# USDC Contract: 0xfD61dC86e7799479597c049D7b19e6E638adDdd0
```

**Minimum Amount Needed:**
- Check the asset's `minInvestment` requirement
- Example: If min investment is 1000 tokens at 1 USDC/token = 1000 USDC minimum

---

## Step 3: Browse Marketplace Listings

### API Endpoint: Get All Listings

**Request:**
```bash
curl -X GET "https://api.mantle-rwa.com/marketplace/listings" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

**Response:**
```json
{
  "success": true,
  "count": 1,
  "listings": [
    {
      "assetId": "4d02feaa-7b32-4c35-980f-5710b73a982a",
      "tokenAddress": "0x6591b5A3b79850ab530244BF9A262036A3667575",
      "name": "INV-2025-590349 - Tech Solutions Inc",
      "industry": "Technology",
      "faceValue": "100000",
      "currency": "USD",
      "riskTier": "A",
      "dueDate": "2025-07-01T00:00:00.000Z",
      "totalSupply": "100000",
      "pricePerToken": "1000000",
      "minInvestment": "1000",
      "listingType": "STATIC",
      "listedAt": "2025-12-24T16:41:29.278Z",
      "status": "TOKENIZED"
    }
  ]
}
```

### API Endpoint: Get Listing Details

**Request:**
```bash
curl -X GET "https://api.mantle-rwa.com/marketplace/listings/<ASSET_ID>" \
  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"
```

**Key Information to Note:**
- `pricePerToken`: Price in USDC (with 6 decimals)
- `minInvestment`: Minimum tokens you must buy
- `totalSupply`: Total tokens available
- `tokenAddress`: Contract address of the RWA token

---

## Step 4: Purchase Tokens

Purchasing tokens happens **directly on-chain** via the PrimaryMarket smart contract.

### Smart Contract Details
- **Contract:** PrimaryMarketplace
- **Address:** `0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615`
- **Function:** `buyTokens(bytes32 assetId, uint256 amount)`

### Purchase Process

#### 4.1: Approve USDC Spending

First, approve the PrimaryMarketplace to spend your USDC:

```javascript
// USDC Contract: 0xfD61dC86e7799479597c049D7b19e6E638adDdd0
// Function: approve(address spender, uint256 amount)

const USDC = new ethers.Contract(usdcAddress, USDC_ABI, signer);
const marketplace = "0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615";

// Calculate payment needed
const pricePerToken = 1000000; // 1 USDC (6 decimals)
const tokenAmount = 1000; // tokens to buy
const totalSupplyWei = ethers.parseUnits(tokenAmount.toString(), 18);
const payment = (BigInt(pricePerToken) * totalSupplyWei) / BigInt(10 ** 18);

// Approve USDC
await USDC.approve(marketplace, payment);
```

#### 4.2: Buy Tokens

Call the `buyTokens` function on the PrimaryMarketplace:

```javascript
// Convert Asset ID to bytes32
const assetId = "4d02feaa-7b32-4c35-980f-5710b73a982a";
const assetIdBytes32 = '0x' + assetId.replace(/-/g, '').padEnd(64, '0');

// Buy tokens
const PrimaryMarketplace = new ethers.Contract(
  marketplaceAddress,
  MARKETPLACE_ABI,
  signer
);

const tokenAmountWei = ethers.parseUnits("1000", 18); // 1000 tokens
const tx = await PrimaryMarketplace.buyTokens(assetIdBytes32, tokenAmountWei);

// Wait for confirmation
const receipt = await tx.wait();
console.log('Purchase complete!', receipt.hash);
```

### Using the Helper Script

We provide a script to simplify the purchase process:

```bash
# Syntax: node scripts/buy-tokens.js <ASSET_ID> <TOKEN_AMOUNT>
node scripts/buy-tokens.js 4d02feaa-7b32-4c35-980f-5710b73a982a 1000

# The script will:
# 1. Calculate payment required
# 2. Approve USDC spending
# 3. Execute the purchase
# 4. Show transaction details
```

---

## After Purchase

### What Happens Next

1. **Tokens in Your Wallet**
   - RWA tokens are transferred to your wallet immediately
   - Check your balance: `RWAToken.balanceOf(yourAddress)`

2. **Backend Updates**
   - The backend listens for `TokensPurchased` events
   - Your purchase is recorded in the database
   - Transaction history is updated

3. **Token Benefits**
   - **Yield Distribution**: Receive proportional yield payments
   - **Transfer Rights**: Can transfer tokens to other verified investors
   - **Redemption**: Tokens can be redeemed at maturity

### Check Your Token Balance

```javascript
const RWAToken = new ethers.Contract(tokenAddress, TOKEN_ABI, provider);
const balance = await RWAToken.balanceOf(yourAddress);
console.log('Your balance:', ethers.formatUnits(balance, 18), 'tokens');
```

### View Your Purchase on Explorer

```
https://explorer.sepolia.mantle.xyz/tx/<YOUR_TX_HASH>
```

---

## Troubleshooting

### Common Errors

#### 1. "Compliance check failed"
**Cause:** Your wallet is not KYC verified
**Solution:** Contact admin to register your wallet address

```bash
# Admin runs:
node scripts/register-investor.js <YOUR_WALLET_ADDRESS>
```

#### 2. "Insufficient USDC balance"
**Cause:** Not enough USDC in your wallet
**Solution:** Get more USDC tokens

```bash
# On testnet, get Mock USDC:
node scripts/mint-usdc.js <YOUR_WALLET_ADDRESS> 10000
```

#### 3. "Below min investment"
**Cause:** Trying to buy less than minimum required
**Solution:** Buy at least the `minInvestment` amount shown in listing

#### 4. "Insufficient supply"
**Cause:** Not enough tokens available in listing
**Solution:** Buy a smaller amount or wait for more supply

#### 5. "ERC20: insufficient allowance"
**Cause:** Haven't approved USDC spending
**Solution:** Approve USDC before buying (see Step 4.1)

---

## Summary: Quick Purchase Checklist

- [ ] Wallet configured for Mantle Sepolia
- [ ] MNT tokens for gas
- [ ] KYC verified (wallet registered)
- [ ] USDC tokens in wallet (≥ purchase amount)
- [ ] Browse marketplace and select asset
- [ ] Approve USDC spending
- [ ] Call `buyTokens()` on PrimaryMarketplace
- [ ] Wait for transaction confirmation
- [ ] Check token balance

---

## Support

For questions or issues:
- **Documentation**: [Link to docs]
- **Support Email**: support@mantle-rwa.com
- **Discord**: [Link to Discord]

---

## Technical Reference

### Contract Addresses (Mantle Sepolia)

```json
{
  "PrimaryMarketplace": "0x444a6f69FC9411d0ea9627CbDdBD3Dfa563aE615",
  "IdentityRegistry": "0xD93911f05958b017F43DAcF99A0eB9a1EB91431d",
  "USDC": "0xfD61dC86e7799479597c049D7b19e6E638adDdd0",
  "TokenFactory": "0x094A619b6E7e851C128317795266468552F4e964"
}
```

### API Base URL
```
https://api.mantle-rwa.com
```

### Required Headers
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

---

**Last Updated:** December 24, 2025
**Platform Version:** v1.0.0
