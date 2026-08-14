/**
 * seedPayments.ts — v1.0 (IN-PLACE ENRICHMENT + AUTO-CREATE)
 * -----------------------------------------------------------------------------
 * Fixes the CRM Paiements page that's either:
 *   (a) crashing with `Cannot read properties of undefined (reading 'toString')`
 *       because payment docs have no fields and `firstNonEmpty(...).toString()`
 *       blows up on `undefined`
 *   (b) showing all zeros / "—" because no `payments` collection exists yet
 *
 * PROBLEM
 *   The existing payment documents in the `payments` collection have NO useful
 *   fields — the page's normalizePayment() (when fixed) will return safe
 *   fallbacks, but KPIs will all be 0.
 *
 * FIX
 *   1. If `payments` collection has existing documents → UPDATE each in place
 *      with realistic payment data linked to one of the 96 enriched orders.
 *   2. If `payments` collection is empty or has fewer docs than orders →
 *      CREATE missing payment documents (one per order, by default).
 *
 *   Each enriched / created payment has:
 *     • payment_number:  PAY-0001 ... PAY-XXXX  (stable, unique)
 *     • order_number:   CMD-0001 ... CMD-0096   (matches the order)
 *     • client_name:    from the linked order
 *     • client_id:      from the linked order
 *     • amount:         the order's amount
 *     • paid_amount:    realistic based on order status:
 *                         Livrée    → mostly fully paid (some Partiel)
 *                         Confirmée → mostly paid (some Partiel)
 *                         En cours  → partial deposit
 *                         En attente → 0
 *                         Annulée   → 0 (refund)
 *     • remaining:      max(0, amount - paid_amount)
 *     • status:         Payé / Partiel / En attente / En retard
 *     • payment_method: Virement / Chèque / Cash (weighted: 60% Virement, 25% Chèque, 15% Cash)
 *     • due_date:      created_at + 30 days
 *     • paid_at:       for Payé/Partiel only, between created_at and due_date
 *     • created_at:    same as the order's created_at
 *
 * WHY THIS APPROACH
 *   1. The 96 orders are already enriched (seedOrders.ts v1.0 was run).
 *   2. By reading the orders, we get accurate amount / client / status per payment.
 *   3. No risk of E11000 unique-index conflicts on `payments` (we update by _id).
 *   4. If `payments` collection doesn't exist yet, MongoDB creates it on first write.
 *
 * RUN (from backend/ directory):
 *   npx ts-node-dev --transpile-only src/utils/seedPayments.ts
 *
 * ENV:
 *   MONGODB_URI="mongodb://..."    (Atlas connection string)
 *
 * OPTIONS:
 *   SEED_MODE=enrich    → UPDATE existing payments in-place, CREATE missing
 *                         ones if count < orders count (default)
 *   SEED_MODE=replace   → DELETE all existing first, then INSERT one per order
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

const SEED_MODE = process.env.SEED_MODE || 'enrich';
const DB_NAME = process.env.DB_NAME || 'CCM_DB';
const PAYMENTS_COLLECTION = 'payments';
const ORDERS_COLLECTION = 'orders';

// ---------------------------------------------------------------------------
// URI validation
// ---------------------------------------------------------------------------
function validateMongoUri(uri: string): void {
  const portInPathMatch = uri.match(/:\d+\/(\d+)\/[^?]+/);
  if (portInPathMatch) {
    console.error('[FATAL] MONGODB_URI looks malformed (duplicate /PORT/ in path).');
    console.error('   Found:', portInPathMatch[0]);
    process.exit(1);
  }
  const dbNameMatch = uri.match(/\/([^/?]+)(\?|$)/);
  if (dbNameMatch && dbNameMatch[1].includes('/')) {
    console.error('[FATAL] MONGODB_URI contains "/" in the database name segment.');
    console.error(`   Database name parsed: "${dbNameMatch[1]}"`);
    process.exit(1);
  }
  if (!uri.includes('CCM_DB') && !uri.endsWith('/callcentermatch')) {
    console.warn('[WARN] MONGODB_URI does not mention "CCM_DB".');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY = 86400000;
const now = Date.now();

// Deterministic PRNG so re-running gives the same data
let _seed = 987654321;
function rng(): number {
  _seed |= 0;
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

// ---------------------------------------------------------------------------
// Payment status & method derivation (correlated with order status)
// ---------------------------------------------------------------------------
type PaymentStatus = 'Payé' | 'Partiel' | 'En attente' | 'En retard';
type PaymentMethod = 'Virement' | 'Chèque' | 'Cash';

// Weighted method: 60% Virement, 25% Chèque, 15% Cash
const METHODS: PaymentMethod[] = [
  ...Array(60).fill('Virement') as PaymentMethod[],
  ...Array(25).fill('Chèque')   as PaymentMethod[],
  ...Array(15).fill('Cash')     as PaymentMethod[],
];

/**
 * Given an order status, return:
 *   - payment status
 *   - paid_amount as a fraction of order amount (0..1)
 *   - paid_at date (null if not yet paid)
 */
