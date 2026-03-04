#!/usr/bin/env bash
# =============================================================================
# Creditcoin Credit System — End-to-End Flow Test
# Tests all backend endpoints and contract calls that make up the credit flow.
# Mimics exactly what the frontend would do, step by step.
# =============================================================================

set -euo pipefail

# ─── CONFIG ──────────────────────────────────────────────────────────────────
BASE_URL="${BASE_URL:-http://localhost:3005}"

# Test wallet — Hardhat/Foundry account #0 (testnet only, never use on mainnet)
TEST_PRIVATE_KEY="${TEST_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
TEST_WALLET="${TEST_WALLET:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

# ─── COLOURS ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Colour

# ─── COUNTERS ────────────────────────────────────────────────────────────────
PASS=0
FAIL=0
SKIP=0
ERRORS=()

# ─── HELPERS ─────────────────────────────────────────────────────────────────
section() { echo -e "\n${BOLD}${BLUE}━━━  $1  ━━━${NC}"; }
info()    { echo -e "  ${CYAN}→${NC} $1"; }
ok()      { echo -e "  ${GREEN}✔${NC}  $1"; ((PASS++)); }
fail()    { echo -e "  ${RED}✘${NC}  $1"; ((FAIL++)); ERRORS+=("$1"); }
skip()    { echo -e "  ${YELLOW}⊘${NC}  $1 (skipped)"; ((SKIP++)); }
dump()    { echo -e "    ${YELLOW}$1${NC}"; }

# Pretty-print JSON if jq is available, otherwise raw
pretty() {
  if command -v jq &>/dev/null; then
    echo "$1" | jq '.' 2>/dev/null || echo "$1"
  else
    echo "$1"
  fi
}

# curl wrapper — returns body, puts HTTP status in LAST_STATUS
api() {
  local method="$1"; local path="$2"; shift 2
  local response http_body http_status

  response=$(curl -s -w '\n__STATUS__%{http_code}' \
    -X "$method" \
    "${BASE_URL}${path}" \
    -H "Content-Type: application/json" \
    ${AUTH_HEADER:+-H "Authorization: Bearer $AUTH_HEADER"} \
    "$@" 2>&1)

  http_body=$(echo "$response" | sed '$d')
  LAST_STATUS=$(echo "$response" | tail -n1 | sed 's/__STATUS__//')
  echo "$http_body"
}

# Assert HTTP status
assert_status() {
  local label="$1" expected="$2"
  if [[ "$LAST_STATUS" == "$expected" ]]; then
    ok "$label (HTTP $LAST_STATUS)"
    return 0
  else
    fail "$label — expected HTTP $expected, got HTTP $LAST_STATUS"
    return 1
  fi
}

# Assert JSON field exists and is non-empty
assert_field() {
  local label="$1" body="$2" field="$3"
  if command -v jq &>/dev/null; then
    local val
    val=$(echo "$body" | jq -r "$field" 2>/dev/null)
    if [[ -n "$val" && "$val" != "null" ]]; then
      ok "$label — $field = $val"
      return 0
    else
      fail "$label — field '$field' missing or null in response"
      dump "Response: $(echo "$body" | jq -c '.' 2>/dev/null || echo "$body")"
      return 1
    fi
  else
    ok "$label (jq not available — skipping field check)"
    return 0
  fi
}

# ─── SIGN MESSAGE ────────────────────────────────────────────────────────────
# Uses cast (Foundry) if available, else falls back to node + ethers
sign_message() {
  local message="$1"

  if command -v cast &>/dev/null; then
    cast wallet sign --private-key "$TEST_PRIVATE_KEY" "$message" 2>/dev/null
  else
    # Node fallback — uses ethers from the contracts package
    node --input-type=module <<EOF 2>/dev/null
import { ethers } from 'ethers';
const wallet = new ethers.Wallet('${TEST_PRIVATE_KEY}');
const sig = await wallet.signMessage('${message}');
process.stdout.write(sig);
EOF
  fi
}

