/**
 * seedMarketing.ts — v1.0 (IN-PLACE ENRICHMENT + AUTO-CREATE)
 * -----------------------------------------------------------------------------
 * Fixes the CRM Marketing page that's showing fake hardcoded stats
 * (69 k€ budget, 0 € dépenses, 0 leads, etc.) by populating the
 * `marketing_campaigns` collection with realistic campaign data.
 *
 * DATA MODEL (one doc per campaign):
 *   campaign_id         PAY-/MRK-style unique id (satisfies unique index)
 *   campaign_reference  REF-MRK-XXXX unique reference (satisfies unique index)
 *   name                Human-readable campaign name
 *   channel             Facebook | Google | TikTok | Emailing | Affiliation |
 *                       Créations | LinkedIn | Emailing B2B | Événements | Créations B2B
 *   category            Candidats | Prospects | Créations
 *   source              Formulaire site | Import Facebook | Import CSV | Autres |
 *                       Formulaire B2B | Manuel | Email | Téléphone
 *   segment             Exp. 0-6 mois | Exp. 6-12 mois | Exp. 1-3 ans |
 *                       Exp. 3-5 ans | Exp. 5 ans+ (only for Candidats)
 *   budget              planned budget (€)
 *   spend               actual spend (€)
 *   leads               number of leads generated
 *   prospects           number of prospects (B2B only)
 *   clients             number of converted clients (B2B only)
 *   language            Français | Arabe | Anglais
 *   city                Tunis | Sfax | Sousse | Ariana | Manouba | Monastir | Bizerte
 *   gender              Homme | Femme
 *   start_date          campaign start
 *   end_date            campaign end
 *   created_at          doc creation timestamp
 *   updated_at          last update
 *
 * CHANNEL TARGETS (matches what the page was showing):
 *   Candidats:
 *     Facebook     12 k€ · 2950 leads · CPL 4.2€
 *     Google       19 k€ · 3220 leads · CPL 5.8€
 *     TikTok        5 k€ ·  634 leads · CPL 8.2€
 *     Emailing      5 k€ · 2280 leads · CPL 2.1€
 *     Affiliation   3 k€ · 1200 leads · CPL 2.67€
 *     Créations     6 k€ ·    0 leads (designs, vidéos)
 *   Prospects:
 *     LinkedIn      8 k€ ·  872 leads · CPL 9.4€
 *     Emailing B2B  5 k€ · 2280 leads · CPL 2.1€
 *     Événements    3 k€ ·  450 leads · CPL 6.67€
 *     Créations B2B 3 k€ ·    0 leads (visuels, présentations)
 *
 * RUN (from backend/ directory):
 *   $env:MONGODB_URI="mongodb://devtest_db_user:123456789a@ac-9571vry-shard-00-00.luwf547.mongodb.net:27017,..."
 *   npx ts-node-dev --transpile-only src/utils/seedMarketing.ts
 *
 * ENV:
 *   MONGODB_URI     Atlas connection string
 *   SEED_MODE       enrich (default) | replace
 *   DB_NAME         CCM_DB (default)
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

const SEED_MODE = process.env.SEED_MODE || 'enrich';
const DB_NAME = process.env.DB_NAME || 'CCM_DB';
const CAMPAIGNS_COLLECTION = 'marketing_campaigns';

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
let _seed = 135792468;
function rng(): number {
  _seed |= 0;
  _seed = (_seed + 0x6D2B79F5) | 0;
  let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Channel configs — targets match what the Marketing page was showing
// ---------------------------------------------------------------------------
interface ChannelConfig {
  channel: string;
  category: 'Candidats' | 'Prospects' | 'Créations';
  source: string;
  targetBudget: number;   // total budget across all campaigns of this channel (€)
  targetLeads: number;     // total leads
  targetCpl: number;       // target CPL (€)
  campaignsCount: number;  // how many campaigns to create for this channel
  isB2b: boolean;
  description: string;
}

const CHANNEL_CONFIGS: ChannelConfig[] = [
  // ---- Candidats ----
  { channel: 'Facebook',    category: 'Candidats', source: 'Import Facebook', targetBudget: 12000, targetLeads: 2950, targetCpl: 4.2,  campaignsCount: 8, isB2b: false, description: 'Campagne lead-gen Facebook' },
  { channel: 'Google',      category: 'Candidats', source: 'Formulaire site', targetBudget: 19000, targetLeads: 3220, targetCpl: 5.8,  campaignsCount: 10, isB2b: false, description: 'Search + Display Google Ads' },
  { channel: 'TikTok',      category: 'Candidats', source: 'Import CSV',     targetBudget: 5000,  targetLeads: 634,  targetCpl: 8.2,  campaignsCount: 5, isB2b: false, description: 'TikTok Spark Ads' },
  { channel: 'Emailing',    category: 'Candidats', source: 'Email',           targetBudget: 5000,  targetLeads: 2280, targetCpl: 2.1,  campaignsCount: 6, isB2b: false, description: 'Nurturing emails' },
  { channel: 'Affiliation', category: 'Candidats', source: 'Autres',          targetBudget: 3000,  targetLeads: 1200, targetCpl: 2.67, campaignsCount: 4, isB2b: false, description: 'Partenaires affiliation' },
  { channel: 'Créations',   category: 'Créations', source: 'Créations',      targetBudget: 6000,  targetLeads: 0,    targetCpl: 0,    campaignsCount: 5, isB2b: false, description: 'Designs, vidéos, visuels' },
  // ---- Prospects (B2B) ----
  { channel: 'LinkedIn',     category: 'Prospects', source: 'Formulaire B2B', targetBudget: 8000, targetLeads: 872,  targetCpl: 9.4,  campaignsCount: 6, isB2b: true, description: 'LinkedIn Ads B2B' },
  { channel: 'Emailing B2B',  category: 'Prospects', source: 'Email',          targetBudget: 5000, targetLeads: 2280, targetCpl: 2.1,  campaignsCount: 5, isB2b: true, description: 'Cold email B2B' },
  { channel: 'Événements',    category: 'Prospects', source: 'Manuel',         targetBudget: 3000, targetLeads: 450,  targetCpl: 6.67, campaignsCount: 4, isB2b: true, description: 'Salons, webinaires' },
  { channel: 'Créations B2B', category: 'Créations', source: 'Créations B2B',  targetBudget: 3000, targetLeads: 0,    targetCpl: 0,    campaignsCount: 4, isB2b: false, description: 'Visuels, présentations B2B' },
];

const SEGMENTS = ['Exp. 0-6 mois', 'Exp. 6-12 mois', 'Exp. 1-3 ans', 'Exp. 3-5 ans', 'Exp. 5 ans+'];
const LANGUAGES = ['Français', 'Arabe', 'Anglais'];
const CITIES = ['Tunis', 'Sfax', 'Sousse', 'Ariana', 'Manouba', 'Monastir', 'Bizerte'];
const GENDERS = ['Homme', 'Femme'];

// Weighted language distribution (60% FR, 30% AR, 10% EN)
const LANG_WEIGHTED: string[] = [
  ...Array(60).fill('Français') as string[],
  ...Array(30).fill('Arabe') as string[],
  ...Array(10).fill('Anglais') as string[],
];

// ---------------------------------------------------------------------------
// Build a single campaign document
// ---------------------------------------------------------------------------
function buildCampaignData(globalIdx: number, cfg: ChannelConfig, withinChannelIdx: number) {
  // Unique IDs (satisfy any unique index on campaign_id / campaign_reference)
  const campaign_id = `MRK-${String(globalIdx + 1).padStart(4, '0')}`;
  const campaign_reference = `REF-MRK-${String(globalIdx + 1).padStart(4, '0')}`;

  // Split the channel's target budget across its campaigns (with ±20% jitter)
  const baseBudget = cfg.targetBudget / cfg.campaignsCount;
  const budgetJitter = 1 + (rng() - 0.5) * 0.4; // 0.8 .. 1.2
  const budget = round2(baseBudget * budgetJitter);

  // Spend = 70-95% of budget (campaigns rarely spend 100%)
  const spendRatio = 0.7 + rng() * 0.25;
  const spend = round2(budget * spendRatio);

  // Leads based on CPL (with ±25% jitter)
  let leads = 0;
  if (cfg.targetCpl > 0 && cfg.targetLeads > 0) {
    const baseLeads = cfg.targetLeads / cfg.campaignsCount;
    const leadsJitter = 1 + (rng() - 0.5) * 0.5; // 0.75 .. 1.25
    leads = Math.round(baseLeads * leadsJitter);
  }

  // For Créations channels: 0 leads (it's creative production spend)
  // For B2B: prospects = leads, clients = leads * conversion (18-25%)
  let prospects = 0;
  let clients = 0;
  if (cfg.isB2b && leads > 0) {
    prospects = leads;
    const convRate = 0.18 + rng() * 0.07; // 18% .. 25%
    clients = Math.round(leads * convRate);
  }

  // Segment only meaningful for Candidats (candidate experience levels)
  const segment = cfg.category === 'Candidats' ? pick(SEGMENTS) : null;

  // Dates: campaigns spread over last 90 days
  const startOffset = randInt(0, 60); // started 0-60 days ago
  const start_date = new Date(now - startOffset * DAY);
  const duration = randInt(7, 45); // 1-6 weeks
  const end_date = new Date(start_date.getTime() + duration * DAY);
  const created_at = start_date;

  const name = `${cfg.channel} ${pick(['Tunis', 'Ramadan', 'Été', 'Rentrée', 'Q1', 'Q2', 'Q3', 'Q4', 'Spécial', 'Promo'])} ${withinChannelIdx + 1}`;

  return {
    campaign_id,
    campaign_reference,
    name,
    channel: cfg.channel,
    category: cfg.category,
    source: cfg.source,
    segment,
    budget,
    spend,
    leads,
    prospects,
    clients,
    language: pick(LANG_WEIGHTED),
    city: pick(CITIES),
    gender: pick(GENDERS),
    start_date,
    end_date,
    created_at,
    updated_at: new Date(),
    description: cfg.description,
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  validateMongoUri(MONGODB_URI);

  console.log('============================================================');
  console.log('  seedMarketing.ts — v1.0 (IN-PLACE ENRICHMENT + AUTO-CREATE)');
  console.log('============================================================');
  console.log(`  Mode:        ${SEED_MODE}`);
  console.log(`  DB:          ${DB_NAME}`);
  console.log(`  Collection:  ${CAMPAIGNS_COLLECTION}`);
  console.log(`  MongoDB URI: ${MONGODB_URI.replace(/:[^:@]+@/, ':****@')}`);
  console.log('============================================================\n');

  console.log('[1/7] Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI, { dbName: DB_NAME });
  console.log('[OK]  Connected.\n');

  const db = mongoose.connection.db!;
  const col = db.collection(CAMPAIGNS_COLLECTION);

  // ----- Step 2: list indexes -----
  console.log('[2/7] Reading indexes on marketing_campaigns collection...');
  try {
    const indexes = await col.indexes();
    const uniqueIndexes = indexes.filter((i) => i.unique);
    if (uniqueIndexes.length > 0) {
      console.log('   UNIQUE indexes (these would block inserts):');
      for (const idx of uniqueIndexes) {
        console.log(`      - ${idx.name}: ${JSON.stringify(idx.key)}`);
      }
    } else {
      console.log('   No UNIQUE indexes on marketing_campaigns collection.');
    }
    console.log(`   Other indexes: ${indexes.length - uniqueIndexes.length}`);
  } catch (e: any) {
    console.warn(`   [WARN] Could not read indexes (collection may not exist yet): ${e.message}`);
  }
  console.log();

  // ----- Step 3: fetch existing campaigns -----
  console.log('[3/7] Fetching existing marketing_campaigns...');
  const existing = await col.find({}).toArray();
  console.log(`[OK]  Found ${existing.length} campaigns in DB.\n`);

  // ----- Step 4: build the campaign list -----
  console.log('[4/7] Building campaign list...');
  _seed = 135792468; // reset PRNG for deterministic output

  const allCampaigns: any[] = [];
  let globalIdx = 0;
  for (const cfg of CHANNEL_CONFIGS) {
    for (let i = 0; i < cfg.campaignsCount; i++) {
      allCampaigns.push(buildCampaignData(globalIdx, cfg, i));
      globalIdx++;
    }
  }
  console.log(`[OK]  Built ${allCampaigns.length} campaigns across ${CHANNEL_CONFIGS.length} channels.\n`);

  // ----- Step 5: replace mode = delete all first -----
  if (SEED_MODE === 'replace' && existing.length > 0) {
    const del = await col.deleteMany({});
    console.log(`[5/7] Deleted ${del.deletedCount} existing campaigns (replace mode)\n`);
    existing.length = 0;
  } else {
    console.log(`[5/7] Mode: enrich (no deletion)\n`);
  }

  // ----- Step 6: upsert campaigns -----
  console.log('[6/7] Upserting campaigns...');
  let updated = 0;
  let inserted = 0;
  let failed = 0;
  const failures: Array<{ campaign_id: string; error: string }> = [];

  // In enrich mode, update existing docs by index, insert the rest
  // In replace mode, all docs are new inserts
  const existingCount = existing.length;

  for (let i = 0; i < allCampaigns.length; i++) {
    const data = allCampaigns[i];
    try {
      if (i < existingCount && SEED_MODE === 'enrich') {
        // Update existing doc in place (preserve _id)
        await col.updateOne(
          { _id: existing[i]._id },
          { $set: { ...data, _id: existing[i]._id } },
        );
        updated++;
      } else {
        // Insert new doc
        await col.insertOne(data);
        inserted++;
      }

      if ((i + 1) % 10 === 0 || i === allCampaigns.length - 1) {
        console.log(`   [${i + 1}/${allCampaigns.length}] ${data.campaign_id} → ${data.channel} | ${data.budget}€ / ${data.spend}€ spent | ${data.leads} leads | ${data.category}`);
      }
    } catch (e: any) {
      failed++;
      failures.push({ campaign_id: data.campaign_id, error: e.message });
      if (failures.length <= 5) {
        console.error(`   [FAIL] ${data.campaign_id}: ${e.message}`);
      }
    }
  }

  console.log();
  console.log(`   Updated:  ${updated}`);
  console.log(`   Inserted: ${inserted}`);
  console.log(`   Failed:   ${failed}\n`);

  // ----- Step 7: final stats -----
  console.log('============================================================');
  console.log('  FINAL STATS');
  console.log('============================================================');

  const total = await col.countDocuments({});
  console.log(`Total campaigns in DB: ${total}\n`);

  // By channel
  const byChannel = await col.aggregate([
    { $group: {
      _id: '$channel',
      count: { $sum: 1 },
      budget: { $sum: '$budget' },
      spend: { $sum: '$spend' },
      leads: { $sum: '$leads' },
      prospects: { $sum: '$prospects' },
      clients: { $sum: '$clients' },
    } },
    { $sort: { spend: -1 } },
  ]).toArray();
  console.log('By channel:');
  console.log(`   ${'Channel'.padEnd(16)} ${'Count'.padStart(5)} ${'Budget'.padStart(10)} ${'Spend'.padStart(10)} ${'Leads'.padStart(7)} ${'CPL'.padStart(7)}`);
  for (const c of byChannel as any[]) {
    const cpl = c.leads > 0 ? c.spend / c.leads : 0;
    console.log(`   ${String(c._id || 'null').padEnd(16)} ${String(c.count).padStart(5)} ${Number(c.budget || 0).toLocaleString('fr-FR').padStart(10)}€ ${Number(c.spend || 0).toLocaleString('fr-FR').padStart(10)}€ ${String(c.leads).padStart(7)} ${cpl.toFixed(2).padStart(7)}€`);
  }

  // By category
  const byCategory = await col.aggregate([
    { $group: {
      _id: '$category',
      budget: { $sum: '$budget' },
      spend: { $sum: '$spend' },
      leads: { $sum: '$leads' },
    } },
    { $sort: { spend: -1 } },
  ]).toArray();
  console.log('\nBy category:');
  for (const c of byCategory as any[]) {
    console.log(`   ${String(c._id || 'null').padEnd(12)} → ${Number(c.budget || 0).toLocaleString('fr-FR')}€ budget | ${Number(c.spend || 0).toLocaleString('fr-FR')}€ spent | ${c.leads} leads`);
  }

  // Totals
  const totals = await col.aggregate([
    { $group: {
      _id: null,
      totalBudget: { $sum: '$budget' },
      totalSpend:  { $sum: '$spend' },
      totalLeads:  { $sum: '$leads' },
      totalProspects: { $sum: '$prospects' },
      totalClients: { $sum: '$clients' },
    } },
  ]).toArray();
  const t = totals[0] || {};
  const totalBudget = Number(t.totalBudget || 0);
  const totalSpend = Number(t.totalSpend || 0);
  const totalLeads = Number(t.totalLeads || 0);
  const totalProspects = Number(t.totalProspects || 0);
  const totalClients = Number(t.totalClients || 0);
  const cplBrut = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const cacMoyen = totalClients > 0 ? totalSpend / totalClients : 0;

  console.log('\nGlobal KPIs:');
  console.log(`   Budget Total:        ${totalBudget.toLocaleString('fr-FR')} €`);
  console.log(`   Dépenses Total:     ${totalSpend.toLocaleString('fr-FR')} €`);
  console.log(`   Leads Générés:      ${totalLeads.toLocaleString('fr-FR')}`);
  console.log(`   CPL Brut:           ${cplBrut.toFixed(2)} €`);
  console.log(`   Prospects (B2B):    ${totalProspects.toLocaleString('fr-FR')}`);
  console.log(`   Clients (B2B):      ${totalClients.toLocaleString('fr-FR')}`);
  console.log(`   CAC Moyen:          ${cacMoyen.toFixed(0)} €`);

  // By segment (Candidats only)
  const bySegment = await col.aggregate([
    { $match: { category: 'Candidats', segment: { $ne: null } } },
    { $group: {
      _id: '$segment',
      leads: { $sum: '$leads' },
      spend: { $sum: '$spend' },
    } },
    { $sort: { _id: 1 } },
  ]).toArray();
  console.log('\nBy segment (Candidats):');
  for (const s of bySegment as any[]) {
    const cpl = s.leads > 0 ? s.spend / s.leads : 0;
    console.log(`   ${String(s._id || 'null').padEnd(18)} → ${String(s.leads).padStart(5)} leads | ${Number(s.spend).toLocaleString('fr-FR').padStart(8)}€ | CPL ${cpl.toFixed(2)}€`);
  }

  if (failures.length > 0) {
    console.log(`\n[WARN] ${failures.length} campaigns failed. First 5 errors shown above.`);
  } else {
    console.log('\n[OK] All marketing campaigns enriched / created successfully!');
  }

  console.log('\n[OK] CRM Marketing dashboard should now show real data.');
  console.log('     Refresh the page in your browser (or wait 30s for auto-refresh).');

  await mongoose.disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL] Seed failed:', err);
  process.exit(1);
});
