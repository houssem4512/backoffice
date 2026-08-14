/**
 * Diagnose your entire MongoDB database structure.
 *
 * Usage:
 *   cd backend
 *   npm run diagnose-db
 *
 * Output:
 *   - List of all collections with document counts
 *   - For each collection with documents:
 *     • First 2 documents (passwords/emails masked)
 *     • All field names + types
 *     • Top distinct values for key fields
 *
 * Read-only — does NOT modify any data.
 *
 * Paste the entire output in the chat and the backend will be adapted
 * to match your real schema.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { connectDB } from '../config/database';

function maskValue(key: string, value: any): any {
  if (value === null || value === undefined) return value;
  if (/password|pwd|pass|secret|hash|token/i.test(key)) {
    const s = String(value);
    return s.length > 10 ? `${s.slice(0, 4)}***${s.slice(-4)} (${s.length} chars)` : '***';
  }
  if (/email|mail/i.test(key) && typeof value === 'string') {
    const [u, d] = value.split('@');
    return u && d ? `${u.slice(0, 2)}***@${d}` : value;
  }
  if (/phone|tel/i.test(key) && typeof value === 'string') {
    return value.length > 4 ? `${value.slice(0, 3)}***${value.slice(-2)}` : value;
  }
  if (typeof value === 'string' && value.length > 100) {
    return `${value.slice(0, 100)}...`;
  }
  return value;
}

function typeOf(value: any): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'array(empty)';
    return `array<${typeof value[0]}>`;
  }
  if (value instanceof Date) return 'Date';
  if (value instanceof mongoose.Types.ObjectId) return 'ObjectId';
  if (typeof (mongoose as any).Decimal128 === 'function' && value instanceof (mongoose as any).Decimal128) return 'Decimal128';
  return typeof value;
}

async function describeCollection(db: any, name: string) {
  const coll = db.collection(name);
  const count = await coll.countDocuments();
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`📦 Collection: "${name}"  ·  ${count} document(s)`);
  console.log(`──────────────────────────────────────────────────────────`);

  if (count === 0) {
    console.log('  (empty collection — skipped)');
    return;
  }

  // Sample documents
  const samples = await coll.find({}).limit(2).toArray();
  console.log('\n=== SAMPLE DOCUMENTS ===');
  samples.forEach((doc: any, idx: number) => {
    console.log(`\n--- Document ${idx + 1} ---`);
    for (const [key, value] of Object.entries(doc)) {
      const type = typeOf(value);
      const masked = maskValue(key, value);
      console.log(`  ${key.padEnd(28)} ${type.padEnd(15)} ${JSON.stringify(masked)}`);
    }
  });

  // Field stats — top distinct values for string fields
  const fieldStats = samples[0] ? Object.keys(samples[0]) : [];
  const stringFields = [];
  for (const f of fieldStats) {
    const v = samples[0][f];
    if (typeof v === 'string' && !/password|pwd|pass|secret|hash|token|email|mail|phone|tel|_id|id|createdAt|updatedAt/i.test(f)) {
      stringFields.push(f);
    }
  }

  if (stringFields.length > 0) {
    console.log('\n=== TOP DISTINCT VALUES PER FIELD ===');
    for (const f of stringFields.slice(0, 8)) {
      try {
        const distinct = await coll.distinct(f);
        const top = distinct.slice(0, 10).map((v: any) => String(v));
        console.log(`  ${f.padEnd(25)} → ${top.join(' | ') || '(no values)'}`);
      } catch {
        // skip if not aggregatable
      }
    }
  }

  // Date range if there's a createdAt-like field
  const dateFields = fieldStats.filter((f) => {
    const v = samples[0][f];
    return v instanceof Date || /date|created|updated|at$/i.test(f);
  });
  if (dateFields.length > 0) {
    console.log('\n=== DATE RANGE ===');
    for (const f of dateFields.slice(0, 3)) {
      try {
        const min = await coll.findOne({}, { sort: { [f]: 1 } });
        const max = await coll.findOne({}, { sort: { [f]: -1 } });
        if (min && max && min[f] instanceof Date && max[f] instanceof Date) {
          console.log(`  ${f.padEnd(25)} ${min[f].toISOString()} → ${max[f].toISOString()}`);
        }
      } catch {
        // skip
      }
    }
  }
}

async function main() {
  await connectDB();
  const db = mongoose.connection.db!;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║          📊 DATABASE DIAGNOSTIC REPORT                  ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`Database: ${db.databaseName}`);

  const collections = await db.listCollections().toArray();
  console.log(`\n=== ALL COLLECTIONS (${collections.length}) ===`);
  for (const c of collections) {
    const count = await db.collection(c.name).countDocuments();
    console.log(`  • ${c.name.padEnd(30)} ${count} doc(s)`);
  }

  for (const c of collections) {
    await describeCollection(db, c.name);
  }

  // Heuristic mapping suggestions
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║          🎯 HEURISTIC MAPPING SUGGESTIONS              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const suggestions = [
    { logical: 'User (login)', patterns: ['users', 'user', 'admins', 'admin', 'accounts', 'account', 'utilisateurs'] },
    { logical: 'Candidate', patterns: ['candidates', 'candidate', 'candidats', 'candidat', 'leads', 'lead', 'profiles', 'profil'] },
    { logical: 'Company / Client', patterns: ['companies', 'company', 'clients', 'client', 'societes', 'societe', 'customers'] },
    { logical: 'Prospect', patterns: ['prospects', 'prospect', 'leads', 'opportunities'] },
    { logical: 'Order', patterns: ['orders', 'order', 'commandes', 'commande', 'devis'] },
    { logical: 'Payment', patterns: ['payments', 'payment', 'paiements', 'paiement', 'invoices', 'factures'] },
    { logical: 'Marketing Channel', patterns: ['channels', 'marketing', 'campaigns', 'campagnes'] },
    { logical: 'Activity Log', patterns: ['logs', 'activity', 'activities', 'audit', 'journal'] },
  ];

  for (const s of suggestions) {
    let found = null;
    for (const p of s.patterns) {
      if (collections.find((c) => c.name.toLowerCase() === p)) {
        found = p;
        break;
      }
    }
    if (found) {
      const count = await db.collection(found).countDocuments();
      console.log(`  ${s.logical.padEnd(25)} → "${found}" (${count} docs)  ✓ likely`);
    } else {
      // Fuzzy match
      const fuzzy = collections.find((c) => {
        const n = c.name.toLowerCase();
        return s.patterns.some((p) => n.includes(p));
      });
      if (fuzzy) {
        const count = await db.collection(fuzzy.name).countDocuments();
        console.log(`  ${s.logical.padEnd(25)} → "${fuzzy.name}" (${count} docs)  ? fuzzy match`);
      } else {
        console.log(`  ${s.logical.padEnd(25)} → (not found)`);
      }
    }
  }

  console.log('\n=== DONE ===');
  console.log('Paste everything above (from "DATABASE DIAGNOSTIC REPORT" to "DONE") in the chat.');
  console.log('The backend models + routes will be rewritten to match your real schema.');

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Diagnose failed:', err?.message || err);
  process.exit(1);
});