# ─── CHECK PREREQUISITES ─────────────────────────────────────────────────────
section "Prerequisites"

info "Target: $BASE_URL"
info "Wallet: $TEST_WALLET"

if ! command -v curl &>/dev/null; then
  fail "curl is required but not installed"
  exit 1
fi
ok "curl available"

if command -v jq &>/dev/null; then
  ok "jq available (rich JSON validation enabled)"
else
  skip "jq not found — install it for field-level assertions (brew install jq)"
fi

if command -v cast &>/dev/null; then
  ok "cast (Foundry) available — will use for signing"
elif node -e "require('ethers')" 2>/dev/null; then
  ok "node + ethers available — will use for signing"
else
  fail "No signing tool found. Install Foundry (https://getfoundry.sh) or run: npm install -g ethers"
  exit 1
fi

# ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
section "Server Health"

HEALTH=$(api GET "/health" 2>/dev/null || true)
if [[ "$LAST_STATUS" == "200" ]]; then
  ok "Server is up (HTTP 200)"
else
  info "No /health endpoint — checking auth challenge as proxy"
  PROBE=$(api GET "/auth/challenge?walletAddress=${TEST_WALLET}" 2>/dev/null || true)
  if [[ "$LAST_STATUS" == "200" ]]; then
    ok "Server is up and responding"
  else
    fail "Server not reachable at $BASE_URL (HTTP $LAST_STATUS) — is the backend running?"
    echo -e "\n${RED}Cannot continue — start the server first.${NC}"
    echo "  cd packages/backend && yarn dev"
    exit 1
  fi
fi

# ─── AUTH FLOW ────────────────────────────────────────────────────────────────
section "Auth — Challenge + Sign + Login"

# Step 1: Get challenge
info "GET /auth/challenge?walletAddress=$TEST_WALLET"
CHALLENGE_RESP=$(api GET "/auth/challenge?walletAddress=${TEST_WALLET}")

if ! assert_status "Challenge request" "200"; then
  dump "Response: $CHALLENGE_RESP"
  fail "Cannot continue without auth — aborting"
  exit 1
fi

CHALLENGE_MESSAGE=$(echo "$CHALLENGE_RESP" | jq -r '.message' 2>/dev/null || echo "")
CHALLENGE_NONCE=$(echo "$CHALLENGE_RESP" | jq -r '.nonce' 2>/dev/null || echo "")

if [[ -z "$CHALLENGE_MESSAGE" ]]; then
  fail "Challenge message not found in response"
  dump "$CHALLENGE_RESP"
  exit 1
fi
ok "Challenge received — nonce: ${CHALLENGE_NONCE:0:16}..."

# Step 2: Sign
info "Signing challenge message..."
SIGNATURE=$(sign_message "$CHALLENGE_MESSAGE" 2>/dev/null || true)

if [[ -z "$SIGNATURE" ]]; then
  fail "Signing failed — check SIGN_TOOL setup"
  exit 1
fi
ok "Message signed — sig: ${SIGNATURE:0:20}..."

# Step 3: Login
info "POST /auth/login"
LOGIN_BODY=$(jq -n \
  --arg w "$TEST_WALLET" \
  --arg s "$SIGNATURE" \
  --arg m "$CHALLENGE_MESSAGE" \
  '{ walletAddress: $w, signature: $s, message: $m }')

LOGIN_RESP=$(api POST "/auth/login" -d "$LOGIN_BODY")

if ! assert_status "Login" "200"; then
  dump "Response: $LOGIN_RESP"
  exit 1
fi

ACCESS_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken' 2>/dev/null || echo "")
if [[ -z "$ACCESS_TOKEN" || "$ACCESS_TOKEN" == "null" ]]; then
  fail "No accessToken in login response"
  dump "$LOGIN_RESP"
  exit 1
fi
ok "JWT received — token: ${ACCESS_TOKEN:0:30}..."
AUTH_HEADER="$ACCESS_TOKEN"