function derivePaymentFromOrder(
  orderStatus: string,
  amount: number,
  createdAt: Date,
  dueDate: Date,
): { status: PaymentStatus; paidFraction: number; paid_at: Date | null } {
  const s = (orderStatus || '').toLowerCase();

  if (s.includes('livr') || s.includes('complet')) {
    // Delivered → mostly Payé, sometimes Partiel
    if (rng() < 0.8) {
      const paid_at = new Date(createdAt.getTime() + randInt(1, 25) * DAY);
      return { status: 'Payé', paidFraction: 1.0, paid_at };
    } else {
      const paid_at = new Date(createdAt.getTime() + randInt(1, 20) * DAY);
      return { status: 'Partiel', paidFraction: 0.5 + rng() * 0.3, paid_at };
    }
  }

  if (s.includes('confirm')) {
    // Confirmed → mostly Payé (deposit), some Partiel
    if (rng() < 0.7) {
      const paid_at = new Date(createdAt.getTime() + randInt(1, 10) * DAY);
      return { status: 'Payé', paidFraction: 1.0, paid_at };
    } else {
      const paid_at = new Date(createdAt.getTime() + randInt(1, 10) * DAY);
      return { status: 'Partiel', paidFraction: 0.3 + rng() * 0.4, paid_at };
    }
  }

  if (s.includes('cours')) {
    // In progress → usually Partiel (deposit paid), some En attente
    if (rng() < 0.6) {
      const paid_at = new Date(createdAt.getTime() + randInt(1, 5) * DAY);
      return { status: 'Partiel', paidFraction: 0.3 + rng() * 0.2, paid_at };
    } else {
      return { status: 'En attente', paidFraction: 0, paid_at: null };
    }
  }

  if (s.includes('annul')) {
    // Cancelled → usually no payment, sometimes En retard (refund overdue)
    if (rng() < 0.85) {
      return { status: 'En attente', paidFraction: 0, paid_at: null };
    } else {
      return { status: 'En retard', paidFraction: 0, paid_at: null };
    }
  }

  if (s.includes('attente')) {
    // Pending → mostly En attente, sometimes En retard (overdue)
    if (rng() < 0.7) {
      return { status: 'En attente', paidFraction: 0, paid_at: null };
    } else {
      return { status: 'En retard', paidFraction: 0, paid_at: null };
    }
  }

  // Default
  return { status: 'En attente', paidFraction: 0, paid_at: null };
}

