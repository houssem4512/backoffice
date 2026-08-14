/**
 * candidatesStats.ts — PRO v1.0
 * -----------------------------------------------------------------------------
 * Complete backend for the Candidates module:
 *   GET /api/bo/candidates           — paginated list with advanced filters + diagnostics
 *   GET /api/bo/candidates/stats     — dashboard KPIs (12 metrics)
 *   GET /api/bo/candidates/filters   — dropdown options (cities, languages, statuses, ...)
 *   GET /api/bo/candidates/inspect    — schema discovery (debug)
 *
 * Pro features:
 *   • Smart filter → MongoDB query builder with type-aware comparisons
 *   • Age filter does NOT exclude leads with null date_of_birth by default
 *     (use strictAge=true to enforce strict age filtering)
 *   • Returns diagnostics showing how many leads were excluded by each filter
 *   • Tunisian governorate lookup (IDs 1-25 → names)
 *   • Single-pass aggregation for /filters endpoint (1 DB round-trip)
 *   • /inspect recurses one level into nested objects (location.city_id, etc.)
 *
 * Mount at: /api/bo/candidates  (in index.ts)
 * -----------------------------------------------------------------------------
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';

const router = Router();

// ---------------------------------------------------------------------------
// Tunisian governorate lookup (numeric city_id ↔ name)
// ---------------------------------------------------------------------------
const TUNISIAN_CITIES: Record<number, string> = {
  1: 'Tunis', 2: 'Ariana', 3: 'Ben Arous', 4: 'Manouba',
  5: 'Nabeul', 6: 'Zaghouan', 7: 'Bizerte', 8: 'Béja',
  9: 'Jendouba', 10: 'Le Kef', 11: 'Sousse', 12: 'Monastir',
  13: 'Mahdia', 14: 'Sfax', 15: 'Kairouan', 16: 'Kasserine',
  17: 'Sidi Bouzid', 18: 'Gabès', 19: 'Médenine', 20: 'Tataouine',
  21: 'Gafsa', 22: 'Tozeur', 23: 'Kebili', 24: 'Siliana', 25: 'Kairouan',
};

const CITY_NAME_TO_ID: Record<string, number> = Object.entries(TUNISIAN_CITIES)
  .reduce((acc, [id, name]) => { acc[name.toLowerCase()] = Number(id); return acc; }, {} as Record<string, number>);

const LANGUE_CODES: Record<string, string> = {
  'Français': 'fr', 'Anglais': 'en', 'Allemand': 'de',
  'Espagnol': 'es', 'Italien': 'it', 'Arabe': 'ar', 'Turc': 'tr',
};

const SOURCE_QUERIES: Record<string, any> = {
  'Formulaire site': { channel: 1 },
  'Import Facebook': { channel: 2 },
};

const STATUS_QUERIES: Record<string, any> = {
  'Disponible':   { account_status: 1, lead_stage: { $lte: 2 } },
  'En process':   { lead_stage: { $gte: 3, $lte: 5 } },
  'Livré':        { lead_stage: 6 },
  'Indisponible': { account_status: 4 },
  'Désinscrit':   { 'verification.terms_accepted': false },
};

const EXP_RANGES: Record<string, [number, number]> = {
  '0-1 an':   [0, 1],
  '1-3 ans':  [1, 3],
  '3-5 ans':  [3, 5],
  '5+ ans':   [5, 99],
};

const LANGUE_NAMES: Record<string, string> = {
  fr: 'Français', en: 'Anglais', de: 'Allemand',
  es: 'Espagnol', it: 'Italien', ar: 'Arabe', tr: 'Turc',
};

const STATUS_NAMES: Record<number, string> = {
  1: 'Disponible', 2: 'En attente', 3: 'En process', 4: 'Indisponible',
};

const SOURCE_NAMES: Record<number, string> = {
  1: 'Formulaire site', 2: 'Import Facebook',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface StatResult {
  count: number;
  matchedPattern: string;
  triedPatterns: string[];
}

async function adaptiveCount(
  collection: any,
  patterns: Array<{ query: any; label: string }>,
  statName: string
): Promise<StatResult> {
  const tried: string[] = [];
  for (const p of patterns) {
    try {
      const count = await collection.countDocuments(p.query);
      tried.push(`${p.label} → ${count}`);
      if (count > 0) {
        console.log(`[stats] ✓ ${statName}: "${p.label}" → ${count}`);
        return { count, matchedPattern: p.label, triedPatterns: tried };
      }
    } catch (e: any) {
      tried.push(`${p.label} → ERROR: ${e.message}`);
    }
  }
  console.log(`[stats] ✗ ${statName}: no pattern matched (0)`);
  return { count: 0, matchedPattern: 'none', triedPatterns: tried };
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function pct(n: number, total: number): number {
  if (!total || total === 0) return 0;
  return Math.round((n / total) * 1000) / 10;
}

async function getCollection(): Promise<{ collection: any; name: string } | null> {
  const db: any = mongoose.connection.db;
  if (!db) return null;
  const all = await db.listCollections().toArray();
  const names = all.map((c: any) => c.name);
  // IMPORTANT: try `leads` FIRST — that's where the real candidate data lives.
  // `candidates` (plural) may exist as an empty Mongoose auto-created collection.
  const candidates = ['leads', 'candidats', 'candidates', 'contacts', 'persons', 'people', 'profiles', 'profils', 'users'];
  for (const n of candidates) {
    if (names.includes(n)) {
      // Sanity check: skip empty collections unless it's our only option
      const cnt = await db.collection(n).countDocuments({}, { limit: 1 });
      if (cnt > 0) return { collection: db.collection(n), name: n };
    }
  }
  // Fallback: pick the largest non-empty collection
  let max = 0; let best: any = null; let bestName = '';
  for (const c of all) {
    const cnt = await db.collection(c.name).countDocuments({}, { limit: 1 });
    if (cnt > max) { max = cnt; best = db.collection(c.name); bestName = c.name; }
  }
  return best ? { collection: best, name: bestName } : null;
}

// ---------------------------------------------------------------------------
// Build MongoDB query from frontend filter object
// ---------------------------------------------------------------------------
interface BuildResult {
  query: any;
  diagnostics: {
    dateStart?: string;
    dateEnd?: string;
    ageMin?: number;
    ageMax?: number;
    city?: string;
    excludedByDate: boolean;
    excludedByAge: boolean;
    excludedByNullDob: boolean;
    filtersApplied: string[];
    totalFilters: number;
  };
}

function buildMongoQuery(filters: Record<string, any>, strictAge = false): BuildResult {
  const q: any = {};
  const f = filters;
  const filtersApplied: string[] = [];
  const diag: any = {
    excludedByDate: false,
    excludedByAge: false,
    excludedByNullDob: false,
    filtersApplied,
    totalFilters: 0,
  };

  // Date range — based on created_at
  if (f.dateStart || f.dateEnd) {
    q.created_at = {};
    if (f.dateStart) {
      const start = new Date(String(f.dateStart));
      if (!isNaN(start.getTime())) {
        q.created_at.$gte = start;
        diag.dateStart = f.dateStart;
        filtersApplied.push(`Date ≥ ${f.dateStart}`);
      }
    }
    if (f.dateEnd) {
      const end = new Date(String(f.dateEnd));
      if (!isNaN(end.getTime())) {
        end.setDate(end.getDate() + 1); // inclusive end
        q.created_at.$lt = end;
        diag.dateEnd = f.dateEnd;
        filtersApplied.push(`Date < ${f.dateEnd} (inclusive)`);
      }
    }
  }

  // Civility → gender (0=Homme, 1=Femme)
  if (f.civility && f.civility !== 'Tous') {
    if (f.civility === 'Homme') { q.gender = 0; filtersApplied.push('Civilité: Homme'); }
    else if (f.civility === 'Femme') { q.gender = 1; filtersApplied.push('Civilité: Femme'); }
  }

  // Age range — by default NOT excluding leads with null date_of_birth
  // (use strictAge=true to enforce strict filtering)
  if (f.ageMin || f.ageMax) {
    const today = new Date();
    const dob: any = {};
    if (f.ageMin) {
      // age >= N  →  born on or before (today - N years)
      const cutoff = new Date(today.getFullYear() - Number(f.ageMin), today.getMonth(), today.getDate());
      dob.$lte = cutoff;
      diag.ageMin = Number(f.ageMin);
      filtersApplied.push(`Âge ≥ ${f.ageMin}`);
    }
    if (f.ageMax) {
      // age <= N  →  born on or after (today - N years)
      const cutoff = new Date(today.getFullYear() - Number(f.ageMax), today.getMonth(), today.getDate());
      dob.$gte = cutoff;
      diag.ageMax = Number(f.ageMax);
      filtersApplied.push(`Âge ≤ ${f.ageMax}`);
    }
    if (Object.keys(dob).length > 0) {
      if (strictAge) {
        // Strict mode: require non-null DOB
        q.date_of_birth = { ...dob, $ne: null, $exists: true };
        diag.excludedByNullDob = true;
      } else {
        // Lenient mode: include leads whose DOB is unknown
        q.$or = q.$or || [];
        q.$or.push({ date_of_birth: { ...dob, $ne: null } });
        q.$or.push({ date_of_birth: null });
        q.$or.push({ date_of_birth: { $exists: false } });
      }
    }
  }

  // City → location.city_id (numeric, resolved via TUNISIAN_CITIES)
  if (f.city && f.city !== 'Toutes') {
    const cityId = CITY_NAME_TO_ID[String(f.city).toLowerCase()];
    if (cityId !== undefined) {
      q['location.city_id'] = cityId;
      diag.city = f.city;
      filtersApplied.push(`Ville: ${f.city}`);
    } else {
      // Unknown city → return nothing so user sees the filter doesn't match
      q['location.city_id'] = -999;
    }
  }

  // Source → channel (1=form, 2=facebook)
  if (f.source && f.source !== 'Toutes') {
    const sq = SOURCE_QUERIES[f.source];
    if (sq) {
      Object.assign(q, sq);
      filtersApplied.push(`Source: ${f.source}`);
    }
  }

  // Statut → account_status / lead_stage combinations
  if (f.statut && f.statut !== 'Tous') {
    const sq = STATUS_QUERIES[f.statut];
    if (sq) {
      if (q.$and) q.$and.push(sq);
      else q.$and = [sq];
      filtersApplied.push(`Statut: ${f.statut}`);
    }
  }

  // Langue → summary_metrics.*_language_code
  if (f.langue && f.langue !== 'Toutes') {
    const code = LANGUE_CODES[f.langue];
    if (code) {
      q.$or = q.$or || [];
      q.$or.push({ 'summary_metrics.primary_language_code': code });
      q.$or.push({ 'summary_metrics.secondary_language_code': code });
      q.$or.push({ 'summary_metrics.tertiary_language_code': code });
      filtersApplied.push(`Langue: ${f.langue}`);
    }
  }

  // Expérience globale → summary_metrics.call_center_experience
  if (f.expGlobale && f.expGlobale !== 'Toutes') {
    const range = EXP_RANGES[f.expGlobale];
    if (range) {
      q['summary_metrics.call_center_experience'] = { $gte: range[0], $lte: range[1] };
      filtersApplied.push(`Exp. globale: ${f.expGlobale}`);
    }
  }

  // Score range → profile_completion (0-100)
  if (f.scoreMin || f.scoreMax) {
    q.profile_completion = q.profile_completion || {};
    if (f.scoreMin) { q.profile_completion.$gte = Number(f.scoreMin); filtersApplied.push(`Score ≥ ${f.scoreMin}`); }
    if (f.scoreMax) { q.profile_completion.$lte = Number(f.scoreMax); filtersApplied.push(`Score ≤ ${f.scoreMax}`); }
  }

  // Nb livraisons (proxy via lead_stage)
  if (f.livraisons && f.livraisons !== 'Tous') {
    if (f.livraisons === '0') {
      if (q.$and) q.$and.push({ lead_stage: { $lt: 2 } });
      else q.$and = [{ lead_stage: { $lt: 2 } }];
    } else if (f.livraisons === '3+') {
      q.lead_stage = { $gte: 2 };
    } else {
      q.lead_stage = { $gte: 2 };
    }
    filtersApplied.push(`Livraisons: ${f.livraisons}`);
  }

  // Dernière activité → last_activity_at
  if (f.lastActivity && f.lastActivity !== 'Toutes') {
    const today = new Date();
    const day = 86400000;
    if (f.lastActivity === '< 7 jours') {
      q.last_activity_at = { $gte: new Date(today.getTime() - 7 * day) };
    } else if (f.lastActivity === '7-30 jours') {
      q.last_activity_at = { $gte: new Date(today.getTime() - 30 * day), $lt: new Date(today.getTime() - 7 * day) };
    } else if (f.lastActivity === '30-90 jours') {
      q.last_activity_at = { $gte: new Date(today.getTime() - 90 * day), $lt: new Date(today.getTime() - 30 * day) };
    } else if (f.lastActivity === '> 90 jours') {
      q.last_activity_at = { $lt: new Date(today.getTime() - 90 * day) };
    }
    filtersApplied.push(`Activité: ${f.lastActivity}`);
  }

  // Text search (name, email, phone, public_id)
  if (f.search) {
    const escaped = String(f.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    const searchClauses = [
      { first_name: re }, { last_name: re }, { email: re },
      { phone: re }, { public_id: re },
    ];
    if (q.$or) q.$or = [...q.$or, ...searchClauses];
    else q.$or = searchClauses;
    filtersApplied.push(`Recherche: "${f.search}"`);
  }

  diag.excludedByDate = !!(diag.dateStart || diag.dateEnd);
  diag.excludedByAge  = !!(diag.ageMin || diag.ageMax);
  diag.totalFilters   = filtersApplied.length;

  return { query: q, diagnostics: diag };
}

// ---------------------------------------------------------------------------
// GET /api/bo/candidates  — paginated list with filters + diagnostics
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const col = await getCollection();
    if (!col) return res.json({ success: false, error: 'No collection found', data: [], total: 0 });

    const { collection, name } = col;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 20));
    const strictAge = req.query.strictAge === 'true';

    // Build MongoDB query from filter params
    const filters: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.query)) {
      if (['page', 'limit', 'strictAge'].includes(k)) continue;
      filters[k] = v;
    }
    const { query, diagnostics } = buildMongoQuery(filters, strictAge);

    // Run total + unfiltered total + data in parallel
    const [total, totalUnfiltered, data] = await Promise.all([
      collection.countDocuments(query),
      collection.countDocuments({}),
      collection.find(query).sort({ created_at: -1 }).skip((page - 1) * limit).limit(limit).toArray(),
    ]);

    // Enrich each doc with resolved city name + computed age
    const enriched = data.map((doc: any) => {
      const cityId = doc?.location?.city_id;
      const cityName = cityId != null ? (TUNISIAN_CITIES[Number(cityId)] || `Ville #${cityId}`) : null;
      let computedAge: number | null = null;
      if (doc.date_of_birth) {
        const dob = new Date(doc.date_of_birth);
        if (!isNaN(dob.getTime())) {
          const now = new Date();
          computedAge = now.getFullYear() - dob.getFullYear();
          const m = now.getMonth() - dob.getMonth();
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) computedAge--;
        }
      }
      return {
        ...doc,
        city_name: cityName,
        city_id: cityId,
        age: computedAge,
      };
    });

    res.json({
      success: true,
      collection: name,
      data: enriched,
      total,
      totalUnfiltered,
      page,
      limit,
      diagnostics,
      excludedCount: totalUnfiltered - total,
    });
  } catch (err: any) {
    console.error('[candidates] Error:', err);
    res.status(500).json({ success: false, error: err.message, data: [], total: 0 });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bo/candidates/filters  — dropdown options (1 DB round-trip)
// ---------------------------------------------------------------------------
router.get('/filters', async (req: Request, res: Response) => {
  try {
    const col = await getCollection();
    if (!col) return res.json({ success: false, error: 'No collection found' });
    const { collection } = col;

    const [citiesAgg, langsAgg, statusesAgg, sourcesAgg, ageAgg, scoreAgg, total] = await Promise.all([
      collection.aggregate([
        { $match: { 'location.city_id': { $ne: null, $exists: true } } },
        { $group: { _id: '$location.city_id', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $match: { 'summary_metrics.primary_language_code': { $exists: true, $ne: null } } },
        { $group: { _id: '$summary_metrics.primary_language_code', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray(),
      collection.aggregate([
        { $match: { account_status: { $exists: true } } },
        { $group: { _id: '$account_status', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $match: { channel: { $exists: true } } },
        { $group: { _id: '$channel', count: { $sum: 1 } } },
      ]).toArray(),
      collection.aggregate([
        { $match: { date_of_birth: { $exists: true, $ne: null } } },
        { $group: { _id: null, min: { $min: '$date_of_birth' }, max: { $max: '$date_of_birth' } } },
      ]).toArray(),
      collection.aggregate([
        { $match: { profile_completion: { $exists: true, $ne: null } } },
        { $group: { _id: null, min: { $min: '$profile_completion' }, max: { $max: '$profile_completion' } } },
      ]).toArray(),
      collection.countDocuments({}),
    ]);

    const cities = citiesAgg
      .map((c: any) => ({ id: c._id, label: TUNISIAN_CITIES[Number(c._id)] || `Ville #${c._id}`, count: c.count }))
      .filter((c: any) => c.label && !c.label.startsWith('Ville #'))
      .sort((a: any, b: any) => b.count - a.count);

    const languages = langsAgg.map((l: any) => ({ code: l._id, label: LANGUE_NAMES[l._id] || l._id, count: l.count }));
    const statuses = statusesAgg.map((s: any) => ({ id: s._id, label: STATUS_NAMES[s._id] || `Statut ${s._id}`, count: s.count }));
    const sources  = sourcesAgg.map((s: any) => ({ id: s._id, label: SOURCE_NAMES[s._id] || `Source ${s._id}`, count: s.count }));

    let ageMin = 18, ageMax = 65;
    if (ageAgg[0]?.min && ageAgg[0]?.max) {
      const now = new Date();
      ageMax = now.getFullYear() - new Date(ageAgg[0].min).getFullYear();
      ageMin = now.getFullYear() - new Date(ageAgg[0].max).getFullYear();
      if (ageMin < 16) ageMin = 16;
      if (ageMax > 80) ageMax = 80;
    }
    let scoreMin = 0, scoreMax = 100;
    if (scoreAgg[0]?.min != null) { scoreMin = scoreAgg[0].min; scoreMax = scoreAgg[0].max; }

    res.json({
      success: true,
      cities,
      languages,
      statuses,
      sources,
      age_range:   { min: ageMin, max: ageMax },
      score_range: { min: scoreMin, max: scoreMax },
      total,
    });
  } catch (err: any) {
    console.error('[filters] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bo/candidates/stats  — dashboard KPIs
// ---------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const db: any = mongoose.connection.db;
    const debug = req.query.debug === 'true';

    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : null;
    const dateFilter: any = {};
    if (startDate) dateFilter.$gte = startDate;
    if (endDate) dateFilter.$lte = endDate;

    const allCollections = await db.listCollections().toArray();
    const collectionNames = allCollections.map((c: any) => c.name);

    // Use the shared getCollection() helper so /stats uses the SAME collection
    // as / and /filters (avoids the bug where 'candidates' is empty but
    // 'leads' has the real data).
    const col = await getCollection();
    let collection: any = col?.collection || null;
    let collectionName = col?.name || '';
    if (!collection) {
      console.log('[stats] No standard name matched. Picking largest collection.');
      let max = 0;
      for (const c of allCollections) {
        const count = await db.collection(c.name).countDocuments({}, { limit: 1 });
        if (count > max) { max = count; collection = db.collection(c.name); collectionName = c.name; }
      }
    }
    console.log(`[stats] Using collection: ${collectionName}`);

    let baseQuery: any = {};
    const dateFields = ['createdAt', 'created_at', 'dateInscription', 'inscriptionDate', 'date', 'updatedAt'];
    if (startDate || endDate) {
      const sampleDoc = await collection.findOne({});
      if (sampleDoc) {
        const dateField = dateFields.find((f) => sampleDoc[f] instanceof Date);
        if (dateField) baseQuery[dateField] = { ...dateFilter };
      }
    }

    const total = await collection.countDocuments(baseQuery);

    let totalThisMonth = 0;
    const sampleDoc2 = await collection.findOne({});
    if (sampleDoc2) {
      const dateField = dateFields.find((f) => sampleDoc2[f] instanceof Date);
      if (dateField) {
        totalThisMonth = await collection.countDocuments({
          ...baseQuery,
          [dateField]: { $gte: startOfMonth() },
        });
      }
    }

    const inscritsForm = await adaptiveCount(collection, [
      { query: { ...baseQuery, source: { $regex: /formulaire|form|site|web|direct|organic|landing/i, $options: 'i' } }, label: 'source ~ formulaire/form/site/web/direct/organic' },
      { query: { ...baseQuery, origine: { $regex: /formulaire|form|site|web|direct|organic|landing/i, $options: 'i' } }, label: 'origine ~ formulaire/form/site/web/direct' },
      { query: { ...baseQuery, channel: 1 }, label: 'channel=1 (formulaire)' },
      { query: { ...baseQuery, imported: false }, label: 'imported=false' },
      { query: { ...baseQuery, imported: { $ne: true } }, label: 'imported != true' },
      { query: { ...baseQuery, fromFacebook: { $ne: true }, source: { $exists: true } }, label: 'not fromFacebook + has source' },
    ], 'Inscrits Formulaire');

    const importesFb = await adaptiveCount(collection, [
      { query: { ...baseQuery, source: { $regex: /facebook|fb|import/i, $options: 'i' } }, label: 'source ~ facebook/fb/import' },
      { query: { ...baseQuery, origine: { $regex: /facebook|fb|import/i, $options: 'i' } }, label: 'origine ~ facebook/fb/import' },
      { query: { ...baseQuery, channel: 2 }, label: 'channel=2 (Facebook)' },
      { query: { ...baseQuery, imported: true }, label: 'imported=true' },
      { query: { ...baseQuery, fromFacebook: true }, label: 'fromFacebook=true' },
      { query: { ...baseQuery, isImported: true }, label: 'isImported=true' },
    ], 'Importés Facebook');

    const desinscrits = await adaptiveCount(collection, [
      { query: { ...baseQuery, status: { $regex: /desinscrit|unsubscribed|opt.?out|optout|blacklist/i, $options: 'i' } }, label: 'status ~ desinscrit/unsubscribed' },
      { query: { ...baseQuery, 'verification.terms_accepted': false }, label: 'verification.terms_accepted=false' },
      { query: { ...baseQuery, unsubscribed: true }, label: 'unsubscribed=true' },
      { query: { ...baseQuery, desinscrit: true }, label: 'desinscrit=true' },
      { query: { ...baseQuery, optOut: true }, label: 'optOut=true' },
      { query: { ...baseQuery, blacklisted: true }, label: 'blacklisted=true' },
      { query: { ...baseQuery, desinscritAt: { $exists: true, $ne: null } }, label: 'desinscritAt exists' },
    ], 'Désinscrits');

    const locked = await adaptiveCount(collection, [
      { query: { ...baseQuery, locked: true }, label: 'locked=true' },
      { query: { ...baseQuery, isLocked: true }, label: 'isLocked=true' },
      { query: { ...baseQuery, account_status: 4 }, label: 'account_status=4 (locked)' },
      { query: { ...baseQuery, status: { $regex: /lock|bloqu|bloque/i, $options: 'i' } }, label: 'status ~ lock/bloque' },
      { query: { ...baseQuery, lockedAt: { $exists: true, $ne: null } }, label: 'lockedAt exists' },
    ], 'Profils Locked');

    const supprimes = await adaptiveCount(collection, [
      { query: { ...baseQuery, deleted: true }, label: 'deleted=true' },
      { query: { ...baseQuery, isDeleted: true }, label: 'isDeleted=true' },
      { query: { ...baseQuery, status: { $regex: /supprim|delet|inactif|inactive/i, $options: 'i' } }, label: 'status ~ supprim/delet/inactif' },
      { query: { ...baseQuery, active: false }, label: 'active=false' },
      { query: { ...baseQuery, isActive: false }, label: 'isActive=false' },
      { query: { ...baseQuery, deletedAt: { $exists: true, $ne: null } }, label: 'deletedAt exists' },
    ], 'Profils Supprimés');

    const livres = await adaptiveCount(collection, [
      { query: { ...baseQuery, lead_stage: 6 }, label: 'lead_stage=6 (livré)' },
      { query: { ...baseQuery, status: { $regex: /livr|delivered/i, $options: 'i' } }, label: 'status ~ livr/delivered' },
      { query: { ...baseQuery, livraisons: { $gt: 0 } }, label: 'livraisons > 0' },
      { query: { ...baseQuery, delivered: true }, label: 'delivered=true' },
      { query: { ...baseQuery, isDelivered: true }, label: 'isDelivered=true' },
    ], 'Livrés');

    const entretienTel = await adaptiveCount(collection, [
      { query: { ...baseQuery, lead_stage: 3 }, label: 'lead_stage=3 (entretien tel)' },
      { query: { ...baseQuery, status: { $regex: /tel|phone|appel/i, $options: 'i' } }, label: 'status ~ tel/phone/appel' },
      { query: { ...baseQuery, entretienTel: true }, label: 'entretienTel=true' },
      { query: { ...baseQuery, currentStep: 'entretien_telephonique' }, label: 'currentStep=entretien_telephonique' },
    ], 'Entretien Téléphonique');

    const entretienPhys = await adaptiveCount(collection, [
      { query: { ...baseQuery, lead_stage: 4 }, label: 'lead_stage=4 (entretien phys)' },
      { query: { ...baseQuery, status: { $regex: /phys|presentiel/i, $options: 'i' } }, label: 'status ~ phys/presentiel' },
      { query: { ...baseQuery, entretienPhys: true }, label: 'entretienPhys=true' },
      { query: { ...baseQuery, currentStep: 'entretien_physique' }, label: 'currentStep=entretien_physique' },
    ], 'Entretien Physique');

    const formationJ1 = await adaptiveCount(collection, [
      { query: { ...baseQuery, lead_stage: 5 }, label: 'lead_stage=5 (formation)' },
      { query: { ...baseQuery, status: { $regex: /formation|j1/i, $options: 'i' } }, label: 'status ~ formation/j1' },
      { query: { ...baseQuery, formation: true }, label: 'formation=true' },
      { query: { ...baseQuery, currentStep: 'formation' }, label: 'currentStep=formation' },
    ], 'Formation J+1');

    const integresJ7 = await adaptiveCount(collection, [
      { query: { ...baseQuery, lead_stage: 6 }, label: 'lead_stage=6 (intégré)' },
      { query: { ...baseQuery, status: { $regex: /integre|integrated|j7/i, $options: 'i' } }, label: 'status ~ integre/j7' },
      { query: { ...baseQuery, integrated: true }, label: 'integrated=true' },
      { query: { ...baseQuery, integre: true }, label: 'integre=true' },
    ], 'Intégrés J+7');

    const jamaisLivres = Math.max(0, total - livres.count);
    const tauxLivraison = total > 0 ? Math.round((livres.count / total) * 1000) / 10 : 0;

    const response: any = {
      success: true,
      collection: collectionName,
      dateFilter: (startDate || endDate) ? { startDate, endDate } : null,
      stats: {
        total_leads: total,
        total_leads_this_month: totalThisMonth,
        inscrits_formulaire: inscritsForm.count,
        importes_facebook: importesFb.count,
        desinscrits: desinscrits.count,
        profils_locked: locked.count,
        profils_supprimes: supprimes.count,
        livres: livres.count,
        jamais_livres: jamaisLivres,
        taux_livraison: tauxLivraison,
        entretien_telephonique: entretienTel.count,
        entretien_physique: entretienPhys.count,
        formation_j1: formationJ1.count,
        integres_j7: integresJ7.count,
      },
      percentages: {
        inscrits_formulaire: pct(inscritsForm.count, total),
        importes_facebook: pct(importesFb.count, total),
        desinscrits: pct(desinscrits.count, total),
        profils_locked: pct(locked.count, total),
        profils_supprimes: pct(supprimes.count, total),
        jamais_livres: pct(jamaisLivres, total),
        entretien_telephonique: pct(entretienTel.count, total),
        entretien_physique: pct(entretienPhys.count, total),
        formation_j1: pct(formationJ1.count, total),
        integres_j7: pct(integresJ7.count, total),
      },
      debug: {
        matchedPatterns: {
          inscrits_formulaire: inscritsForm.matchedPattern,
          importes_facebook: importesFb.matchedPattern,
          desinscrits: desinscrits.matchedPattern,
          profils_locked: locked.matchedPattern,
          profils_supprimes: supprimes.matchedPattern,
          livres: livres.matchedPattern,
          entretien_telephonique: entretienTel.matchedPattern,
          entretien_physique: entretienPhys.matchedPattern,
          formation_j1: formationJ1.matchedPattern,
          integres_j7: integresJ7.matchedPattern,
        },
      },
    };

    if (debug) {
      response.debug.allTriedPatterns = {
        inscrits_formulaire: inscritsForm.triedPatterns,
        importes_facebook: importesFb.triedPatterns,
        desinscrits: desinscrits.triedPatterns,
        profils_locked: locked.triedPatterns,
        profils_supprimes: supprimes.triedPatterns,
        livres: livres.triedPatterns,
        entretien_telephonique: entretienTel.triedPatterns,
        entretien_physique: entretienPhys.triedPatterns,
        formation_j1: formationJ1.triedPatterns,
        integres_j7: integresJ7.triedPatterns,
      };
    }

    res.json(response);
  } catch (err: any) {
    console.error('[stats] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bo/candidates/stats-by-ville — Top Villes for Dashboard
// ---------------------------------------------------------------------------
// This is the endpoint the Dashboard.tsx Top Villes section ACTUALLY calls
// (via api.getCandidatesByVille()).
//
// Returns the full shape the frontend expects:
//   {
//     success: true,
//     collection: 'leads',
//     total_leads: 14,
//     covered_by_top: 14,
//     coverage_pct: 100,
//     city_field: 'location.city_id' | null,
//     top_cities: [{ ville, count, percentage, raw_id? }],
//     tried_fields: [{ field, score, reason, coverage?, distinct?, samples? }],
//     _source: 'live' | 'fallback',
//   }
//
// v7.3 logic: detects numeric city_id fields (location.city_id with values
// 1, 11, 19, 14) and resolves them to Tunisian governorate names.
// ---------------------------------------------------------------------------

const POSSIBLE_CITY_FIELDS_VILLE = [
  'ville',
  'city',
  'city_name',
  'ville_name',
  'nom_ville',
  'address.ville',
  'address.city',
  'address.city_name',
  'location.ville',
  'location.city',
  'location.city_name',
  'location.city_id',
  'city_id',
  'ville_id',
  'localisation.ville',
  'localisation.city',
  'localisation.city_id',
  'geo.ville',
  'geo.city',
  'contact.ville',
  'contact.city',
  'personal.ville',
  'personal.city',
  'address.ville_id',
];

function resolveCityNameVille(rawId: any): string {
  if (rawId === null || rawId === undefined || rawId === '') return 'Inconnu';
  const num = Number(rawId);
  if (!Number.isFinite(num)) return String(rawId);
  return TUNISIAN_CITIES[num] || `Ville #${num}`;
}

function getNestedValueVille(obj: any, path: string): any {
  if (!obj) return undefined;
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce((acc: any, key: string) => (acc == null ? acc : acc[key]), obj);
}

interface TriedField {
  field: string;
  score: number;
  reason: string;
  coverage?: number;
  distinct?: number;
  samples?: string[];
}

async function discoverCityFieldVille(
  collection: any,
  collName: string,
  limit = 10
): Promise<{
  cityField: string | null;
  tried: TriedField[];
  topCities: any[];
  totalLeads: number;
  coveredByTop: number;
  coveragePct: number;
}> {
  const total = await collection.countDocuments();
  if (total === 0) {
    return { cityField: null, tried: [], topCities: [], totalLeads: 0, coveredByTop: 0, coveragePct: 0 };
  }

  // Sample up to 200 docs to inspect schema cheaply
  const sampleDocs = await collection.find({}, { projection: { _id: 0 } }).limit(200).toArray();

  let bestField: string | null = null;
  let bestScore = -1;
  const tried: TriedField[] = [];

  for (const field of POSSIBLE_CITY_FIELDS_VILLE) {
    const rawValues: any[] = [];
    let presentCount = 0;
    const sampleSet = new Set<string>();

    for (const doc of sampleDocs) {
      const v = getNestedValueVille(doc, field);
      if (v !== undefined && v !== null && v !== '') {
        presentCount++;
        rawValues.push(v);
        if (sampleSet.size < 5) {
          const sv = typeof v === 'object' ? '[object]' : String(v).substring(0, 80);
          sampleSet.add(sv);
        }
      }
    }

    const coverage = sampleDocs.length > 0 ? presentCount / sampleDocs.length : 0;
    if (coverage < 0.3) {
      tried.push({
        field,
        score: 0,
        reason: `coverage trop faible (${presentCount}/${sampleDocs.length} = ${Math.round(coverage * 100)}%)`,
        coverage: Math.round(coverage * 1000) / 10,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    // v7.3: if field name looks like a city_id, convert numbers to strings
    // BEFORE the string-value check so we don't reject numeric city_id fields.
    const isCityIdField =
      /city_?id|ville_?id|town_?id|commune_?id|delegation_?id|governorate_?id/i.test(field);
    const values = isCityIdField
      ? rawValues.map((v) => (typeof v === 'number' ? String(v) : v))
      : rawValues;

    const stringValues = values.filter((v) => typeof v === 'string');
    if (stringValues.length < presentCount * 0.8) {
      tried.push({
        field,
        score: 0,
        reason: `trop de valeurs non-string (${stringValues.length}/${presentCount})`,
        coverage: Math.round(coverage * 1000) / 10,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const cleanedValues = stringValues.map((v) => String(v).trim()).filter((v) => v);
    if (cleanedValues.length === 0) {
      tried.push({
        field,
        score: 0,
        reason: 'aucune valeur nettoyée',
        coverage: Math.round(coverage * 1000) / 10,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const distinct = new Set(cleanedValues.map((v) => v.toLowerCase()));
    if (distinct.size < 2) {
      tried.push({
        field,
        score: 0,
        reason: `cardinalité trop faible (${distinct.size} valeur distincte)`,
        coverage: Math.round(coverage * 1000) / 10,
        distinct: distinct.size,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const numericRatio =
      cleanedValues.filter((v) => /^-?\d+(\.\d+)?$/.test(String(v).trim())).length /
      cleanedValues.length;
    const isNumeric = numericRatio > 0.8;
    if (isNumeric && !isCityIdField) {
      tried.push({
        field,
        score: 0,
        reason: `valeurs toutes numériques mais pas un city_id (${Math.round(numericRatio * 100)}%)`,
        coverage: Math.round(coverage * 1000) / 10,
        distinct: distinct.size,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const idPatternRatio =
      cleanedValues.filter((v) => /^[A-Z]{2,4}[-_]\d{2,4}[-_]?\d{2,6}$/i.test(v)).length /
      cleanedValues.length;
    if (idPatternRatio > 0.5) {
      tried.push({
        field,
        score: 0,
        reason: `ressemble à des IDs (${Math.round(idPatternRatio * 100)}%)`,
        coverage: Math.round(coverage * 1000) / 10,
        distinct: distinct.size,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const uniquenessRatio = distinct.size / cleanedValues.length;
    if (uniquenessRatio > 0.7 && !(isCityIdField && isNumeric)) {
      tried.push({
        field,
        score: 0,
        reason: `unicité trop haute (${Math.round(uniquenessRatio * 100)}%) — ressemble à un ID unique`,
        coverage: Math.round(coverage * 1000) / 10,
        distinct: distinct.size,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    // For numeric city_id fields: require LOW cardinality (each ID is shared by multiple leads)
    if (isNumeric && isCityIdField && uniquenessRatio >= 0.5) {
      tried.push({
        field,
        score: 0,
        reason: `city_id numérique mais trop d'unicité (${Math.round(uniquenessRatio * 100)}%)`,
        coverage: Math.round(coverage * 1000) / 10,
        distinct: distinct.size,
        samples: Array.from(sampleSet),
      });
      continue;
    }

    const cityIdBonus = isNumeric && isCityIdField ? 2 : 0;
    const score = coverage * 10 + Math.min(distinct.size, 20) + cityIdBonus;
    tried.push({
      field,
      score: Math.round(score * 100) / 100,
      reason: `OK — coverage ${Math.round(coverage * 100)}%, ${distinct.size} villes distinctes${isNumeric ? ' (city_id numérique résolu via TUNISIAN_CITIES)' : ''}`,
      coverage: Math.round(coverage * 1000) / 10,
      distinct: distinct.size,
      samples: Array.from(sampleSet),
    });

    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  let topCities: any[] = [];
  let coveredByTop = 0;
  let coveragePct = 0;

  if (bestField) {
    const isCityIdField =
      /city_?id|ville_?id|town_?id|commune_?id|delegation_?id|governorate_?id/i.test(bestField);

    const grouped = await collection
      .aggregate([
        {
          $match: {
            [bestField]: {
              $exists: true,
              $nin: [null, '', 'null', 'undefined'],
              $not: { $type: 'array' },
            },
          },
        },
        {
          $group: {
            _id: { $toString: `$${bestField}` },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: ['', null, 'null', 'undefined'] } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();

    topCities = grouped
      .filter((g: any) => {
        const v = String(g._id ?? '').trim();
        return v && v.toLowerCase() !== 'null' && v.toLowerCase() !== 'undefined';
      })
      .map((g: any) => {
        const rawId = String(g._id).trim();
        const cityName = isCityIdField ? resolveCityNameVille(rawId) : rawId;
        return {
          ville: cityName,
          count: g.count,
          percentage: total > 0 ? Math.round((g.count / total) * 1000) / 10 : 0,
          raw_id: isCityIdField ? rawId : undefined,
        };
      })
      .reduce((acc: any[], entry: any) => {
        const existing = acc.find((x) => x.ville === entry.ville);
        if (existing) {
          existing.count += entry.count;
          existing.percentage = total > 0 ? Math.round((existing.count / total) * 1000) / 10 : 0;
        } else {
          acc.push(entry);
        }
        return acc;
      }, [])
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, limit);

    coveredByTop = topCities.reduce((sum: number, c: any) => sum + c.count, 0);
    coveragePct = total > 0 ? Math.round((coveredByTop / total) * 1000) / 10 : 0;
  }

  console.log(
    `[stats-by-ville] discovered city_field=${bestField ?? 'NONE'} (collection=${collName}, total=${total}, tried=${tried.length}, covered=${coveredByTop}/${total}=${coveragePct}%)`
  );

  return {
    cityField: bestField,
    tried,
    topCities,
    totalLeads: total,
    coveredByTop,
    coveragePct,
  };
}

router.get('/stats-by-ville', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 10));
    const col = await getCollection();
    if (!col) {
      return res.json({
        success: false,
        error: 'No collection found',
        collection: null,
        total_leads: 0,
        covered_by_top: 0,
        coverage_pct: 0,
        city_field: null,
        top_cities: [],
        tried_fields: [],
        _source: 'fallback',
      });
    }
    const { collection, name } = col;

    const result = await discoverCityFieldVille(collection, name, limit);

    res.json({
      success: true,
      collection: name,
      total_leads: result.totalLeads,
      covered_by_top: result.coveredByTop,
      coverage_pct: result.coveragePct,
      city_field: result.cityField,
      top_cities: result.topCities,
      tried_fields: result.tried,
      _source: result.cityField ? 'live' : 'fallback',
    });
  } catch (err: any) {
    console.error('[stats-by-ville] Error:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      collection: null,
      total_leads: 0,
      covered_by_top: 0,
      coverage_pct: 0,
      city_field: null,
      top_cities: [],
      tried_fields: [],
      _source: 'fallback',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /api/bo/candidates/inspect  — schema discovery (debug)
// Recurses one level into nested objects (e.g. location.city_id).
// ---------------------------------------------------------------------------
router.get('/inspect', async (req: Request, res: Response) => {
  try {
    const db: any = mongoose.connection.db;
    const allCollections = await db.listCollections().toArray();
    const collectionNames = allCollections.map((c: any) => c.name);

    // Use shared helper — picks the first NON-EMPTY collection in priority order
    const col = await getCollection();
    let collection: any = col?.collection || null;
    let collectionName = col?.name || '';

    if (!collection) {
      return res.json({
        success: false,
        error: 'No candidates collection found',
        collections: collectionNames,
      });
    }

    const total = await collection.countDocuments();
    const sample = await collection.find({}).limit(5).toArray();
    const sampleDoc = sample[0] || {};

    const fieldSample = await collection.find({}).limit(200).toArray();
    const fieldMap: Record<string, { count: number; types: Set<string>; sampleValues: any[] }> = {};

    for (const doc of fieldSample) {
      for (const [key, val] of Object.entries(doc)) {
        if (key === '__v') continue;
        if (!fieldMap[key]) fieldMap[key] = { count: 0, types: new Set(), sampleValues: [] };
        fieldMap[key].count++;
        const t = val === null ? 'null' : Array.isArray(val) ? 'array' : val instanceof Date ? 'Date' : typeof val;
        fieldMap[key].types.add(t);
        if (fieldMap[key].sampleValues.length < 5 && val !== null) {
          const sv = typeof val === 'object' ? '[object]' : String(val).substring(0, 80);
          if (!fieldMap[key].sampleValues.includes(sv)) {
            fieldMap[key].sampleValues.push(sv);
          }
        }

        // Recurse one level into nested plain objects (e.g. location, verification, summary_metrics)
        if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
          for (const [subKey, subVal] of Object.entries(val)) {
            const compositeKey = `${key}.${subKey}`;
            if (!fieldMap[compositeKey]) fieldMap[compositeKey] = { count: 0, types: new Set(), sampleValues: [] };
            fieldMap[compositeKey].count++;
            const st = subVal === null ? 'null' : Array.isArray(subVal) ? 'array' : subVal instanceof Date ? 'Date' : typeof subVal;
            fieldMap[compositeKey].types.add(st);
            if (fieldMap[compositeKey].sampleValues.length < 5 && subVal !== null) {
              const ssv = typeof subVal === 'object' ? '[object]' : String(subVal).substring(0, 80);
              if (!fieldMap[compositeKey].sampleValues.includes(ssv)) {
                fieldMap[compositeKey].sampleValues.push(ssv);
              }
            }
          }
        }
      }
    }

    const lowCardFields: any = {};
    for (const [field, info] of Object.entries(fieldMap)) {
      if (field === '_id') continue;
      if (info.count < fieldSample.length * 0.5) continue;
      try {
        const parts = field.split('.');
        const distinct = await collection.distinct(parts.length === 2 ? `${parts[0]}.${parts[1]}` : field);
        if (distinct.length <= 30) {
          lowCardFields[field] = distinct.slice(0, 30).map((v: any) =>
            typeof v === 'object' ? JSON.stringify(v) : String(v)
          );
        }
      } catch { /* ignore */ }
    }

    res.json({
      success: true,
      collection: collectionName,
      total,
      fields: Object.entries(fieldMap).map(([f, info]) => ({
        field: f,
        coverage: `${info.count}/${fieldSample.length}`,
        types: Array.from(info.types),
        sampleValues: info.sampleValues,
      })),
      distinctValues: lowCardFields,
      sampleDocument: sampleDoc,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