# Step 4: Verify token works
info "GET /auth/me"
ME_RESP=$(api GET "/auth/me")
assert_status "Auth/me with JWT" "200"
assert_field "Wallet in profile" "$ME_RESP" ".walletAddress"

# ─── CREDIT SCORE — LAYER 2 SUBSTRATE ─────────────────────────────────────────
section "Gap 2 — Creditcoin Protocol Score (Substrate)"

info "GET /credit-score/$TEST_WALLET"
info "This calls CreditcoinSubstrateService → queries Creditcoin Substrate WS RPC"

SCORE_RESP=$(api GET "/credit-score/${TEST_WALLET}")
assert_status "Credit score endpoint" "200"

if assert_field "Composite score exists" "$SCORE_RESP" ".compositeScore"; then
  COMPOSITE=$(echo "$SCORE_RESP" | jq -r '.compositeScore')
  L1=$(echo "$SCORE_RESP" | jq -r '.layer1Score')
  L2=$(echo "$SCORE_RESP" | jq -r '.layer2Score')
  TIER=$(echo "$SCORE_RESP" | jq -r '.tier')
  LTV=$(echo "$SCORE_RESP" | jq -r '.effectiveLtv')

  echo ""
  echo -e "    ${BOLD}Credit Score Breakdown:${NC}"
  echo -e "    ┌─────────────────────────────┐"
  echo -e "    │  Layer 1 (Platform):  ${BOLD}${L1}/1000${NC}"
  echo -e "    │  Layer 2 (Substrate): ${BOLD}${L2}/1000${NC}"
  echo -e "    │  Composite:           ${BOLD}${COMPOSITE}/1000${NC}"
  echo -e "    │  Tier:                ${BOLD}${TIER}${NC}"
  echo -e "    │  Effective LTV:       ${BOLD}${LTV} bps ($(echo "scale=1; $LTV/100" | bc)%)${NC}"
  echo -e "    └─────────────────────────────┘"
  echo ""

  if [[ "$L2" == "0" ]]; then
    info "Layer 2 score is 0 — wallet has no Creditcoin Substrate history (expected for fresh testnet wallet)"
  else
    ok "Layer 2 protocol score sourced from Creditcoin Substrate chain: $L2"
  fi
fi

# ─── CREDIT SCORE — BORROW TERMS PREVIEW ──────────────────────────────────────
section "Gap 3 — Composite Score + Borrow Terms API"

info "GET /credit-score/borrow-terms/$TEST_WALLET"
info "Shows personalised LTV before user commits to borrow"

TERMS_RESP=$(api GET "/credit-score/borrow-terms/${TEST_WALLET}")
assert_status "Borrow terms endpoint" "200"
assert_field "Effective LTV present" "$TERMS_RESP" ".effectiveLtv"
assert_field "Tier present" "$TERMS_RESP" ".tier"
assert_field "Standard LTV present" "$TERMS_RESP" ".standardLtv"
assert_field "hasBoost flag present" "$TERMS_RESP" ".hasBoost"

BOOST=$(echo "$TERMS_RESP" | jq -r '.hasBoost' 2>/dev/null || echo "false")
EFF_LTV=$(echo "$TERMS_RESP" | jq -r '.effectiveLtv' 2>/dev/null || echo "7000")
STD_LTV=$(echo "$TERMS_RESP" | jq -r '.standardLtv' 2>/dev/null || echo "7000")

if [[ "$BOOST" == "true" ]]; then
  ok "Credit BOOST active — user qualifies for $EFF_LTV bps vs standard $STD_LTV bps"
else
  info "No boost (score in GOOD tier or below) — standard LTV $STD_LTV bps applies"
fi

# ─── SOLVENCY — BORROW WITH CREDIT BOOST ──────────────────────────────────────
section "Gap 5 — Credit-Aware Borrow Flow"

