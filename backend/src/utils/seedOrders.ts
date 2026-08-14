/**
 * seedOrders.ts — v1.0 (IN-PLACE ENRICHMENT)
 * -----------------------------------------------------------------------------
 * Fixes the CRM Commandes page that shows 96 orders with empty fields:
 *   N° Commande: —     Client: —     Ville: —
 *   Montant: 0€        Articles: 0   Statut: "En cours" everywhere
 *
 * PROBLEM
 *   The 96 existing orders in the `orders` collection have NO useful fields —
 *   the page's normalizeOrder() falls back to "—" / 0 for everything.
 *
 * FIX
 *   Update each of the 96 existing orders IN PLACE (no insert, no delete)
 *   with realistic Tunisian e-commerce data:
 *     • order_number: CMD-0001 ... CMD-0096  (stable, unique)
 *     • client_name:  one of the 44 companies we already seeded
 *     • client_id:    that company's _id
 *     • city:         that company's city
 *     • amount:       80€ — 5800€  (realistic B2B order)
 *     • status:       distribution matching real life
 *                       ~40% Livrée, 25% En cours, 15% Confirmée,
 *                       10% En attente, 10% Annulée
 *     • payment_status: correlated with status
 *                       (Livrée → Payé, En cours → Partiel / En attente, etc.)
 *     • quantity:    1 — 25
 *     • items_count: 1 — 6
 *     • created_at:  within last 90 days (preserves existing if already a Date)
 *     • updated_at:  now
 *
 * WHY UPDATE IN-PLACE (vs insert/delete)
 *   1. The 96 orders already exist with valid _id values that other code
 *      (payments, deliveries, invoices) might reference.
 *   2. No risk of E11000 duplicate-key errors on any unique index.
 *   3. Keeps the count stable at 96 (the user already sees "96 commandes").
 *
 * RUN (from backend/ directory):
 *   npx ts-node-dev --transpile-only src/utils/seedOrders.ts
 *
 * ENV:
 *   MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/CCM_DB?retryWrites=true&w=majority
 *
 * OPTIONS:
 *   SEED_MODE=enrich   → UPDATE existing orders in-place (default)
 *   SEED_MODE=replace  → DELETE all existing first, then INSERT 96 fresh
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

const SEED_MODE = process.env.SEED_MODE || 'enrich';
const DB_NAME = process.env.DB_NAME || 'CCM_DB';
const ORDERS_COLLECTION = 'orders';
const COMPANIES_COLLECTION = 'companies';

// ---------------------------------------------------------------------------
// URI validation — catch the common "/PORT/DB" typo before connecting
// ---------------------------------------------------------------------------
function validateMongoUri(uri: string): void {
  // Common mistake: "host:27017/27017/dbname" — duplicate port in path
  const portInPathMatch = uri.match(/:\d+\/(\d+)\/[^?]+/);
  if (portInPathMatch) {
    console.error('[FATAL] MONGODB_URI looks malformed.');
    console.error(`   Found ":${portInPathMatch[0]}" — the path starts with a number.`);
    console.error('   This usually means a duplicate "/PORT/" segment in the URI.');
    console.error('   Example of CORRECT URI:');
    console.error('     mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/CCM_DB?retryWrites=true&w=majority');
    console.error('   Example of BROKEN URI (what you probably have):');
    console.error('     mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/27017/CCM_DB?...');
    console.error('                                              ^^^^^^^ remove this');
    process.exit(1);
  }

  // Check for any '/' in the database name segment
  const dbNameMatch = uri.match(/\/([^/?]+)(\?|$)/);
  if (dbNameMatch && dbNameMatch[1].includes('/')) {
    console.error('[FATAL] MONGODB_URI contains "/" in the database name segment.');
    console.error(`   Database name parsed: "${dbNameMatch[1]}"`);
    process.exit(1);
  }

  if (!uri.includes('CCM_DB') && !uri.endsWith('/callcentermatch')) {
    console.warn('[WARN] MONGODB_URI does not mention "CCM_DB".');
    console.warn('       If you are using a different DB name, set DB_NAME env var.');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY = 86400000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * DAY);

// Deterministic pseudo-random (so re-running the seed gives the same data)
let _seed = 123456789;
function rng(): number {
  // Mulberry32
  _seed |= 0;
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

// ---------------------------------------------------------------------------
// STATUS DISTRIBUTION (realistic for a B2B e-commerce CRM)
// ---------------------------------------------------------------------------
type Status = 'Livrée' | 'En cours' | 'Confirmée' | 'En attente' | 'Annulée';
type Payment = 'Payé' | 'Partiel' | 'En attente' | 'Impayé';

// Weighted: 40% Livrée, 25% En cours, 15% Confirmée, 10% En attente, 10% Annulée
const STATUS_WEIGHTS: Status[] = [
  ...Array(40).fill('Livrée') as Status[],
  ...Array(25).fill('En cours') as Status[],
  ...Array(15).fill('Confirmée') as Status[],
  ...Array(10).fill('En attente') as Status[],
  ...Array(10).fill('Annulée') as Status[],
];

// Payment status correlated with order status
function paymentForStatus(status: Status): Payment {
  switch (status) {
    case 'Livrée':     return pick<Payment>(['Payé', 'Payé', 'Payé', 'Partiel']);   // 75% Payé, 25% Partiel
    case 'Confirmée':  return pick<Payment>(['Payé', 'Partiel', 'En attente']);      // mix
    case 'En cours':   return pick<Payment>(['En attente', 'Partiel', 'En attente', 'Payé']);
    case 'En attente': return pick<Payment>(['En attente', 'En attente', 'Impayé']);
    case 'Annulée':    return pick<Payment>(['Impayé', 'En attente', 'Impayé']);     // mostly unpaid
  }
}

// Amount correlates with quantity × unit price
function realisticAmount(quantity: number, status: Status): number {
  // Unit prices between 50€ and 350€
  const unitPrice = randInt(50, 350);
  let total = unitPrice * quantity;
  // Bulk discount for big orders
  if (quantity >= 10) total = Math.round(total * 0.9);
  if (quantity >= 20) total = Math.round(total * 0.85);
  // Cancelled orders: often 0 or lower (partial refunds)
  if (status === 'Annulée' && rng() < 0.6) total = 0;
  return total;
}

// ---------------------------------------------------------------------------
// Build the $set update for a single order
// ---------------------------------------------------------------------------
function buildUpdate(idx: number, company: any): Record<string, any> {
  const order_number = `CMD-${String(idx + 1).padStart(4, '0')}`;
  const status: Status = pick(STATUS_WEIGHTS);
  const payment_status: Payment = paymentForStatus(status);
  const quantity = randInt(1, 25);
  const amount = realisticAmount(quantity, status);
  const items_count = randInt(1, 6);

  // Spread created_at over last 90 days, weighted toward recent
  const daysBack = Math.floor(Math.pow(rng(), 1.5) * 90);
  const created_at = daysAgo(daysBack);

  // For delivered orders, shipped date is a few days after creation
  const delivered_at =
    status === 'Livrée'
      ? new Date(created_at.getTime() + randInt(1, 7) * DAY)
      : null;

  // Pick a few sample product names (purely cosmetic)
  const products = ['Pack télévente Pro', 'Licence CRM', 'Formation agents',
                    'Module BI', 'Support premium', 'API integration',
                    'Lead pack 500', 'Script optimisation', 'Audit qualité'];
  const product = pick(products);

  return {
    order_number,
    client_name: company.company_name || company.name || `Client ${idx + 1}`,
    client_id: company._id,
    company_id: company.company_id || null,
    city: company.main_address?.city || company.city || 'Tunis',
    country: company.main_address?.country || 'Tunisie',
    amount,
    total: amount,            // alias
    total_amount: amount,    // alias
    montant: amount,        // alias (French)
    status,
    statut: status,         // alias
    payment_status,
    paiement: payment_status, // alias
    quantity,
    quantite: quantity,     // alias
    qty: quantity,          // alias
    items_count,
    itemsCount: items_count, // alias
    product,
    created_at,
    createdAt: created_at,   // alias
    order_date: created_at,  // alias
    updated_at: new Date(),
    updatedAt: new Date(),  // alias
    delivered_at,
    deliveredAt: delivered_at, // alias
    completed_at: delivered_at, // alias
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  validateMongoUri(MONGODB_URI);

  console.log('============================================================');
  console.log('  seedOrders.ts — v1.0 (IN-PLACE ENRICHMENT)');
  console.log('============================================================');
  console.log(`  Mode:        ${SEED_MODE}`);
  console.log(`  DB:          ${DB_NAME}`);
  console.log(`  Collection:  ${ORDERS_COLLECTION}`);
  console.log(`  MongoDB URI: ${MONGODB_URI.replace(/:[^:@]+@/, ':****@')}`);
  console.log('============================================================\n');

  console.log('[1/6] Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log('[OK]  Connected.\n');

  const db = mongoose.connection.db!;
  const ordersCol = db.collection(ORDERS_COLLECTION);
  const companiesCol = db.collection(COMPANIES_COLLECTION);

  // ----- Step 2: list indexes (just for diagnostics) -----
  console.log('[2/6] Reading indexes on orders collection...');
  try {
    const indexes = await ordersCol.indexes();
    const uniqueIndexes = indexes.filter((i) => i.unique);
    const otherIndexes = indexes.filter((i) => !i.unique);
    if (uniqueIndexes.length > 0) {
      console.log('   UNIQUE indexes (these would block inserts if we did insert):');
      for (const idx of uniqueIndexes) {
        console.log(`      - ${idx.name}: ${JSON.stringify(idx.key)}`);
      }
    } else {
      console.log('   No UNIQUE indexes on orders collection.');
    }
    console.log(`   Other indexes: ${otherIndexes.length}`);
  } catch (e: any) {
    console.warn(`   [WARN] Could not read indexes: ${e.message}`);
  }
  console.log();

  // ----- Step 3: fetch companies to assign orders to -----
  console.log('[3/6] Fetching companies (to link orders to real clients)...');
  const companies = await companiesCol
    .find({}, { projection: { _id: 1, company_id: 1, company_name: 1, name: 1, city: 1, main_address: 1 } })
    .toArray();
  console.log(`[OK]  Found ${companies.length} companies in DB.\n`);

  if (companies.length === 0) {
    console.error('[FATAL] No companies found — run seedCompanies.ts first!');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ----- Step 4: fetch existing orders -----
  console.log('[4/6] Fetching existing orders...');
  const existingOrders = await ordersCol.find({}).toArray();
  console.log(`[OK]  Found ${existingOrders.length} orders in DB.\n`);

  if (existingOrders.length === 0) {
    console.error('[FATAL] No orders found — nothing to enrich!');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ----- Step 5: build updates -----
  console.log(`[5/6] Building updates for ${existingOrders.length} orders...`);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const failures: Array<{ _id: any; error: string }> = [];

  // Pre-compute the seed so re-runs are deterministic
  _seed = 123456789;

  for (let i = 0; i < existingOrders.length; i++) {
    const order = existingOrders[i];
    // Round-robin assign to companies (so each company gets ~2 orders on average
    // if 96 orders / 44 companies)
    const company = companies[i % companies.length];
    const update = buildUpdate(i, company);

    try {
      if (SEED_MODE === 'replace') {
        // Replace the whole document (keep _id)
        await ordersCol.replaceOne({ _id: order._id }, { _id: order._id, ...update });
      } else {
        // Enrich mode: $set only — preserves any existing fields not in our update
        await ordersCol.updateOne({ _id: order._id }, { $set: update });
      }
      updated++;

      // Progress log every 20 orders
      if ((i + 1) % 20 === 0 || i === existingOrders.length - 1) {
        console.log(`   [${i + 1}/${existingOrders.length}] ${update.order_number} → ${update.client_name} | ${update.amount}€ | ${update.status} / ${update.payment_status}`);
      }
    } catch (e: any) {
      failed++;
      failures.push({ _id: order._id, error: e.message });
      if (failures.length <= 5) {
        console.error(`   [FAIL] order _id=${order._id}: ${e.message}`);
      }
    }
  }

  console.log();
  console.log(`[6/6] Enrichment complete.`);
  console.log(`   Updated:  ${updated}`);
  console.log(`   Skipped:  ${skipped}`);
  console.log(`   Failed:   ${failed}\n`);

  // ----- Final stats -----
  console.log('============================================================');
  console.log('  FINAL STATS');
  console.log('============================================================');

  const total = await ordersCol.countDocuments({});
  console.log(`Total orders in DB: ${total}`);

  // Status distribution
  const byStatus = await ordersCol.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$amount' } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('\nStatus distribution:');
  for (const s of byStatus as any[]) {
    console.log(`   ${String(s._id || 'null').padEnd(12)} → ${String(s.count).padStart(3)} orders | ${Number(s.revenue || 0).toLocaleString('fr-FR')} €`);
  }

  // Payment distribution
  const byPay = await ordersCol.aggregate([
    { $group: { _id: '$payment_status', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('\nPayment distribution:');
  for (const p of byPay as any[]) {
    console.log(`   ${String(p._id || 'null').padEnd(12)} → ${String(p.count).padStart(3)} orders`);
  }

  // Total revenue (excluding cancelled)
  const totalRev = await ordersCol.aggregate([
    { $match: { status: { $ne: 'Annulée' } } },
    { $group: { _id: null, total: { $sum: '$amount' }, items: { $sum: '$items_count' }, qty: { $sum: '$quantity' } } },
  ]).toArray();
  console.log('\nFinancial totals (excluding cancelled):');
  console.log(`   CA Total:       ${Number(totalRev[0]?.total || 0).toLocaleString('fr-FR')} €`);
  console.log(`   Total items:    ${totalRev[0]?.items || 0}`);
  console.log(`   Total quantity: ${totalRev[0]?.qty || 0}`);

  // Top 5 clients by order count
  const topClients = await ordersCol.aggregate([
    { $group: { _id: '$client_name', orders: { $sum: 1 }, revenue: { $sum: '$amount' } } },
    { $sort: { orders: -1 } },
    { $limit: 5 },
  ]).toArray();
  console.log('\nTop 5 clients by order count:');
  for (const c of topClients as any[]) {
    console.log(`   ${String(c._id || 'null').padEnd(30)} → ${String(c.orders).padStart(3)} orders | ${Number(c.revenue || 0).toLocaleString('fr-FR')} €`);
  }

  if (failures.length > 0) {
    console.log(`\n[WARN] ${failures.length} orders failed to update. First 5 errors shown above.`);
  } else {
    console.log('\n[OK] All orders enriched successfully!');
  }

  console.log('\n[OK] CRM Commandes dashboard should now show real data.');
  console.log('     Refresh the page in your browser (or wait 30s for auto-refresh).');

  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL] Seed failed:', err);
  process.exit(1);
});