// ---------------------------------------------------------------------------
// Build the $set update (or new document) for a single payment
// ---------------------------------------------------------------------------
function buildPaymentData(idx: number, order: any) {
  const payment_number = `PAY-${String(idx + 1).padStart(4, '0')}`;
  const order_number = order.order_number || `CMD-${String(idx + 1).padStart(4, '0')}`;
  const client_name = order.client_name || 'Client inconnu';
  const client_id = order.client_id || null;
  const amount = Number(order.amount) || 0;
  const created_at = order.created_at || new Date(now - randInt(1, 90) * DAY);
  const due_date = new Date(new Date(created_at).getTime() + 30 * DAY);

  const { status, paidFraction, paid_at } = derivePaymentFromOrder(
    order.status || 'En cours',
    amount,
    created_at,
    due_date,
  );

  const paid_amount = Math.round(amount * paidFraction);
  const remaining = Math.max(0, amount - paid_amount);
  const payment_method: PaymentMethod = pick(METHODS);

  return {
    payment_number,
    order_number,
    order_id: order._id,
    client_name,
    client_id,
    amount,
    paid_amount,
    remaining,
    status,
    payment_method,
    created_at,
    due_date,
    paid_at,
    updated_at: new Date(),
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  validateMongoUri(MONGODB_URI);

  console.log('============================================================');
  console.log('  seedPayments.ts — v1.0 (IN-PLACE ENRICHMENT + AUTO-CREATE)');
  console.log('============================================================');
  console.log(`  Mode:        ${SEED_MODE}`);
  console.log(`  DB:          ${DB_NAME}`);
  console.log(`  Collection:  ${PAYMENTS_COLLECTION}`);
  console.log(`  MongoDB URI: ${MONGODB_URI.replace(/:[^:@]+@/, ':****@')}`);
  console.log('============================================================\n');

  console.log('[1/7] Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log('[OK]  Connected.\n');

  const db = mongoose.connection.db!;
  const paymentsCol = db.collection(PAYMENTS_COLLECTION);
  const ordersCol = db.collection(ORDERS_COLLECTION);

  // ----- Step 2: list indexes -----
  console.log('[2/7] Reading indexes on payments collection...');
  try {
    const indexes = await paymentsCol.indexes();
    const uniqueIndexes = indexes.filter((i) => i.unique);
    if (uniqueIndexes.length > 0) {
      console.log('   UNIQUE indexes (these would block inserts):');
      for (const idx of uniqueIndexes) {
        console.log(`      - ${idx.name}: ${JSON.stringify(idx.key)}`);
      }
    } else {
      console.log('   No UNIQUE indexes on payments collection.');
    }
    console.log(`   Other indexes: ${indexes.length - uniqueIndexes.length}`);
  } catch (e: any) {
    console.warn(`   [WARN] Could not read indexes (collection may not exist yet): ${e.message}`);
  }
  console.log();

  // ----- Step 3: fetch orders (to link payments to) -----
  console.log('[3/7] Fetching orders (to link payments to real orders)...');
  const orders = await ordersCol
    .find({})
    .sort({ created_at: 1 })
    .toArray();
  console.log(`[OK]  Found ${orders.length} orders in DB.\n`);

  if (orders.length === 0) {
    console.error('[FATAL] No orders found — run seedOrders.ts first!');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ----- Step 4: fetch existing payments -----
  console.log('[4/7] Fetching existing payments...');
  const existingPayments = await paymentsCol.find({}).toArray();
  console.log(`[OK]  Found ${existingPayments.length} payments in DB.\n`);

  // ----- Step 5: build the work list -----
  console.log('[5/7] Building payment update/insert plan...');

  // Reset PRNG seed for deterministic output
  _seed = 987654321;

  let updated = 0;
  let inserted = 0;
  let failed = 0;
  const failures: Array<{ _id: any; error: string }> = [];

  if (SEED_MODE === 'replace' && existingPayments.length > 0) {
    const del = await paymentsCol.deleteMany({});
    console.log(`   [DEL] Deleted ${del.deletedCount} existing payments (replace mode)\n`);
    existingPayments.length = 0;
  }

  // Case A: enrich existing payments (paired with order by index)
  for (let i = 0; i < existingPayments.length; i++) {
    const payment = existingPayments[i];
    const order = orders[i % orders.length];
    const data = buildPaymentData(i, order);

    try {
      if (SEED_MODE === 'replace') {
        await paymentsCol.replaceOne(
          { _id: payment._id },
          { _id: payment._id, ...data },
        );
      } else {
        await paymentsCol.updateOne(
          { _id: payment._id },
          { $set: data },
        );
      }
      updated++;

      if ((i + 1) % 20 === 0 || i === existingPayments.length - 1) {
        console.log(`   [UPDATE ${i + 1}/${existingPayments.length}] ${data.payment_number} → ${data.client_name} | ${data.amount}€ (paid ${data.paid_amount}€) | ${data.status} / ${data.payment_method}`);
      }
    } catch (e: any) {
      failed++;
      failures.push({ _id: payment._id, error: e.message });
      if (failures.length <= 5) {
        console.error(`   [FAIL] payment _id=${payment._id}: ${e.message}`);
      }
    }
  }

  // Case B: if we have fewer payments than orders, create the missing ones
  // (only in 'enrich' mode — in 'replace' mode we already deleted them above
  //  and the loop below will create one per order)
  const missingCount = orders.length - existingPayments.length;
  if (missingCount > 0) {
    console.log(`\n   [INFO] Creating ${missingCount} missing payment(s) (one per unmatched order)...`);
    const docsToInsert: any[] = [];
    for (let i = 0; i < missingCount; i++) {
      const orderIdx = existingPayments.length + i;
      const order = orders[orderIdx % orders.length];
      const data = buildPaymentData(orderIdx, order);
      docsToInsert.push(data);
    }

    try {
      const result = await paymentsCol.insertMany(docsToInsert, { ordered: false });
      inserted = result.insertedCount;
      console.log(`   [OK] Inserted ${inserted} new payments`);

      if (inserted > 0) {
        for (let i = 0; i < Math.min(5, inserted); i++) {
          const d = docsToInsert[i];
          console.log(`      [INSERT ${i + 1}/${inserted}] ${d.payment_number} → ${d.client_name} | ${d.amount}€ (paid ${d.paid_amount}€) | ${d.status} / ${d.payment_method}`);
        }
        if (inserted > 5) console.log(`      ... and ${inserted - 5} more`);
      }
    } catch (err: any) {
      const writeErrors = (err as any)?.writeErrors || [];
      if (writeErrors.length > 0) {
        console.log(`   [WARN] ${writeErrors.length} insert(s) failed.`);
        for (const we of writeErrors.slice(0, 5)) {
          console.log(`      - ${we.err?.errmsg || we.err?.message || JSON.stringify(we.err)}`);
        }
        failed += writeErrors.length;
      }
      inserted = (err as any)?.insertedCount || (err as any)?.result?.insertedCount || 0;
      if (inserted > 0) {
        console.log(`   [PARTIAL] Inserted ${inserted} / ${docsToInsert.length} payments`);
      }
    }
  }

  console.log();
  console.log(`[6/7] Enrichment complete.`);
  console.log(`   Updated:  ${updated}`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Failed:   ${failed}\n`);

  // ----- Final stats -----
  console.log('============================================================');
  console.log('  FINAL STATS');
  console.log('============================================================');

  const total = await paymentsCol.countDocuments({});
  console.log(`Total payments in DB: ${total}`);

  // Status distribution
  const byStatus = await paymentsCol.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' }, paid: { $sum: '$paid_amount' } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('\nStatus distribution:');
  for (const s of byStatus as any[]) {
    console.log(`   ${String(s._id || 'null').padEnd(12)} → ${String(s.count).padStart(3)} payments | ${Number(s.total || 0).toLocaleString('fr-FR')} € total | ${Number(s.paid || 0).toLocaleString('fr-FR')} € paid`);
  }

  // Method distribution
  const byMethod = await paymentsCol.aggregate([
    { $group: { _id: '$payment_method', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]).toArray();
  console.log('\nPayment method distribution:');
  for (const m of byMethod as any[]) {
    console.log(`   ${String(m._id || 'null').padEnd(12)} → ${String(m.count).padStart(3)} payments`);
  }

  // Financial totals
  const totals = await paymentsCol.aggregate([
    { $group: {
      _id: null,
      totalAmount: { $sum: '$amount' },
      totalPaid:   { $sum: '$paid_amount' },
      totalRemaining: { $sum: '$remaining' },
    } },
  ]).toArray();
  const t = totals[0] || {};
  const totalAmount = Number(t.totalAmount || 0);
  const totalPaid = Number(t.totalPaid || 0);
  const totalRemaining = Number(t.totalRemaining || 0);
  const recoveryRate = totalAmount > 0 ? Math.round((totalPaid / totalAmount) * 100) : 0;

  console.log('\nFinancial totals:');
  console.log(`   Montant total:       ${totalAmount.toLocaleString('fr-FR')} €`);
  console.log(`   Montant payé:        ${totalPaid.toLocaleString('fr-FR')} €`);
  console.log(`   Reste à recouvrer:   ${totalRemaining.toLocaleString('fr-FR')} €`);
  console.log(`   Taux recouvrement:   ${recoveryRate}%`);

  // Top 5 clients by paid amount
  const topClients = await paymentsCol.aggregate([
    { $group: { _id: '$client_name', payments: { $sum: 1 }, paid: { $sum: '$paid_amount' } } },
    { $sort: { paid: -1 } },
    { $limit: 5 },
  ]).toArray();
  console.log('\nTop 5 clients by paid amount:');
  for (const c of topClients as any[]) {
    console.log(`   ${String(c._id || 'null').padEnd(30)} → ${String(c.payments).padStart(3)} payments | ${Number(c.paid || 0).toLocaleString('fr-FR')} € paid`);
  }

  if (failures.length > 0) {
    console.log(`\n[WARN] ${failures.length} payments failed. First 5 errors shown above.`);
  } else {
    console.log('\n[OK] All payments enriched / created successfully!');
  }

  console.log('\n[OK] CRM Paiements dashboard should now show real data.');
  console.log('     Refresh the page in your browser (or wait 30s for auto-refresh).');

  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL] Seed failed:', err);
  process.exit(1);
});