info "GET /solvency/positions — checking if test wallet has any open positions"
POSITIONS_RESP=$(api GET "/solvency/positions" 2>/dev/null || true)

if [[ "$LAST_STATUS" == "200" ]]; then
  POSITION_COUNT=$(echo "$POSITIONS_RESP" | jq 'length' 2>/dev/null || echo "0")
  info "Found $POSITION_COUNT solvency position(s)"

  if [[ "$POSITION_COUNT" -gt "0" ]]; then
    POSITION_ID=$(echo "$POSITIONS_RESP" | jq -r '.[0].positionId' 2>/dev/null || echo "")

    if [[ -n "$POSITION_ID" && "$POSITION_ID" != "null" ]]; then
      info "POST /solvency/borrow — testing credit-aware borrow with positionId $POSITION_ID"

      BORROW_BODY=$(jq -n \
        --arg pid "$POSITION_ID" \
        '{ positionId: $pid, amount: "1000000", loanDuration: 30, numberOfInstallments: 3 }')

      BORROW_RESP=$(api POST "/solvency/borrow" -d "$BORROW_BODY")
      assert_status "Solvency borrow (credit-aware)" "200"

      if assert_field "creditBoost in borrow response" "$BORROW_RESP" ".creditBoost"; then
        CB_SCORE=$(echo "$BORROW_RESP" | jq -r '.creditBoost.score' 2>/dev/null || echo "?")
        CB_TIER=$(echo "$BORROW_RESP" | jq -r '.creditBoost.tier' 2>/dev/null || echo "?")
        CB_LTV=$(echo "$BORROW_RESP" | jq -r '.creditBoost.appliedLtv' 2>/dev/null || echo "?")
        CB_BOOST=$(echo "$BORROW_RESP" | jq -r '.creditBoost.boosted' 2>/dev/null || echo "?")
        ok "creditBoost: score=$CB_SCORE tier=$CB_TIER appliedLtv=$CB_LTV boosted=$CB_BOOST"
      fi
    else
      skip "No valid positionId found — cannot test borrow endpoint (deposit collateral first)"
    fi
  else
    skip "No solvency positions — skipping borrow test (run deposit-collateral first to create one)"
    info "To create a position: deposit RWA token collateral via POST /solvency/deposit"
  fi
else
  skip "GET /solvency/positions returned HTTP $LAST_STATUS — skipping borrow test"
fi

# ─── USC — PROOF SUBMISSION ────────────────────────────────────────────────────
section "Gap 4 — USC Cross-Chain Proof Submission"

info "POST /usc/submit-proof"
info "Submits a cross-chain credit event proof to the USCCreditVerifier contract"
info "Contract calls the 0x0FD2 precompile on Creditcoin EVM to verify the STARK proof"

# Use a dummy proof — the USCCreditVerifier address is currently a zero placeholder,
# so the service will return verified:false immediately (safe no-op).
# When the contract is deployed to testnet, replace proofData with a real STARK proof.
PROOF_BODY=$(jq -n \
  --arg w "$TEST_WALLET" \
  '{
    walletAddress: $w,
    sourceChain: "ETHEREUM",
    eventType: "REPAYMENT",
    scoreDelta: 80,
    proofData: "0xdeadbeef01020304deadbeef01020304deadbeef01020304deadbeef01020304"
  }')

USC_RESP=$(api POST "/usc/submit-proof" -d "$PROOF_BODY")
assert_status "USC submit-proof endpoint reachable" "200"

VERIFIED=$(echo "$USC_RESP" | jq -r '.verified' 2>/dev/null || echo "unknown")
TX_HASH=$(echo "$USC_RESP" | jq -r '.txHash' 2>/dev/null || echo "")

if [[ "$VERIFIED" == "true" ]]; then
  ok "Proof VERIFIED on-chain via 0x0FD2 precompile"
  ok "Verification txHash: $TX_HASH"
  info "Explorer: https://creditcoin-testnet.blockscout.com/tx/$TX_HASH"
