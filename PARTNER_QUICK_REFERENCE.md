# Partner Integration - Quick Reference Card

**Version:** 1.0 | **Date:** 2026-01-10

---

## 🚀 Create a Partner (30 seconds)

```bash
ADMIN_KEY=0x1d12932a... \
PARTNER_SETTLEMENT_ADDRESS=0xPartnerWallet... \
PARTNER_EMAIL=contact@partner.com \
node scripts/admin-create-partner.js "Partner Name" prefix PREMIUM
```

**Output:** API key (shown only once!)

---

## 📚 Documentation Index

| Document | Purpose | Audience |
|----------|---------|----------|
| **[Partner Onboarding Guide](docs/PARTNER_ONBOARDING_GUIDE.md)** | Complete guide to creating partners | Admins |
| **[Partner Repayment Guide](docs/PARTNER_REPAYMENT_GUIDE.md)** | Integration guide for repayments | Partners |
| **[Quick Start README](PARTNER_REPAYMENT_README.md)** | Overview and quick start | Partners |
| **[Testing Guide](docs/testing/PARTNER_INTEGRATION_TESTING_GUIDE.md)** | How to test integration | Partners |
| **[Implementation Status](docs/code/PARTNER_IMPLEMENTATION_STATUS.md)** | Current feature status | Technical |

---

## 🔑 Partner Tiers

| Tier | Daily Limit | Total Limit | Fee | Best For |
|------|-------------|-------------|-----|----------|
| **BASIC** | $50k | $200k | 0.75% | Testing, low volume |
| **PREMIUM** | $100k | $500k | 0.50% | Established platforms |
| **ENTERPRISE** | $500k | $2M | 0.25% | High volume, custom |

---

## 🛠 Admin Commands

### Create Partner
```bash
ADMIN_KEY=0x... node scripts/admin-create-partner.js "Name" prefix TIER
```

### List All Partners
```bash
ADMIN_TOKEN=$(ADMIN_KEY=0x... node scripts/get-admin-token.js)
curl http://localhost:3000/admin/partners \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Update Partner Tier
```bash
curl -X PATCH http://localhost:3000/admin/partners/partner_xyz_001 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier": "ENTERPRISE"}'
```

### Regenerate API Key
```bash
curl -X POST http://localhost:3000/admin/partners/partner_xyz_001/regenerate-api-key \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

---

## 🔌 Partner API Endpoints

### Borrow Loan
```bash
POST /partners/borrow
Authorization: Bearer pk_xyz_live_...
{
  "oaidTokenId": 1,
  "userWallet": "0x...",
  "borrowAmount": "5000000000",
  "partnerLoanId": "xyz_loan_001"
}
```

### Repay with Transfer (Recommended)
```bash
POST /partners/repay-with-transfer
Authorization: Bearer pk_xyz_live_...
{
  "partnerLoanId": "xyz_loan_001",
  "repaymentAmount": "5000000000",
  "transferTxHash": "0xabc123...",
  "userWallet": "0x..."
}
```

### Get Loan Details
```bash
GET /partners/loan/xyz_loan_001
Authorization: Bearer pk_xyz_live_...
```

### Get Partner Stats
```bash
GET /partners/my/stats
Authorization: Bearer pk_xyz_live_...
```

---

## 🧪 Testing Flow

### 1. Create Test Partner
```bash
ADMIN_KEY=0x... node scripts/admin-create-partner.js "Test" test BASIC
# Save the API key!
```

### 2. Partner Borrows
```bash
# Requires existing collateral position
curl -X POST http://localhost:3000/partners/borrow \
  -H "Authorization: Bearer pk_test_live_..." \
  -d '{"oaidTokenId": 1, "userWallet": "0x...", "borrowAmount": "100000000", "partnerLoanId": "test_001"}'
```

### 3. User Sends USDC
```bash
USER_KEY=0x... node scripts/partner-repay-with-transfer.js send test_001 100
# Copy the transaction hash!
```

### 4. Partner Processes Repayment
```bash
PARTNER_API_KEY=pk_test_live_... \
node scripts/partner-repay-with-transfer.js process \
  test_001 100 0xTX_HASH 0xUSER_WALLET
```

---

## 🎯 Common Use Cases

### Onboard New Partner
1. Create partner: `admin-create-partner.js`
2. Share docs: Send [Partner Repayment Guide](docs/PARTNER_REPAYMENT_GUIDE.md)
3. Test: Partner tests in sandbox
4. Launch: Monitor and scale

### Increase Partner Limits
```bash
# Update limits
curl -X PATCH http://localhost:3000/admin/partners/partner_xyz_001 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"dailyBorrowLimit": "200000000000"}'
```

### Suspend Partner
```bash
curl -X PATCH http://localhost:3000/admin/partners/partner_xyz_001 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"status": "SUSPENDED"}'
```

### Troubleshoot Integration
1. Check [Partner Repayment Guide](docs/PARTNER_REPAYMENT_GUIDE.md) - Error Handling section
2. Review API logs in database
3. Test with curl commands above
4. Check partner stats endpoint

---

## 🔐 Security Checklist

### For Partners
- [ ] Store API key in environment variables
- [ ] Use HTTPS only
- [ ] Validate all user input
- [ ] Monitor API usage
- [ ] Set up error alerts

### For Admins
- [ ] Secure admin private key
- [ ] Review partner activity weekly
- [ ] Set appropriate limits
- [ ] Monitor for unusual patterns
- [ ] Regular security audits

---

## ⚡ Quick Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Invalid API key | Check API key, verify not regenerated |
| 403 Forbidden | Limit exceeded | Check stats, increase limits, or wait for repayments |
| 400 Bad Request | Invalid data | Validate request body matches DTO |
| 404 Not Found | Loan doesn't exist | Check loan ID, verify ownership |
| "Transfer not found" | TX not confirmed | Wait 1-2 blocks, verify TX hash |
| "Amount mismatch" | Wrong amount sent | Check 6 decimals, match exact amount |

---

## 📞 Support

**For Partners:**
- 📧 Email: partners@mantle-rwa.com
- 📚 Docs: https://docs.mantle-rwa.com/partners
- 🌐 Portal: https://partners.mantle-rwa.com

**For Admins:**
- 📧 Email: dev@mantle-rwa.com
- 📚 Internal Docs: `docs/PARTNER_ONBOARDING_GUIDE.md`

---

## 🔗 Quick Links

- [🎓 Full Onboarding Guide](docs/PARTNER_ONBOARDING_GUIDE.md)
- [💰 Repayment Integration](docs/PARTNER_REPAYMENT_GUIDE.md)
- [🧪 Testing Guide](docs/testing/PARTNER_INTEGRATION_TESTING_GUIDE.md)
- [📊 Implementation Status](docs/code/PARTNER_IMPLEMENTATION_STATUS.md)
- [🚀 Quick Start](PARTNER_REPAYMENT_README.md)

---

**Print this card and keep it handy!** 📄
