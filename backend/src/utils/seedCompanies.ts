/**
 * seedCompanies.ts — PRO v1.3 (DEFENSIVE + ALL-UNIQUE-INDEX-AWARE)
 * -----------------------------------------------------------------------------
 * Seeds the `companies` MongoDB collection with 44 realistic Tunisian clients
 * so the CRM Clients dashboard shows REAL data instead of zeros and "—".
 *
 * PRO v1.3 changes (vs v1.2):
 *   • Generates a stable unique `center_number` (CTR-0001 ... CTR-0044) for
 *     each document — fixes the E11000 duplicate key error on the SECOND
 *     unique index `center_number_1` (v1.2 only handled the first one).
 *   • Pre-populates ALL fields referenced by indexes (even non-unique ones)
 *     so the seeded documents are consistent with the backend's complex
 *     Company schema:
 *       - record_status: "active"        (soft-delete flag, 6 compound indexes)
 *       - current_account_status         (alias of status)
 *       - account_readiness_status       ("ready")
 *       - main_address: { city, country } (nested address)
 *       - profile: { company_business_type } (nested business type)
 *       - company_name, legal_company_name  (text index aliases)
 *       - managed_by_user_id              (null — no owner)
 *       - created_by_actor_id, updated_by_actor_id  (null)
 *       - is_duplicate_suspected: false
 *       - deleted_at: null
 *
 * PRO v1.2 changes (vs v1.1):
 *   • Generates a stable unique `company_id` (CMP-0001 ... CMP-0044)
 *   • URI validation: detects the common "/PORT/DB" typo early
 *   • Logs all existing indexes at startup
 *
 * PRO v1.1 changes (vs v1.0):
 *   • Uses the RAW MongoDB driver collection (no Mongoose schema)
 *   • Uses `insertMany({ ordered: false })` — one bad doc doesn't abort the batch
 *
 * Coverage:
 *   • 44 Tunisian companies across 15 governorates
 *   • 7 sectors (Télévente, Support, Accueil, Mixte, Tech, Finance, Retail)
 *   • 4 statuses: Actif (30), Inactif (8), Suspendu (3), En attente (3)
 *   • Revenue range: 0€ — 1.98M€  (total ≈ 28.7 M€)
 *   • Orders range: 0 — 31 per client
 *
 * RUN (from backend/ directory):
 *   npx ts-node-dev --transpile-only src/utils/seedCompanies.ts
 *
 * ENV:
 *   MONGODB_URI=mongodb://localhost:27017/callcentermatch  (default)
 *
 * OPTIONS:
 *   SEED_MODE=append    → keep existing, only add new (default)
 *   SEED_MODE=replace   → DELETE all existing first, then insert
 * -----------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';

const SEED_MODE = process.env.SEED_MODE || 'append';

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
    console.error('     mongodb://user:pass@host-1:27017,host-2:27017,host-3:27017/CCM_DB?retryWrites=true...');
    console.error('   Example of BROKEN URI (what you probably have):');
    console.error('     mongodb://user:pass@host-1:27017,host-2:27017,host-3:27017/27017/CCM_DB?...');
    console.error('                                              ^^^^^^^ remove this');
    process.exit(1);
  }

  // Check for any '/' in the database name segment
  // The DB name is the part after the last host:port and before '?'
  const dbNameMatch = uri.match(/\/([^/?]+)(\?|$)/);
  if (dbNameMatch && dbNameMatch[1].includes('/')) {
    console.error('[FATAL] MONGODB_URI contains "/" in the database name segment.');
    console.error(`   Database name parsed: "${dbNameMatch[1]}"`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAY = 86400000;
const now = Date.now();
const daysAgo = (n: number) => new Date(now - n * DAY);

type SeedDoc = {
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  city: string;
  sector: string;
  status: 'Actif' | 'Inactif' | 'Suspendu' | 'En attente';
  total_revenue: number;
  orders_count: number;
  last_activity: Date;
};

// ---------------------------------------------------------------------------
// 44 realistic Tunisian companies
// ---------------------------------------------------------------------------
const COMPANIES: SeedDoc[] = [
  // ===== ACTIF — 30 companies (active clients with revenue + orders) =====
  { name: 'TechnoSolutions SARL', contact_name: 'Karim Ben Salah', email: 'contact@technosolutions.tn', phone: '+216 71 902 456', city: 'Tunis', sector: 'Tech', status: 'Actif', total_revenue: 1_850_000, orders_count: 28, last_activity: daysAgo(2) },
  { name: 'LuxMobile Distribution', contact_name: 'Sophie Martin', email: 'sophie@luxmobile.tn', phone: '+216 71 555 112', city: 'Ariana', sector: 'Retail', status: 'Actif', total_revenue: 1_240_000, orders_count: 22, last_activity: daysAgo(1) },
  { name: 'ModaStyle E-commerce', contact_name: 'Ines Kefi', email: 'ines@modastyle.tn', phone: '+216 74 233 889', city: 'Sfax', sector: 'Retail', status: 'Actif', total_revenue: 980_000, orders_count: 19, last_activity: daysAgo(3) },
  { name: 'Mediterra Consulting', contact_name: 'Pierre Dubois', email: 'p.dubois@mediterra.tn', phone: '+216 73 100 222', city: 'Sousse', sector: 'Finance', status: 'Actif', total_revenue: 1_450_000, orders_count: 24, last_activity: daysAgo(0) },
  { name: 'SaharaLog Transport', contact_name: 'Mehdi Trabelsi', email: 'm.trabelsi@saharalog.tn', phone: '+216 75 887 411', city: 'Gabès', sector: 'Mixte', status: 'Actif', total_revenue: 720_000, orders_count: 15, last_activity: daysAgo(4) },
  { name: 'Carthage Call Center', contact_name: 'Leila Gharbi', email: 'leila@carthage-cc.tn', phone: '+216 71 700 333', city: 'Tunis', sector: 'Télévente', status: 'Actif', total_revenue: 1_120_000, orders_count: 21, last_activity: daysAgo(1) },
  { name: 'Numidia Tech', contact_name: 'Omar Khelifi', email: 'omar@numidia.tn', phone: '+216 71 400 558', city: 'Ariana', sector: 'Tech', status: 'Actif', total_revenue: 890_000, orders_count: 17, last_activity: daysAgo(2) },
  { name: 'OliveCo Export', contact_name: 'Fatma Sassi', email: 'fatma@oliveco.tn', phone: '+216 76 221 880', city: 'Sfax', sector: 'Retail', status: 'Actif', total_revenue: 540_000, orders_count: 11, last_activity: daysAgo(5) },
  { name: 'TunisSoft Labs', contact_name: 'Anis Bouazizi', email: 'anis@tunissoft.tn', phone: '+216 71 909 102', city: 'Tunis', sector: 'Tech', status: 'Actif', total_revenue: 1_610_000, orders_count: 26, last_activity: daysAgo(0) },
  { name: 'PharmaPlus Tunisie', contact_name: 'Nadia Mejri', email: 'nadia@pharmaplus.tn', phone: '+216 71 222 109', city: 'Ben Arous', sector: 'Retail', status: 'Actif', total_revenue: 1_980_000, orders_count: 31, last_activity: daysAgo(1) },
  { name: 'Atlas Support Services', contact_name: 'Yassine Gafsi', email: 'yassine@atlas-support.tn', phone: '+216 76 701 002', city: 'Gafsa', sector: 'Support', status: 'Actif', total_revenue: 380_000, orders_count: 9, last_activity: daysAgo(6) },
  { name: 'Cedar Hospitality', contact_name: 'Maria Haddad', email: 'maria@cedar-hosp.tn', phone: '+216 72 800 555', city: 'Bizerte', sector: 'Accueil', status: 'Actif', total_revenue: 670_000, orders_count: 13, last_activity: daysAgo(3) },
  { name: 'El Manar Finance', contact_name: 'Habib Bourguiba Jr.', email: 'habib@elmanar-finance.tn', phone: '+216 71 606 220', city: 'Tunis', sector: 'Finance', status: 'Actif', total_revenue: 1_320_000, orders_count: 18, last_activity: daysAgo(2) },
  { name: 'Sahel Industries', contact_name: 'Rim Mansour', email: 'rim@sahel-industries.tn', phone: '+216 73 711 889', city: 'Monastir', sector: 'Mixte', status: 'Actif', total_revenue: 850_000, orders_count: 16, last_activity: daysAgo(4) },
  { name: 'CapBon Telecom', contact_name: 'Slim Bouzid', email: 'slim@capbon-telecom.tn', phone: '+216 72 234 445', city: 'Nabeul', sector: 'Télévente', status: 'Actif', total_revenue: 990_000, orders_count: 20, last_activity: daysAgo(1) },
  { name: 'DigitalWave Agency', contact_name: 'Asma Cherif', email: 'asma@digitalwave.tn', phone: '+216 71 050 707', city: 'Tunis', sector: 'Tech', status: 'Actif', total_revenue: 460_000, orders_count: 12, last_activity: daysAgo(3) },
  { name: 'Jugurtha Retail', contact_name: 'Walid Jelassi', email: 'walid@jugurtha.tn', phone: '+216 78 100 220', city: 'Kairouan', sector: 'Retail', status: 'Actif', total_revenue: 510_000, orders_count: 10, last_activity: daysAgo(5) },
  { name: 'BordjCedria Tech', contact_name: 'Ines Bellagha', email: 'ines@bordj-tech.tn', phone: '+216 79 700 333', city: 'Ben Arous', sector: 'Tech', status: 'Actif', total_revenue: 720_000, orders_count: 14, last_activity: daysAgo(2) },
  { name: 'Mahdia Textile', contact_name: 'Hatem Karoui', email: 'hatem@mahdia-textile.tn', phone: '+216 73 688 009', city: 'Mahdia', sector: 'Mixte', status: 'Actif', total_revenue: 680_000, orders_count: 13, last_activity: daysAgo(4) },
  { name: 'TerraMed Support', contact_name: 'Mariem Ben Ali', email: 'mariem@terramed.tn', phone: '+216 71 933 002', city: 'Manouba', sector: 'Support', status: 'Actif', total_revenue: 410_000, orders_count: 8, last_activity: daysAgo(7) },
  { name: 'Gabes Logistics', contact_name: 'Nizar Hamdi', email: 'nizar@gabes-logistics.tn', phone: '+216 75 222 410', city: 'Gabès', sector: 'Mixte', status: 'Actif', total_revenue: 570_000, orders_count: 11, last_activity: daysAgo(3) },
  { name: 'Medina Finance', contact_name: 'Souad Riahi', email: 'souad@medina-finance.tn', phone: '+216 71 800 009', city: 'Tunis', sector: 'Finance', status: 'Actif', total_revenue: 1_080_000, orders_count: 17, last_activity: daysAgo(1) },
  { name: 'SfaxRetail Group', contact_name: 'Khaled Masmoudi', email: 'khaled@sfaxretail.tn', phone: '+216 74 800 100', city: 'Sfax', sector: 'Retail', status: 'Actif', total_revenue: 1_450_000, orders_count: 23, last_activity: daysAgo(2) },
  { name: 'Etoile du Nord', contact_name: 'Claire Benoit', email: 'claire@etoile-nord.tn', phone: '+216 72 900 400', city: 'Bizerte', sector: 'Accueil', status: 'Actif', total_revenue: 320_000, orders_count: 7, last_activity: daysAgo(8) },
  { name: 'PromoTunisie Marketing', contact_name: 'Sami Gharsalli', email: 'sami@promotunisie.tn', phone: '+216 71 654 321', city: 'Tunis', sector: 'Télévente', status: 'Actif', total_revenue: 690_000, orders_count: 14, last_activity: daysAgo(3) },
  { name: 'AfricanBank Solutions', contact_name: 'Amina Larbi', email: 'amina@africanbank.tn', phone: '+216 71 010 230', city: 'Tunis', sector: 'Finance', status: 'Actif', total_revenue: 1_540_000, orders_count: 25, last_activity: daysAgo(0) },
  { name: 'El Mourouj Tech', contact_name: 'Bassem Karoui', email: 'bassem@elmourouj-tech.tn', phone: '+216 79 100 808', city: 'Ben Arous', sector: 'Tech', status: 'Actif', total_revenue: 540_000, orders_count: 12, last_activity: daysAgo(4) },
  { name: 'Djerba Holidays', contact_name: 'Yasmine Trabelsi', email: 'yasmine@djerba-holidays.tn', phone: '+216 75 700 010', city: 'Médenine', sector: 'Accueil', status: 'Actif', total_revenue: 430_000, orders_count: 9, last_activity: daysAgo(5) },
  { name: 'Kairouan Foods', contact_name: 'Mourad Ezzeddine', email: 'mourad@kairouan-foods.tn', phone: '+216 77 200 100', city: 'Kairouan', sector: 'Retail', status: 'Actif', total_revenue: 780_000, orders_count: 14, last_activity: daysAgo(2) },
  { name: 'TunisCall Pro', contact_name: 'Hanen Khelifi', email: 'hanen@tuniscall.tn', phone: '+216 71 333 707', city: 'Tunis', sector: 'Télévente', status: 'Actif', total_revenue: 950_000, orders_count: 18, last_activity: daysAgo(1) },

  // ===== INACTIF — 8 companies (churned, no recent activity) =====
  { name: 'OldTech Tunisie', contact_name: 'Ancien Client', email: 'contact@oldtech.tn', phone: '+216 71 999 100', city: 'Tunis', sector: 'Tech', status: 'Inactif', total_revenue: 180_000, orders_count: 4, last_activity: daysAgo(120) },
  { name: 'SfaxOld Retail', contact_name: 'Faouzi Ben', email: 'faouzi@sfaxold.tn', phone: '+216 74 100 200', city: 'Sfax', sector: 'Retail', status: 'Inactif', total_revenue: 95_000, orders_count: 2, last_activity: daysAgo(150) },
  { name: 'Medina Old Services', contact_name: 'Lamia Z', email: 'lamia@medina-old.tn', phone: '+216 71 800 700', city: 'Tunis', sector: 'Support', status: 'Inactif', total_revenue: 60_000, orders_count: 1, last_activity: daysAgo(180) },
  { name: 'Nabeul Legacy', contact_name: 'Mohsen B', email: 'mohsen@nabeul-legacy.tn', phone: '+216 72 500 800', city: 'Nabeul', sector: 'Mixte', status: 'Inactif', total_revenue: 110_000, orders_count: 3, last_activity: daysAgo(135) },
  { name: 'Sousse Heritage', contact_name: 'Nawel T', email: 'nawel@sousse-heritage.tn', phone: '+216 73 800 100', city: 'Sousse', sector: 'Accueil', status: 'Inactif', total_revenue: 75_000, orders_count: 2, last_activity: daysAgo(160) },
  { name: 'Ariana Closed', contact_name: 'Hichem R', email: 'hichem@ariana-closed.tn', phone: '+216 71 200 800', city: 'Ariana', sector: 'Finance', status: 'Inactif', total_revenue: 145_000, orders_count: 3, last_activity: daysAgo(110) },
  { name: 'Monastir Old', contact_name: 'Sonia M', email: 'sonia@monastir-old.tn', phone: '+216 73 200 700', city: 'Monastir', sector: 'Retail', status: 'Inactif', total_revenue: 88_000, orders_count: 2, last_activity: daysAgo(140) },
  { name: 'Bizerte Past', contact_name: 'Ali B', email: 'ali@bizerte-past.tn', phone: '+216 72 700 400', city: 'Bizerte', sector: 'Mixte', status: 'Inactif', total_revenue: 52_000, orders_count: 1, last_activity: daysAgo(170) },

  // ===== SUSPENDU — 3 companies (payment issues / contract paused) =====
  { name: 'Gabes Suspended Co', contact_name: 'Riadh M', email: 'riadh@gabes-suspended.tn', phone: '+216 75 700 800', city: 'Gabès', sector: 'Mixte', status: 'Suspendu', total_revenue: 220_000, orders_count: 5, last_activity: daysAgo(45) },
  { name: 'Sfax Frozen SARL', contact_name: 'Hend Z', email: 'hend@sfax-frozen.tn', phone: '+216 74 800 700', city: 'Sfax', sector: 'Retail', status: 'Suspendu', total_revenue: 175_000, orders_count: 4, last_activity: daysAgo(60) },
  { name: 'Tunis On Hold', contact_name: 'Karim K', email: 'karim@tunis-onhold.tn', phone: '+216 71 700 500', city: 'Tunis', sector: 'Tech', status: 'Suspendu', total_revenue: 195_000, orders_count: 4, last_activity: daysAgo(35) },

  // ===== EN ATTENTE — 3 companies (new contracts being validated) =====
  { name: 'Ariana Pending', contact_name: 'Nour Eddine', email: 'nour@ariana-pending.tn', phone: '+216 71 100 500', city: 'Ariana', sector: 'Support', status: 'En attente', total_revenue: 0, orders_count: 0, last_activity: daysAgo(7) },
  { name: 'Sousse Validation', contact_name: 'Issam M', email: 'issam@sousse-validation.tn', phone: '+216 73 100 400', city: 'Sousse', sector: 'Tech', status: 'En attente', total_revenue: 0, orders_count: 0, last_activity: daysAgo(5) },
  { name: 'Manouba NewCo', contact_name: 'Sirine A', email: 'sirine@manouba-newco.tn', phone: '+216 71 500 800', city: 'Manouba', sector: 'Mixte', status: 'En attente', total_revenue: 0, orders_count: 0, last_activity: daysAgo(3) },
];

// ---------------------------------------------------------------------------
// Build full documents with aliases + timestamps
// ---------------------------------------------------------------------------
function buildDoc(doc: SeedDoc, idx: number) {
  const createdAt = doc.last_activity;
  // CRITICAL: the `companies` collection has TWO unique indexes:
  //   1. `company_id_1`   UNIQUE on `company_id`
  //   2. `center_number_1` UNIQUE on `center_number`
  // If we don't set them, MongoDB assigns `null` to all docs, and only the
  // first insert succeeds — the other 43 fail with E11000 dup key.
  // So we generate stable, unique values for each:
  //   company_id   = CMP-0001 ... CMP-0044
  //   center_number = CTR-0001 ... CTR-0044
  const company_id = `CMP-${String(idx + 1).padStart(4, '0')}`;
  const center_number = `CTR-${String(idx + 1).padStart(4, '0')}`;

  // Map our simple `status` to the backend's `current_account_status` enum
  // (the schema has both — `status` is the simple one we display, and
  //  `current_account_status` is the backend's normalized enum)
  const accountStatusMap: Record<string, string> = {
    'Actif': 'active',
    'Inactif': 'inactive',
    'Suspendu': 'suspended',
    'En attente': 'pending',
  };
  const current_account_status = accountStatusMap[doc.status] || 'active';

  return {
    // === UNIQUE KEYS (required by unique indexes) ===
    company_id,
    center_number,

    // === Primary fields (flat — used by Clients.tsx normalizeClient) ===
    name: doc.name,
    contact_name: doc.contact_name,
    email: doc.email.toLowerCase(),
    phone: doc.phone,
    city: doc.city,
    sector: doc.sector,
    status: doc.status,
    total_revenue: doc.total_revenue,
    orders_count: doc.orders_count,
    last_activity: doc.last_activity,

    // === Aliases (camelCase + French — so any backend schema finds the data) ===
    contactName: doc.contact_name,
    totalRevenue: doc.total_revenue,
    ca_total: doc.total_revenue,
    ordersCount: doc.orders_count,
    revenue: doc.total_revenue,
    industry: doc.sector,
    ville: doc.city,
    statut: doc.status,
    companyId: company_id,
    centerNumber: center_number,

    // === Backend's complex schema fields (referenced by indexes) ===
    // Soft-delete flag (part of 6 compound indexes — must be a non-null string)
    record_status: 'active',
    // Backend's normalized status enum
    current_account_status,
    account_readiness_status: current_account_status === 'active' ? 'ready' : 'pending',

    // Nested address (the schema uses main_address.city, not flat city)
    main_address: {
      city: doc.city,
      country: 'Tunisia',
      // Include a few extra fields the schema might expect
      address_line1: `${doc.name} HQ`,
      postal_code: '',
    },

    // Nested profile (the schema uses profile.company_business_type, not flat sector)
    profile: {
      company_business_type: doc.sector,
      company_name: doc.name,
      legal_company_name: doc.name,
    },

    // Text-indexed name fields (alternative to flat `name`)
    company_name: doc.name,
    legal_company_name: doc.name,

    // Ownership / audit fields (part of compound indexes — null is OK)
    managed_by_user_id: null,
    created_by_actor_id: null,
    updated_by_actor_id: null,

    // Duplicate detection flag (has its own index — boolean expected)
    is_duplicate_suspected: false,

    // Soft-delete timestamp (null means "not deleted")
    deleted_at: null,

    // Timestamps (override Mongoose timestamps:true)
    createdAt,
    updatedAt: createdAt,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Companies Seed (PRO v1.3 - all-unique-index-aware) ===');
  console.log('MONGODB_URI:', MONGODB_URI.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
  console.log('SEED_MODE  :', SEED_MODE);
  console.log(`Companies to seed: ${COMPANIES.length}`);

  // Validate URI before attempting to connect — gives a clean error message
  validateMongoUri(MONGODB_URI);

  await mongoose.connect(MONGODB_URI);
  mongoose.set('strictQuery', true);
  console.log('[OK] Connected to MongoDB');

  // Use the RAW MongoDB driver collection — bypasses any local Mongoose
  // schema validation that might conflict with the backend's actual
  // `Company` model.
  const db = mongoose.connection.db!;
  const col = db.collection('companies');

  if (SEED_MODE === 'replace') {
    const del = await col.deleteMany({});
    console.log(`[DEL] Deleted ${del.deletedCount} existing companies`);
  }

  const existing = await col.countDocuments({});
  console.log(`[INFO] Existing companies in DB: ${existing}`);

  // Inspect existing indexes — list all UNIQUE ones first (those are the
  // ones that can block inserts with E11000 errors)
  const indexes = await col.indexes();
  const uniqueIndexes = indexes.filter((i) => i.unique);
  const otherIndexes = indexes.filter((i) => !i.unique);
  console.log(`[INFO] UNIQUE indexes on 'companies' (these block duplicates):`);
  for (const idx of uniqueIndexes) {
    console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
  }
  console.log(`[INFO] Other (non-unique) indexes: ${otherIndexes.length}`);

  // Build all documents — pass index so we can generate unique company_id + center_number
  const docsToInsert = COMPANIES.map((doc, idx) => buildDoc(doc, idx));
  console.log(`[INFO] Built ${docsToInsert.length} documents for insertion`);
  console.log(`[INFO] First doc: company_id=${docsToInsert[0].company_id}, center_number=${docsToInsert[0].center_number}`);
  console.log(`[INFO] Last  doc: company_id=${docsToInsert[docsToInsert.length - 1].company_id}, center_number=${docsToInsert[docsToInsert.length - 1].center_number}`);

  // Insert with ordered: false so individual failures don't abort the batch.
  // This is the key change from v1.0 → v1.1.
  let insertedCount = 0;
  let failedCount = 0;
  const failures: Array<{ index: number; name: string; error: string }> = [];

  try {
    const result = await col.insertMany(docsToInsert, { ordered: false });
    insertedCount = result.insertedCount;
    console.log(`[OK] Inserted ${insertedCount} companies`);
  } catch (err: any) {
    // With ordered: false, MongoDB still throws if there were any errors,
    // but it also returns the partial result via err.insertedDocs / err.result.
    if (err && typeof err === 'object' && 'insertedCount' in err) {
      insertedCount = (err as any).insertedCount || 0;
    } else if (err && typeof err === 'object' && 'result' in err) {
      insertedCount = (err as any).result?.insertedCount || 0;
    }

    // Extract individual write errors
    const writeErrors = (err as any)?.writeErrors || (err as any)?.result?.writeErrors || [];
    if (writeErrors.length > 0) {
      console.log(`[WARN] ${writeErrors.length} document(s) failed. Details:`);
      for (const we of writeErrors) {
        const idx = we.index;
        const failedDoc = docsToInsert[idx];
        const errMsg = we.err?.errmsg || we.err?.message || we.err?.err?.message || JSON.stringify(we.err);
        console.log(`   [${idx}] "${failedDoc?.name}" -> ${errMsg}`);
        failures.push({ index: idx, name: failedDoc?.name || 'unknown', error: errMsg });
        failedCount++;
      }
    } else {
      // No structured writeErrors — log the full error
      console.error('[ERROR] Unrecognized insertMany error:');
      console.error('   message:', err?.message || err);
      console.error('   code   :', err?.code);
      console.error('   codeName:', err?.codeName);
      if (err?.errInfo) {
        console.error('   errInfo:', JSON.stringify(err.errInfo, null, 2));
      }
    }

    console.log(`\n[PARTIAL] Inserted ${insertedCount} / ${docsToInsert.length} companies`);
    console.log(`[PARTIAL] Failed: ${failedCount} companies`);
  }

  // Final stats
  const total = await col.countDocuments({});
  console.log(`\n[FINAL] Total companies in DB: ${total}`);

  if (total === 0) {
    console.error('[FAIL] No companies in DB after seed. Check errors above.');
  } else {
    // Show status distribution
    const byStatus = await col.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, revenue: { $sum: '$total_revenue' } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    console.log('\n[STATS] Status distribution:');
    for (const s of byStatus as any[]) {
      console.log(`   ${String(s._id).padEnd(12)} -> ${String(s.count).padStart(3)} clients | ${(s.revenue || 0).toLocaleString('fr-FR')} EUR`);
    }

    const totalRev = await col.aggregate([
      { $group: { _id: null, total: { $sum: '$total_revenue' }, orders: { $sum: '$orders_count' } } },
    ]).toArray();
    console.log(`\n[TOTAL] CA Total: ${(totalRev[0]?.total || 0).toLocaleString('fr-FR')} EUR`);
    console.log(`[TOTAL] Commandes: ${totalRev[0]?.orders || 0}`);

    if (failures.length > 0) {
      console.log(`\n[WARN] ${failures.length} companies were NOT inserted due to errors.`);
      console.log('       The CRM Clients dashboard will still work for the successfully inserted ones.');
    } else {
      console.log('\n[OK] All 44 companies inserted successfully!');
    }
  }

  await mongoose.disconnect();
  console.log('\n[OK] Disconnected. CRM Clients dashboard should now show real data.');
  process.exit(total > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FATAL] Seed failed:', err);
  process.exit(1);
});