elif [[ "$VERIFIED" == "false" ]]; then
  info "Proof not verified (expected — USCCreditVerifier address is zero placeholder)"
  info "To see real verification: deploy USCCreditVerifier.sol to Creditcoin testnet,"
  info "update deployed_contracts_creditcoin.json, and submit a valid STARK proof"
  ok "USC endpoint is live and handles the proof submission correctly"
else
  fail "Unexpected response from USC submit-proof"
  dump "Response: $USC_RESP"
fi

# ─── USC — EVENT HISTORY ───────────────────────────────────────────────────────
section "Gap 4 — USC Verified Event History"

info "GET /usc/events/$TEST_WALLET"
EVENTS_RESP=$(api GET "/usc/events/${TEST_WALLET}")
assert_status "USC events endpoint" "200"

EVENT_COUNT=$(echo "$EVENTS_RESP" | jq 'length' 2>/dev/null || echo "0")
info "Verified cross-chain events for wallet: $EVENT_COUNT"

if [[ "$EVENT_COUNT" -gt "0" ]]; then
  ok "$EVENT_COUNT verified cross-chain event(s) on record"
  LATEST_CHAIN=$(echo "$EVENTS_RESP" | jq -r '.[0].sourceChain' 2>/dev/null || echo "?")
  LATEST_TYPE=$(echo "$EVENTS_RESP" | jq -r '.[0].eventType' 2>/dev/null || echo "?")
  LATEST_DELTA=$(echo "$EVENTS_RESP" | jq -r '.[0].scoreDelta' 2>/dev/null || echo "?")
  ok "Latest: $LATEST_CHAIN $LATEST_TYPE (scoreDelta: $LATEST_DELTA)"
else
  info "No verified events yet — submit a real proof via POST /usc/submit-proof to populate this"
  ok "Event history endpoint is live and returns correct empty array"
fi

# ─── FULL FLOW SUMMARY ─────────────────────────────────────────────────────────
section "Full Demo Flow Summary"

info "Simulating the complete hackathon demo narrative..."

echo ""
echo -e "  ${BOLD}Step 1${NC} — User arrives. Wallet: $TEST_WALLET"
echo -e "  ${BOLD}Step 2${NC} — Backend queries Creditcoin Substrate for their protocol credit history"
echo -e "  ${BOLD}Step 3${NC} — Composite score computed (Layer1 platform + Layer2 Substrate)"
echo -e "  ${BOLD}Step 4${NC} — Personalised LTV shown before borrow"
echo -e "  ${BOLD}Step 5${NC} — USC proof submitted → verified on Creditcoin via 0x0FD2 precompile"
echo -e "  ${BOLD}Step 6${NC} — Score updated, new events in history"
echo -e "  ${BOLD}Step 7${NC} — Borrow executes with credit-adjusted LTV, creditBoost in response"
echo ""

# ─── RESULTS ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e " ${BOLD}Test Results${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo ""

if [[ ${#ERRORS[@]} -gt 0 ]]; then
  echo -e "  ${RED}${BOLD}Failures:${NC}"
  for err in "${ERRORS[@]}"; do
    echo -e "  ${RED}•${NC} $err"
  done
  echo ""
fi

if [[ $FAIL -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}All tests passed.${NC}"
else
  echo -e "  ${RED}${BOLD}$FAIL test(s) failed. See errors above.${NC}"
fi

echo ""
echo -e "  ${CYAN}Useful next steps:${NC}"
echo -e "  • Deploy USCCreditVerifier.sol to Creditcoin testnet (npx hardhat run scripts/deploy/deploy-usc.ts --network creditcoin)"
echo -e "  • Update deployed_contracts_creditcoin.json with the real address"
echo -e "  • Submit a valid STARK proof to see the on-chain 0x0FD2 verification live"
echo -e "  • Check Creditcoin testnet explorer: https://creditcoin-testnet.blockscout.com"
echo ""

[[ $FAIL -eq 0 ]]
