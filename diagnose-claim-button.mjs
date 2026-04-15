/**
 * CLAIM BUTTON DIAGNOSTIC SCRIPT
 *
 * Queries MongoDB directly to show every field the claim-button calculation
 * depends on.  Run with:
 *   node diagnose-claim-button.mjs
 *
 * It will print a clear report showing WHERE the chain breaks.
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = 'mongodb+srv://chaudharikaushal02_db_user:68NarhTViHvjsUwr@cluster0.ztsrzfm.mongodb.net/?appName=Cluster0';
const DB_NAME = 'test'; // adjust if your DB has a different name

// ─── helpers ──────────────────────────────────────────────────────────────────
const hr  = () => console.log('─'.repeat(70));
const ok  = (msg) => console.log(`  ✅  ${msg}`);
const fail= (msg) => console.log(`  ❌  ${msg}`);
const warn= (msg) => console.log(`  ⚠️   ${msg}`);
const info= (msg) => console.log(`  ℹ️   ${msg}`);

function parseFloat2(v) { return v == null ? NaN : parseFloat(String(v)); }

// ─── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  console.log('\n✅  Connected to MongoDB\n');

  // Try both common DB names
  let db = client.db(DB_NAME);
  const allDbs = await client.db('admin').admin().listDatabases();
  console.log('Available databases:', allDbs.databases.map(d => d.name).join(', '));

  // Pick the right DB (non-system, non-admin)
  const appDb = allDbs.databases.find(d => !['admin','local','config'].includes(d.name));
  if (appDb) {
    db = client.db(appDb.name);
    console.log(`Using database: "${appDb.name}"\n`);
  }

  const settlements  = db.collection('settlements');
  const purchases    = db.collection('purchases');
  const assets       = db.collection('assets');
  const yieldclaims  = db.collection('yieldclaims');
  const portfolios   = db.collection('userportfolios');

  // ── 1. ALL SETTLEMENTS ────────────────────────────────────────────────────
  hr();
  console.log('LAYER 1: SETTLEMENTS COLLECTION');
  hr();
  const allSettlements = await settlements.find({}).sort({ createdAt: -1 }).limit(10).toArray();
  if (allSettlements.length === 0) {
    fail('No settlements found in DB at all!');
    console.log('  → The admin has NOT called POST /admin/yield/settlement yet.');
  } else {
    console.log(`  Found ${allSettlements.length} settlement(s):\n`);
    for (const s of allSettlements) {
      console.log(`  Settlement ID: ${s._id}`);
      console.log(`    assetId:         ${s.assetId}`);
      console.log(`    network:         ${s.network}        ← must be 'hashkey' for frontend`);
      console.log(`    status:          ${s.status}`);
      console.log(`    usdcAmount:      ${s.usdcAmount ?? 'NULL/UNDEFINED ← CLAIM BLOCKED HERE'}`);
      console.log(`    settlementAmount:${s.settlementAmount}`);
      console.log(`    netDistribution: ${s.netDistribution}`);
      console.log(`    vaultDepositTx:  ${s.vaultDepositTxHash ?? 'not set'}`);

      if (!s.usdcAmount) {
        fail(`usdcAmount is MISSING → admin must call POST /admin/yield/confirm-usdc {settlementId, usdcAmount}`);
      } else {
        ok(`usdcAmount is set: "${s.usdcAmount}"`);
      }
      if (s.network !== 'hashkey') {
        fail(`network field is "${s.network}" but frontend queries with "hashkey" — MISMATCH`);
      } else {
        ok(`network matches "hashkey"`);
      }
      console.log();
    }
  }

  // ── 2. ALL ASSETS ─────────────────────────────────────────────────────────
  hr();
  console.log('LAYER 2: ASSETS COLLECTION (tokenized, relevant fields)');
  hr();
  const allAssets = await assets.find({ 'token.address': { $exists: true } })
    .sort({ createdAt: -1 }).limit(10).toArray();

  if (allAssets.length === 0) {
    fail('No tokenized assets found in DB!');
  } else {
    console.log(`  Found ${allAssets.length} tokenized asset(s):\n`);
    for (const a of allAssets) {
      console.log(`  Asset: ${a.assetId}`);
      console.log(`    network:                 ${a.network}`);
      console.log(`    status:                  ${a.status}`);
      console.log(`    token.address:           ${a.token?.address}`);
      console.log(`    token.supply:            ${a.token?.supply ?? 'NOT SET'}`);
      console.log(`    tokenParams.totalSupply: ${a.tokenParams?.totalSupply ?? 'NOT SET'}`);
      console.log(`    listing.sold:            ${a.listing?.sold ?? 'NOT SET'}`);
      console.log(`    listing.amountRaised:    ${a.listing?.amountRaised ?? 'NOT SET'}`);
      console.log(`    listing.active:          ${a.listing?.active}`);

      const soldNum = parseFloat2(a.listing?.sold);
      const supplyNum = parseFloat2(a.token?.supply ?? a.tokenParams?.totalSupply);

      if (isNaN(soldNum) || soldNum === 0) {
        fail(`listing.sold is "${a.listing?.sold}" (numerically 0) → totalSupplyRaw=0n → yield=0`);
        if (!isNaN(supplyNum) && supplyNum > 0) {
          ok(`Fallback: token.supply="${a.token?.supply}" or tokenParams.totalSupply="${a.tokenParams?.totalSupply}" can be used`);
        } else {
          fail(`No valid fallback supply found! token.supply="${a.token?.supply}" tokenParams="${a.tokenParams?.totalSupply}"`);
        }
      } else {
        ok(`listing.sold="${a.listing?.sold}" (numeric=${soldNum}) — denominator OK`);
      }
      console.log();
    }
  }

  // ── 3. ALL PURCHASES ──────────────────────────────────────────────────────
  hr();
  console.log('LAYER 3: PURCHASES COLLECTION');
  hr();
  const allPurchases = await purchases.find({})
    .sort({ createdAt: -1 }).limit(20).toArray();

  if (allPurchases.length === 0) {
    fail('No purchases found in DB at all!');
  } else {
    const uniqueInvestors = [...new Set(allPurchases.map(p => p.investorWallet))];
    const uniqueAssets    = [...new Set(allPurchases.map(p => p.assetId))];

    console.log(`  Total purchases: ${allPurchases.length}`);
    console.log(`  Investors: ${uniqueInvestors.join(', ')}`);
    console.log(`  Assets:    ${uniqueAssets.join(', ')}\n`);

    // Group by investor+asset
    const grouped = {};
    for (const p of allPurchases) {
      const key = `${p.investorWallet}::${p.assetId}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(p);
    }

    for (const [key, purchases] of Object.entries(grouped)) {
      const [investor, assetId] = key.split('::');
      console.log(`  Investor: ${investor}  |  Asset: ${assetId}`);

      let netAmount = 0;
      for (const p of purchases) {
        const amt = parseFloat2(p.amount);
        console.log(`    status=${p.status}  source=${p.source}  amount=${p.amount}  network=${p.network}`);
        netAmount += amt;
      }

      const netCanonical = netAmount.toFixed(4);
      console.log(`    Net token balance: ${netCanonical}`);
      if (netAmount <= 0) {
        fail(`Net token balance is ${netCanonical} → userTokenBalanceRaw=0n → yield=0 → button hidden`);
      } else {
        ok(`Net token balance = ${netCanonical} tokens`);
      }

      // Check if status blocks the button
      const latestPurchase = purchases.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      if (latestPurchase.status === 'CLAIMED') {
        fail(`Latest purchase status="CLAIMED" → asset.status="CLAIMED" → UI hides button`);
      } else {
        ok(`Latest purchase status="${latestPurchase.status}" → button not blocked by status`);
      }
      console.log();
    }
  }

  // ── 4. CROSS-CHECK: settlement × asset × purchase ────────────────────────
  hr();
  console.log('LAYER 4: CROSS-CHECK (Settlement ↔ Asset ↔ Purchase for each asset)');
  hr();

  for (const s of allSettlements) {
    const assetId = s.assetId;
    console.log(`\n  AssetId: ${assetId}`);

    // Find asset (no network filter — to expose mismatch)
    const asset = await assets.findOne({ assetId });
    const assetWithNetwork = await assets.findOne({ assetId, network: 'hashkey' });

    if (!asset) {
      fail(`Asset NOT FOUND in DB for assetId="${assetId}"`);
      continue;
    }

    info(`Asset found  — asset.network="${asset.network}"`);
    if (!assetWithNetwork) {
      fail(`Asset NOT FOUND when queried with network="hashkey" (asset has network="${asset.network}")`);
      fail(`→ getInvestorPortfolio query { assetId, network } returns NULL → yield=0`);
    } else {
      ok(`Asset found with network="hashkey" filter`);
    }

    // Check supply
    const sold = parseFloat2(asset.listing?.sold);
    const supply = parseFloat2(asset.token?.supply ?? asset.tokenParams?.totalSupply);
    const denominator = sold > 0 ? sold : supply;

    console.log(`    listing.sold="${asset.listing?.sold}"  →  numeric=${sold}`);
    console.log(`    token.supply="${asset.token?.supply}"  tokenParams.totalSupply="${asset.tokenParams?.totalSupply}"  →  numeric=${supply}`);
    console.log(`    Effective denominator: ${denominator}`);

    if (!denominator || denominator <= 0) {
      fail('DENOMINATOR IS ZERO → claimableYield = 0 → button invisible');
    } else {
      ok(`Denominator OK = ${denominator}`);
    }

    // Check settlement usdcAmount
    if (!s.usdcAmount) {
      fail('settlement.usdcAmount is NOT SET → yield calculation blocked at first gate');
    } else {
      const usdcNum = parseFloat2(s.usdcAmount);
      ok(`settlement.usdcAmount="${s.usdcAmount}" (${usdcNum})`);

      if (denominator > 0) {
        // Find all investor balances
        const investorPurchases = await purchases.find({ assetId, network: 'hashkey', status: { $in: ['CONFIRMED','CLAIMED'] } }).toArray();
        const balanceMap = {};
        for (const p of investorPurchases) {
          const wallet = p.investorWallet;
          balanceMap[wallet] = (balanceMap[wallet] ?? 0) + parseFloat2(p.amount);
        }

        console.log('\n    Simulated claimableYield per investor:');
        for (const [wallet, balance] of Object.entries(balanceMap)) {
          const claimable = (balance / denominator) * usdcNum;
          const visible = claimable > 0 ? '✅ BUTTON SHOWS' : '❌ BUTTON HIDDEN (yield=0)';
          console.log(`      ${wallet}: balance=${balance.toFixed(4)}  claimable=${claimable.toFixed(6)} USDC  ${visible}`);
        }
      }
    }
  }

  // ── 5. YIELD CLAIMS ───────────────────────────────────────────────────────
  hr();
  console.log('LAYER 5: EXISTING YIELD CLAIMS');
  hr();
  const claims = await yieldclaims.find({}).sort({ createdAt: -1 }).limit(10).toArray();
  if (claims.length === 0) {
    info('No yield claims recorded yet (expected if no one has claimed)');
  } else {
    for (const c of claims) {
      console.log(`  Claim: assetId=${c.assetId}  investor=${c.investorWallet}  txHash=${c.txHash}  network=${c.network}`);
    }
  }

  // ── 6. PORTFOLIO COLLECTION ───────────────────────────────────────────────
  hr();
  console.log('LAYER 6: USERPORTFOLIOS COLLECTION');
  hr();
  const pf = await portfolios.find({}).sort({ lastUpdated: -1 }).limit(5).toArray();
  if (pf.length === 0) {
    warn('No user portfolio documents found (this collection may be empty if using purchase-tracker path)');
  } else {
    for (const p of pf) {
      console.log(`  Portfolio: wallet=${p.walletAddress}  network=${p.network}  holdings=${p.holdings?.length ?? 0}`);
      for (const h of (p.holdings ?? [])) {
        console.log(`    holding: assetId=${h.assetId}  type=${h.holdingType}  status=${h.status}  balance=${h.tokenBalance}`);
      }
    }
  }

  // ── SUMMARY ───────────────────────────────────────────────────────────────
  hr();
  console.log('DIAGNOSTIC COMPLETE');
  hr();
  console.log(`
Check the ❌ lines above — each one is a specific gate that blocks the claim button.
Most likely culprits in order:
  1. settlement.usdcAmount is NULL  → admin skipped confirm-usdc step
  2. asset not found with network="hashkey" filter → asset.network field mismatch
  3. listing.sold is "0" AND token.supply is also 0 → denominator=0 → yield=0
  4. purchases net balance <= 0 → user sold all tokens
  5. purchase status="CLAIMED" → UI hides button
`);

  await client.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
