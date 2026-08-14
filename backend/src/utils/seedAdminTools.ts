/**
 * seedAdminTools.ts — Seeds default pricing + matching config into MongoDB.
 *
 * Run with:
 *   npx ts-node-dev --transpile-only seedAdminTools.ts
 *
 * Or (if running outside backend dir, copy to backend/src/utils/seedAdminTools.ts first):
 *   cd backend && npm run ts-node-dev --transpile-only src/utils/seedAdminTools.ts
 *
 * Idempotent: uses upsert on key='main', so re-running just refreshes defaults.
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import { PricingConfig } from '../models/PricingConfig';
import { MatchingConfig } from '../models/MatchingConfig';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

// ----------------------------------------------------------------------------
// DEFAULT PRICING CONFIG (matches what the original AdminTools.tsx had hardcoded)
// ----------------------------------------------------------------------------

const DEFAULT_PRICING = {
  key: 'main',
  ppp: {
    models: [
      { name: 'PPR', min: 4, cadence: 6, mult: 1,    conv: 10 },
      { name: 'PPF', min: 4, cadence: 4, mult: 1.55, conv: 6 },
      { name: 'PPI', min: 2, cadence: 2, mult: 2.45, conv: 4 },
    ],
    base: 180,
    tva: 19,
    timbre: 1,
  },
  languesRares: {
    models: [
      { category: 'Catégorie 1 (< 6 mois)',  credits: 2, valueDT: 5 },
      { category: 'Catégorie 2 (>= 6 mois)', credits: 4, valueDT: 5 },
    ],
    tva: 19,
    timbre: 1,
  },
  coefficients: [
    // Langue
    { group: 'langue',     code: 'AR', label: 'Arabe',     value: 0.92 },
    { group: 'langue',     code: 'FR', label: 'Français',  value: 1 },
    { group: 'langue',     code: 'EN', label: 'Anglais',   value: 1.18 },
    { group: 'langue',     code: 'BI', label: 'Bilingue',  value: 1.3 },
    // Expérience
    { group: 'experience', label: '< 6 mois',  value: 0.82 },
    { group: 'experience', label: '>= 6 mois', value: 1 },
    // Activité
    { group: 'activite',   label: 'Service client',   value: 0.88 },
    { group: 'activite',   label: 'Back office',      value: 0.92 },
    { group: 'activite',   label: 'Prise RDV',        value: 1 },
    { group: 'activite',   label: 'Téléprospection',  value: 1.12 },
    { group: 'activite',   label: 'Télévente',        value: 1.12 },
    // Opération
    { group: 'operation',  label: 'Simple',    value: 1 },
    { group: 'operation',  label: 'Standard', value: 1 },
    { group: 'operation',  label: 'Complexe',  value: 1 },
    // Ville
    { group: 'ville',      label: 'Standard', value: 1 },
    { group: 'ville',      label: 'Tension',   value: 1.1 },
    // Genre
    { group: 'genre',      label: 'Mix',      value: 1 },
    { group: 'genre',      label: 'Contraint', value: 1.08 },
  ],
  validityTranches: [
    { days: 45,  tranches: 1 },
    { days: 60,  tranches: 2 },
    { days: 90,  tranches: 3 },
    { days: 120, tranches: 4 },
    { days: 150, tranches: 5 },
    { days: 180, tranches: 6 },
    { days: 270, tranches: 9 },
    { days: 365, tranches: 12 },
  ],
  preferentialPrices: [
    { client: 'CallCenter Paris', model: 'PPP',  defaultCoef: 1.0,  newCoef: 0.85, remise: 15, type: 'À vie',      orders: 'TOUTES' },
    { client: 'Global Voice UK',  model: 'PPF',  defaultCoef: 1.55, newCoef: 1.4,  remise: 10, type: 'Ponctuelle', orders: '#42, #45' },
    { client: 'LinguaCall',       model: 'Langues Rares', defaultCoef: 5.0, newCoef: 4.5, remise: 10, type: 'À vie', orders: 'TOUTES' },
  ],
};

// ----------------------------------------------------------------------------
// DEFAULT MATCHING CONFIG — 9 levels N1..N9
// ----------------------------------------------------------------------------

type MatchingCell = 'OK' | 'KO' | 'ANY';

const MATCHING_COLUMNS = ['langue', 'genre', 'expGlobale', 'activite', 'expActivite', 'operation', 'expOperation', 'ville', 'modeTravail'];

function defaultCells(overrides: Record<string, MatchingCell> = {}): Record<string, MatchingCell> {
  const cells: Record<string, MatchingCell> = {};
  for (const c of MATCHING_COLUMNS) cells[c] = 'OK';
  return { ...cells, ...overrides };
}

const DEFAULT_MATCHING = {
  key: 'main',
  fixedCriteria: ['Langue', 'Genre', 'Expérience globale', 'Activité', 'Expérience Activité', 'Ville', 'Mode de travail'],
  levels: [
    { level: 'N1', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells() },
    { level: 'N2', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells({ expOperation: 'KO' }) },
    { level: 'N3', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
    { level: 'N4', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells() },
    { level: 'N5', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells({ expOperation: 'KO' }) },
    { level: 'N6', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
    { level: 'N7', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells() },
    { level: 'N8', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells({ expOperation: 'KO' }) },
    { level: 'N9', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
  ],
};

// ----------------------------------------------------------------------------

async function run() {
  console.log('🔌 Connecting to MongoDB…');
  await mongoose.connect(MONGODB_URI);
  mongoose.set('strictQuery', true);
  console.log('✅ Connected to:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));

  console.log('\n📦 Seeding PricingConfig…');
  const pricing = await PricingConfig.findOneAndUpdate(
    { key: 'main' },
    { $set: DEFAULT_PRICING },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log('   ✓ PPP models:', pricing.ppp.models.length);
  console.log('   ✓ Coefficients:', pricing.coefficients.length, '(by group:');
  const byGroup: Record<string, number> = {};
  pricing.coefficients.forEach((c: any) => { byGroup[c.group] = (byGroup[c.group] || 0) + 1; });
  Object.entries(byGroup).forEach(([g, n]) => console.log(`       - ${g}: ${n}`));
  console.log('   ✓ Validity tranches:', pricing.validityTranches.length);
  console.log('   ✓ Preferential prices:', pricing.preferentialPrices.length);

  console.log('\n📦 Seeding MatchingConfig…');
  const matching = await MatchingConfig.findOneAndUpdate(
    { key: 'main' },
    { $set: DEFAULT_MATCHING },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log('   ✓ Fixed criteria:', matching.fixedCriteria.length);
  console.log('   ✓ Matching levels:', matching.levels.length);
  matching.levels.forEach((l: any) => {
    const ko = Object.entries(l.cells || {}).filter(([_k, v]) => v === 'KO').map(([k]) => k);
    const any = Object.entries(l.cells || {}).filter(([_k, v]) => v === 'ANY').map(([k]) => k);
    console.log(`       - ${l.level} [${l.dateRange?.label}]: KO=${ko.length ? ko.join(',') : '—'} ANY=${any.length ? any.join(',') : '—'}`);
  });

  console.log('\n🎉 Done! AdminTools config seeded.');
  await mongoose.disconnect();
  process.exit(0);
}

run().catch((e) => {
  console.error('❌ Seed failed:', e);
  process.exit(1);
});
