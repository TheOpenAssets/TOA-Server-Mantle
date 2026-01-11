# Partner Onboarding & Creation Guide

**Version:** 1.0
**Date:** 2026-01-10
**Status:** Production Ready

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Partner Tiers](#partner-tiers)
3. [Creating a Partner](#creating-a-partner)
4. [Partner Integration Documentation](#partner-integration-documentation)
5. [API Endpoints](#api-endpoints)
6. [Testing](#testing)
7. [Going Live](#going-live)

---

## Overview

This guide walks you through the complete process of onboarding a new partner platform to the RWA lending system.

### What is a Partner?

A **partner** is an external lending platform that integrates with your RWA system to:
- Borrow USDC on behalf of users using OAID credit lines
- Process loan repayments
- Track loan status and history
- Provide lending services to end users

### Partner Integration Flow

```
┌─────────────┐
│   Partner   │ ◄─── 1. Create Partner (Admin)
│  Platform   │      2. Get API Key
└──────┬──────┘      3. Integrate APIs
       │             4. Test Integration
       │             5. Go Live
       ▼
┌─────────────────┐
│  User borrows   │
│  through partner│
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ RWA System      │
│ executes loan   │
└─────────────────┘
```

---

## Partner Tiers

### Tier Comparison

| Feature | BASIC | PREMIUM | ENTERPRISE |
|---------|-------|---------|------------|
| **Daily Borrow Limit** | $50,000 | $100,000 | $500,000 |
| **Total Borrow Limit** | $200,000 | $500,000 | $2,000,000 |
| **Platform Fee** | 0.75% | 0.50% | 0.25% |
| **API Rate Limit** | 100/min | 500/min | 2000/min |
| **Support Level** | Email | Priority Email | Dedicated Support |
| **Webhooks** | ❌ No | ✅ Yes | ✅ Yes |
| **Custom Terms** | ❌ No | ❌ No | ✅ Yes |

### Choosing the Right Tier

**BASIC:** Good for:
- New partners testing the integration
- Low-volume lending platforms
- Pilot programs

**PREMIUM:** Good for:
- Established lending platforms
- Medium-volume operations
- Require webhook notifications

**ENTERPRISE:** Good for:
- Large lending platforms
- High-volume operations
- Custom fee arrangements
- Dedicated account management

---

## Creating a Partner

### Prerequisites

Before creating a partner, you need:

1. ✅ **Admin Access** - Admin wallet private key
2. ✅ **Partner Information:**
   - Partner name (e.g., "XYZ Lending")
   - Partner prefix (e.g., "xyz") - used in API key
   - Settlement wallet address (where USDC is sent)
   - Contact email
   - Desired tier (BASIC, PREMIUM, ENTERPRISE)

### Option 1: Using the Admin Script (Recommended)

**Simple Creation:**

```bash
# Basic tier
ADMIN_KEY=0x1d12932a... \
PARTNER_SETTLEMENT_ADDRESS=0xPartnerWallet... \
PARTNER_EMAIL=contact@xyz.com \
node scripts/admin-create-partner.js "XYZ Lending" xyz BASIC

# Premium tier
ADMIN_KEY=0x1d12932a... \
PARTNER_SETTLEMENT_ADDRESS=0xPartnerWallet... \
PARTNER_EMAIL=contact@abc.com \
node scripts/admin-create-partner.js "ABC Finance" abc PREMIUM
```

**Environment Variables:**

- `ADMIN_KEY` - Required: Admin wallet private key
- `PARTNER_SETTLEMENT_ADDRESS` - Optional: Partner's USDC settlement address
- `PARTNER_EMAIL` - Optional: Partner contact email
- `BACKEND_URL` - Optional: Backend API URL (default: http://localhost:3000)

**Output:**

The script will display:
- ✅ Partner ID
- 🔑 **API Key** (shown only once!)
- 📊 Partner configuration
- 📝 Next steps

**Example Output:**

```
✨ Partner Created Successfully!

🔑 API CREDENTIALS (Save these securely - API key shown only once!)
────────────────────────────────────────────────────────────
  Partner ID:    partner_xyz_001
  API Key:       pk_xyz_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
────────────────────────────────────────────────────────────

📊 Partner Details:
  Name:                  XYZ Lending
  Status:                ACTIVE
  Tier:                  PREMIUM
  Created:               2026-01-10 10:00:00

💰 Limits:
  Daily Borrow Limit:    $100,000
  Total Borrow Limit:    $500,000
  Platform Fee:          0.50%
```

### Option 2: Using the API Directly

**1. Get Admin JWT Token:**

```bash
# Get admin token
ADMIN_TOKEN=$(ADMIN_KEY=0x1d12932a... node scripts/get-admin-token.js)
```

**2. Create Partner:**

```bash
curl -X POST http://localhost:3000/admin/partners \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "partnerName": "XYZ Lending",
    "partnerPrefix": "xyz",
    "tier": "PREMIUM",
    "dailyBorrowLimit": "100000000000",
    "totalBorrowLimit": "500000000000",
    "platformFeePercentage": 50,
    "settlementAddress": "0xPartnerWallet...",
    "contactEmail": "contact@xyz.com"
  }'
```

**Response:**

```json
{
  "partner": {
    "partnerId": "partner_xyz_001",
    "partnerName": "XYZ Lending",
    "status": "ACTIVE",
    "tier": "PREMIUM",
    "dailyBorrowLimit": "100000000000",
    "totalBorrowLimit": "500000000000",
    "platformFeePercentage": 50,
    "settlementAddress": "0xPartnerWallet...",
    "contactEmail": "contact@xyz.com",
    "createdAt": "2026-01-10T10:00:00.000Z"
  },
  "plainApiKey": "pk_xyz_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

---

## Partner Integration Documentation

### Complete Documentation Set

Once a partner is created, share these documents with them:

#### 1. **Repayment Integration** (Primary)
📄 [docs/PARTNER_REPAYMENT_GUIDE.md](./PARTNER_REPAYMENT_GUIDE.md)

**Contents:**
- Complete repayment flow documentation
- Transfer-based repayment (recommended)
- API reference with examples
- Frontend integration code
- Error handling

**Key Endpoints:**
- `POST /partners/repay-with-transfer` - Repay with user USDC transfer
- `GET /partners/loan/:loanId` - Get loan details
- `GET /partners/user/:wallet/loans` - Get user loans

#### 2. **Testing Guide**
📄 [docs/testing/PARTNER_INTEGRATION_TESTING_GUIDE.md](./testing/PARTNER_INTEGRATION_TESTING_GUIDE.md)

**Contents:**
- Unit test examples
- Integration test setup
- Manual testing procedures
- Load testing with k6
- Security testing checklist

#### 3. **Implementation Status**
📄 [docs/code/PARTNER_IMPLEMENTATION_STATUS.md](./code/PARTNER_IMPLEMENTATION_STATUS.md)

**Contents:**
- Current implementation status
- Available features
- Missing features (webhooks, etc.)
- Roadmap

#### 4. **Quick Start**
📄 [PARTNER_REPAYMENT_README.md](../PARTNER_REPAYMENT_README.md)

**Contents:**
- Quick overview
- 2-step repayment flow
- Code examples
- Support contacts

---

## API Endpoints

### Partner Endpoints (Requires API Key)

#### Authentication

All partner endpoints require an API key in the Authorization header:

```
Authorization: Bearer pk_xyz_live_...
```

#### Available Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/partners/borrow` | POST | Borrow USDC on behalf of user |
| `/partners/repay-with-transfer` | POST | Repay loan with transfer verification |
| `/partners/repay` | POST | Repay loan (platform wallet has USDC) |
| `/partners/loan/:loanId` | GET | Get loan details |
| `/partners/user/:wallet/loans` | GET | Get all loans for a user |
| `/partners/my/stats` | GET | Get partner statistics |

#### Public Endpoints (No Auth Required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/partners/public/position/:id/details` | GET | Get position details |

### Admin Endpoints (Requires Admin JWT)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/admin/partners` | POST | Create new partner |
| `/admin/partners` | GET | List all partners |
| `/admin/partners/:id` | GET | Get partner details |
| `/admin/partners/:id` | PATCH | Update partner |
| `/admin/partners/:id/regenerate-api-key` | POST | Regenerate API key |

---

## Testing

### 1. Test Partner Creation

```bash
# Create a test partner
ADMIN_KEY=0x... \
PARTNER_SETTLEMENT_ADDRESS=0xTestWallet... \
PARTNER_EMAIL=test@example.com \
node scripts/admin-create-partner.js "Test Partner" test BASIC
```

Save the API key from the output!

### 2. Test Loan Borrowing

The partner can now test borrowing (requires existing collateral position):

```bash
# Partner borrows on behalf of user
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer pk_test_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "oaidTokenId": 1,
    "userWallet": "0x580F5b...",
    "borrowAmount": "5000000000",
    "partnerLoanId": "test_loan_001",
    "loanDuration": 2592000,
    "numberOfInstallments": 1
  }'
```

### 3. Test Loan Repayment

#### Step 1: User sends USDC

```bash
USER_KEY=0x4dd8f... \
node scripts/partner-repay-with-transfer.js send test_loan_001 100
```

#### Step 2: Partner processes repayment

```bash
PARTNER_API_KEY=pk_test_live_... \
node scripts/partner-repay-with-transfer.js process \
  test_loan_001 100 0xTRANSFER_TX_HASH 0xUSER_WALLET
```

### 4. Query Loan Status

```bash
PARTNER_API_KEY=pk_test_live_... \
node scripts/partner-repay-with-transfer.js query test_loan_001
```

### 5. Check Partner Stats

```bash
curl http://localhost:3000/partners/my/stats \
  -H "Authorization: Bearer pk_test_live_..."
```

---

## Going Live

### Pre-Launch Checklist

- [ ] **Partner Created** - Partner exists in database
- [ ] **API Key Secured** - Partner has securely stored API key
- [ ] **Integration Tested** - All endpoints tested in sandbox
- [ ] **Settlement Address Configured** - Correct wallet address set
- [ ] **Documentation Shared** - Partner has all integration docs
- [ ] **Support Contact** - Partner knows who to contact for issues
- [ ] **Monitoring Set Up** - Alerts configured for errors
- [ ] **Limits Verified** - Borrow limits are appropriate

### Launch Steps

1. **Sandbox Testing** (1-2 weeks)
   - Partner integrates in test environment
   - Tests with testnet USDC
   - Validates all flows work correctly

2. **Pilot Launch** (2-4 weeks)
   - Start with low limits
   - Monitor closely for issues
   - Gather partner feedback

3. **Production Launch**
   - Increase limits as needed
   - Enable webhooks (if available)
   - Regular check-ins with partner

### Post-Launch Monitoring

**Monitor These Metrics:**

- Daily borrow volume
- Repayment rate
- API error rate
- Average response time
- Outstanding debt

**Set Up Alerts For:**

- API errors > 5%
- Response time > 2 seconds
- Approaching borrow limits (80%)
- Failed repayments
- Unusual activity patterns

---

## Partner Management

### List All Partners

```bash
# Get admin token
ADMIN_TOKEN=$(ADMIN_KEY=0x... node scripts/get-admin-token.js)

# List all partners
curl http://localhost:3000/admin/partners \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Update Partner

```bash
# Update partner tier or limits
curl -X PATCH http://localhost:3000/admin/partners/partner_xyz_001 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "ENTERPRISE",
    "totalBorrowLimit": "2000000000000"
  }'
```

### Suspend Partner

```bash
curl -X PATCH http://localhost:3000/admin/partners/partner_xyz_001 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "SUSPENDED"
  }'
```

### Regenerate API Key

**WARNING:** This will invalidate the old API key immediately!

```bash
curl -X POST http://localhost:3000/admin/partners/partner_xyz_001/regenerate-api-key \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## Troubleshooting

### Partner Can't Authenticate

**Symptoms:**
- 401 Unauthorized errors
- "Invalid API key" message

**Solutions:**
1. Verify API key is correct (copy-paste carefully)
2. Ensure using `Bearer` prefix in Authorization header
3. Check API key hasn't been regenerated
4. Verify partner status is `ACTIVE` not `SUSPENDED`

### Borrow Limit Exceeded

**Symptoms:**
- 403 Forbidden
- "Partner total limit exceeded" message

**Solutions:**
1. Check current outstanding debt
2. Wait for repayments to clear
3. Contact admin to increase limits
4. Upgrade to higher tier

### Transfer Verification Failed

**Symptoms:**
- "Transfer transaction not found"
- "Amount mismatch"

**Solutions:**
1. Wait for transaction confirmation (1-2 blocks)
2. Verify exact amount matches (6 decimals for USDC)
3. Check transaction didn't revert
4. Ensure sent to correct platform wallet

---

## Support

### For Partners

**Documentation:**
- [Repayment Guide](./PARTNER_REPAYMENT_GUIDE.md)
- [Testing Guide](./testing/PARTNER_INTEGRATION_TESTING_GUIDE.md)
- [Quick Start](../PARTNER_REPAYMENT_README.md)

**Contact:**
- Email: partners@mantle-rwa.com
- Partner Portal: https://partners.mantle-rwa.com
- API Status: https://status.mantle-rwa.com

### For Admins

**Scripts:**
- Create Partner: `scripts/admin-create-partner.js`
- Get Admin Token: `scripts/get-admin-token.js`

**Documentation:**
- [Implementation Status](./code/PARTNER_IMPLEMENTATION_STATUS.md)
- [Integration Summary](./code/partner_integration_summary.md)

---

## Security Best Practices

### For Partners

1. **Never commit API keys to code**
   - Use environment variables
   - Rotate keys periodically

2. **Always use HTTPS**
   - Never send API keys over HTTP
   - Validate SSL certificates

3. **Monitor API usage**
   - Set up alerts for unusual activity
   - Review logs regularly

4. **Validate user input**
   - Never trust user-provided wallet addresses
   - Validate amounts before sending

### For Admins

1. **Secure admin keys**
   - Never commit admin keys
   - Use hardware wallets when possible

2. **Review partner activity**
   - Monitor for suspicious patterns
   - Regular security audits

3. **Set appropriate limits**
   - Start conservative, increase gradually
   - Consider partner risk profile

---

## FAQ

**Q: How long does partner creation take?**
A: Instant. The partner is created immediately and can start integrating right away.

**Q: Can a partner have multiple API keys?**
A: No, each partner has one API key. You can regenerate it if needed.

**Q: What happens if a partner exceeds their borrow limit?**
A: The API will return a 403 Forbidden error. No loan will be created.

**Q: Can partners customize their fee percentage?**
A: Only ENTERPRISE tier partners can have custom fee arrangements.

**Q: How do I upgrade a partner's tier?**
A: Use the PATCH endpoint to update the tier field.

**Q: What happens to existing loans when a partner is suspended?**
A: Existing loans remain active. The partner just can't create new loans.

---

## Next Steps

1. ✅ Create your first partner using the admin script
2. 📧 Share integration documentation with partner
3. 🧪 Guide partner through testing process
4. 🚀 Monitor the integration during pilot phase
5. 📈 Scale up based on success metrics

---

**Document Version:** 1.0
**Last Updated:** 2026-01-10
**Maintained By:** Platform Team
