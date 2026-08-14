/**
 * dashboard.ts — v3 — auto-discovers city field WITH numeric city_id support
 * -----------------------------------------------------------------------------
 * v2 introduced adaptive auto-discovery, but it had the same bug as
 * candidatesStats.ts v7.2: the "reject numeric values" check (numericRatio > 0.8)
 * killed `location.city_id` before any special-case logic could run.
 *
 * v3 ports the v7.3 fix from candidatesStats.ts:
 *   1. Detect numeric city_id fields BEFORE the numeric-rejection
 *   2. Convert numbers to strings so they pass downstream validation
 *   3. After aggregation, resolve the IDs to Tunisian city names via TUNISIAN_CITIES
 *
 * Also adds the TUNISIAN_CITIES lookup table so /charts/candidates-by-city
 * returns the same human-readable names as /candidates/stats-by-ville.
 *
 * All other endpoints (kpis, activity, revenue, by-language) are unchanged.
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

function getDb(): any {
  const mongoose = require('mongoose');
  return mongoose.connection.db;
}

// Detect which collection holds candidates/leads
async function pickCollection(db: any, candidates: string[]): Promise<string | null> {
  for (const name of candidates) {
    try {
      const exists = await db.listCollections({ name }).hasNext();
      if (exists) {
        const count = await db.collection(name).countDocuments();
        if (count > 0) return name;
      }
    } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tunisian governorates lookup table (mirrors candidatesStats.ts v7.3)
// ---------------------------------------------------------------------------
const TUNISIAN_CITIES: Record<number, string> = {
  1: 'Tunis',
  2: 'Ariana',
  3: 'Ben Arous',
  4: 'Manouba',
  5: 'Nabeul',
  6: 'Zaghouan',
  7: 'Bizerte',
  8: 'Béja',
  9: 'Jendouba',
  10: 'Le Kef',
  11: 'Sousse',
  12: 'Monastir',
  13: 'Mahdia',
  14: 'Sfax',
  15: 'Kairouan',
  16: 'Kasserine',
  17: 'Sidi Bouzid',
  18: 'Gabès',
  19: 'Médenine',
  20: 'Tataouine',
  21: 'Gafsa',
  22: 'Tozeur',
  23: 'Kebili',
  24: 'Silyana',
  25: 'Le Kef',
};

function resolveCityName(rawId: any): string {
  if (rawId === null || rawId === undefined || rawId === '') return 'Inconnu';
  const num = Number(rawId);
  if (!Number.isFinite(num)) return String(rawId);
  return TUNISIAN_CITIES[num] || `Ville #${num}`;
}

// ---------------------------------------------------------------------------
// City field auto-discovery (v3 — mirrors candidatesStats.ts v7.3 logic)
// ---------------------------------------------------------------------------
// Possible city field paths — first one that yields real, distinct, non-numeric
// string values wins. Order matters: most-likely names first.
const POSSIBLE_CITY_FIELDS = [
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
  'ville_id',
];

// 5-minute cache so we don't re-scan the collection on every dashboard refresh
let cityFieldCache: { collection: string; field: string | null; at: number } = {
  collection: '',
  field: null,
  at: 0,
};
const CITY_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Try every candidate field path against the collection.
 *
 * v3: now accepts numeric city_id fields (e.g. `location.city_id` with values
 * like 1, 11, 19). Numeric values are converted to strings first, so they pass
 * the string-only validation. The aggregation later maps them via
 * resolveCityName() to human-readable Tunisian city names.
 */
async function discoverCityField(
  collection: any,
  collName: string
): Promise<string | null> {
  // Use cache if fresh
  const now = Date.now();
  if (
    cityFieldCache.collection === collName &&
    now - cityFieldCache.at < CITY_CACHE_TTL_MS
  ) {
    return cityFieldCache.field;
  }

  const total = await collection.countDocuments();
  if (total === 0) {
    cityFieldCache = { collection: collName, field: null, at: now };
    return null;
  }

  // Sample up to 200 docs to inspect schema cheaply
  const sampleDocs = await collection.find({}, { projection: { _id: 0 } }).limit(200).toArray();

  function getNestedValue(obj: any, path: string): any {
    if (!obj) return undefined;
    if (!path.includes('.')) return obj[path];
    return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
  }

  let bestField: string | null = null;
  let bestScore = -1;

  for (const field of POSSIBLE_CITY_FIELDS) {
    const rawValues: any[] = [];
    let presentCount = 0;

    for (const doc of sampleDocs) {
      const v = getNestedValue(doc, field);
      if (v !== undefined && v !== null && v !== '') {
        presentCount++;
        rawValues.push(v);
      }
    }

    const coverage = presentCount / sampleDocs.length;
    if (coverage < 0.3) continue; // skip fields barely present

    // v3: if field name looks like a city_id, convert numbers to strings
    // BEFORE the string-value check so we don't reject numeric city_id fields.
    const isCityIdField =
      /city_?id|ville_?id|town_?id|commune_?id|delegation_?id|governorate_?id/i.test(field);
    const values = isCityIdField
      ? rawValues.map((v) => (typeof v === 'number' ? String(v) : v))
      : rawValues;

    const stringValues = values.filter((v) => typeof v === 'string');
    if (stringValues.length < presentCount * 0.8) continue;

    const cleanedValues = stringValues.map((v) => String(v).trim()).filter((v) => v);
    if (cleanedValues.length === 0) continue;

    const distinct = new Set(cleanedValues.map((v) => v.toLowerCase()));
    if (distinct.size < 2) continue; // need at least 2 different cities

    // Reject fields that look like IDs: mostly numeric, or all integers
    // EXCEPT for city_id fields (1=Tunis, 11=Sousse, etc. are legitimately numeric)
    const numericRatio =
      cleanedValues.filter((v) => /^-?\d+(\.\d+)?$/.test(String(v).trim())).length /
      cleanedValues.length;
    const isNumeric = numericRatio > 0.8;
    if (isNumeric && !isCityIdField) continue;

    // Reject ID patterns like "LD-2026-00201" (won't match pure numbers anyway)
    const idPatternRatio =
      cleanedValues.filter((v) => /^[A-Z]{2,4}[-_]\d{2,4}[-_]?\d{2,6}$/i.test(v)).length /
      cleanedValues.length;
    if (idPatternRatio > 0.5) continue;

    // Cardinality check — a real city field groups many leads into few values
    const uniquenessRatio = distinct.size / cleanedValues.length;
    // For numeric city_id fields, allow higher uniqueness (each ID is unique-ish,
    // but they still group leads because multiple leads share the same city_id)
    if (uniquenessRatio > 0.7 && !(isCityIdField && isNumeric)) continue;

    // For numeric city_id fields: require LOW cardinality
    if (isNumeric && isCityIdField && uniquenessRatio >= 0.5) continue;

    // Score: prefer higher coverage AND higher distinct count
    // v3: bonus for numeric city_id fields (they need the resolver)
    const cityIdBonus = isNumeric && isCityIdField ? 2 : 0;
    const score = coverage * 10 + Math.min(distinct.size, 20) + cityIdBonus;
    if (score > bestScore) {
      bestScore = score;
      bestField = field;
    }
  }

  cityFieldCache = { collection: collName, field: bestField, at: now };
  console.log(
    `[dashboard] discoverCityField → ${bestField ?? 'NONE'} (collection=${collName}, sampled=${sampleDocs.length})`
  );
  return bestField;
}

// GET /api/bo/dashboard/kpis?period=30d
router.get(
  '/kpis',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const db = getDb();

    const days = (() => {
      const p = req.query.period as string;
      if (p === 'today') return 1;
      if (p === '7d') return 7;
      if (p === '90d') return 90;
      return 30;
    })();
    const since = new Date(Date.now() - days * 86400000);

    // Pick the right collection names from the user's actual DB
    const leadsColl = await pickCollection(db, ['leads', 'candidates', 'candidats']);
    const companiesColl = await pickCollection(db, ['companies', 'clients', 'societes']);
    const ordersColl = await pickCollection(db, ['orders', 'commandes']);
    const paymentsColl = await pickCollection(db, ['payments', 'paiements']);
    const activityColl = await pickCollection(db, ['activity_logs', 'activitylogs', 'logs']);

    const [totalLeads, newLeads, totalCompanies, activeCompanies, totalOrders, paidAgg, pendingAgg, recentActivities] = await Promise.all([
      leadsColl ? db.collection(leadsColl).countDocuments({ deleted_at: null }) : 0,
      leadsColl ? db.collection(leadsColl).countDocuments({ created_at: { $gte: since }, deleted_at: null }) : 0,
      companiesColl ? db.collection(companiesColl).countDocuments({ deleted_at: null }) : 0,
      companiesColl ? db.collection(companiesColl).countDocuments({
        $and: [
          { deleted_at: null },
          {
            $or: [
              { account_status: 1 },
              { status: { $in: ['Actif', 'active', 'Active', 1] } },
              { record_status: 1 },
            ],
          },
        ],
      }) : 0,
      ordersColl ? db.collection(ordersColl).countDocuments({ deleted_at: null }) : 0,
      paymentsColl ? db.collection(paymentsColl).aggregate([
        { $match: { $or: [{ payment_status: 1 }, { payment_status: 'paid' }, { payment_status: 'Payé' }] } },
        { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
      ]).toArray() : [],
      paymentsColl ? db.collection(paymentsColl).aggregate([
        { $match: { $or: [{ payment_status: 2 }, { payment_status: 'pending' }, { payment_status: 'En attente' }] } },
        { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
      ]).toArray() : [],
      activityColl ? db.collection(activityColl).find({}).sort({ timestamp: -1, created_at: -1 }).limit(20).toArray() : [],
    ]);

    const revenue = paidAgg[0]?.total || 0;
    const pending = pendingAgg[0]?.total || 0;

    res.json({
      total_candidates: totalLeads,
      new_candidates_period: newLeads,
      total_companies: totalCompanies,
      active_companies: activeCompanies,
      total_orders: totalOrders,
      revenue_total: revenue,
      revenue_period: revenue,
      pending_payments: pending,
      activities: recentActivities,
      // For frontend fallbacks
      total_leads: totalLeads,
      conversion_rate: 0,
      _collections: { leads: leadsColl, companies: companiesColl, orders: ordersColl, payments: paymentsColl, activity: activityColl },
    });
  })
);

// GET /api/bo/dashboard/activity?limit=20
router.get(
  '/activity',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const collName = await pickCollection(db, ['activity_logs', 'activitylogs', 'logs']);
    if (!collName) return res.json({ data: [] });
    const items = await db.collection(collName).find({}).sort({ timestamp: -1, created_at: -1 }).limit(limit).toArray();
    res.json({ data: items });
  })
);

// GET /api/bo/dashboard/charts/revenue?period=monthly
router.get(
  '/charts/revenue',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const db = getDb();
    const collName = await pickCollection(db, ['payments', 'paiements']);
    if (!collName) return res.json([]);

    const now = new Date();
    const buckets: any[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, year: start.getFullYear(), month: start.getMonth() + 1 });
    }

    const grouped = await db.collection(collName).aggregate([
      {
        $match: {
          $or: [
            { payment_status: 1 },
            { payment_status: 'paid' },
            { payment_status: 'Payé' },
          ],
        },
      },
      {
        $group: {
          _id: {
            year: { $year: { $ifNull: ['$payment_declared_at', '$created_at'] } },
            month: { $month: { $ifNull: ['$payment_declared_at', '$created_at'] } },
          },
          total: { $sum: '$payment_amount' },
          count: { $sum: 1 },
        },
      },
    ]).toArray();

    const lookup = new Map<string, number>();
    for (const g of grouped as any[]) lookup.set(`${g._id.year}-${g._id.month}`, g.total);

    const series = buckets.map((b) => ({
      year: b.year,
      month: b.month,
      label: `${String(b.month).padStart(2, '0')}/${String(b.year).slice(2)}`,
      value: lookup.get(`${b.year}-${b.month}`) || 0,
    }));
    res.json(series);
  })
);

// GET /api/bo/dashboard/charts/candidates-by-city
// ---------------------------------------------------------------------------
// v3 — adaptive city field discovery WITH numeric city_id resolution.
// If the discovered field is a numeric city_id (e.g. `location.city_id`),
// each grouped _id is resolved to a Tunisian city name via TUNISIAN_CITIES.
// ---------------------------------------------------------------------------
router.get(
  '/charts/candidates-by-city',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const db = getDb();
    const collName = await pickCollection(db, ['leads', 'candidates', 'candidats']);
    if (!collName) return res.json([]);

    const collection = db.collection(collName);
    const cityField = await discoverCityField(collection, collName);

    if (!cityField) {
      // No city-like field found — return empty so the frontend falls back
      // to its demo data (Paris, Lyon, Berlin, …).
      return res.json([]);
    }

    // Is the discovered field a numeric city_id? If so, resolve each grouped
    // _id to a human-readable Tunisian city name via TUNISIAN_CITIES.
    const isCityIdField =
      /city_?id|ville_?id|town_?id|commune_?id|delegation_?id|governorate_?id/i.test(cityField);

    // Aggregate using the discovered field path.
    // $toString coerces numeric/object city IDs to strings so they group cleanly.
    // $nin filter excludes null/empty/'null'/'undefined' placeholders.
    const grouped = await collection
      .aggregate([
        {
          $match: {
            [cityField]: {
              $exists: true,
              $nin: [null, '', 'null', 'undefined'],
              $not: { $type: 'array' },
            },
          },
        },
        {
          $group: {
            _id: { $toString: `$${cityField}` },
            count: { $sum: 1 },
          },
        },
        { $match: { _id: { $nin: ['', null, 'null', 'undefined'] } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ])
      .toArray();

    const total = await collection.countDocuments();

    const cleaned = grouped
      .filter((g: any) => {
        const v = String(g._id ?? '').trim();
        return v && v.toLowerCase() !== 'null' && v.toLowerCase() !== 'undefined';
      })
      .map((g: any) => {
        const rawId = String(g._id).trim();
        // v3: resolve numeric city_id to a Tunisian city name
        const cityName = isCityIdField ? resolveCityName(rawId) : rawId;
        return {
          city: cityName,
          count: g.count,
          // Backward-compat field names the frontend looks for
          ville: cityName,
          label: cityName,
          raw_id: isCityIdField ? rawId : undefined,
          percentage: total > 0 ? Math.round((g.count / total) * 1000) / 10 : 0,
        };
      })
      // Merge entries that resolve to the same city name (e.g. if two different
      // city_ids somehow map to the same name due to lookup table collisions)
      .reduce((acc: any[], entry: any) => {
        const existing = acc.find((x) => x.city === entry.city);
        if (existing) {
          existing.count += entry.count;
          existing.percentage = total > 0 ? Math.round((existing.count / total) * 1000) / 10 : 0;
        } else {
          acc.push(entry);
        }
        return acc;
      }, [])
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 10);

    res.json(cleaned);
  })
);

// GET /api/bo/dashboard/charts/candidates-by-language
router.get(
  '/charts/candidates-by-language',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const db = getDb();
    const collName = await pickCollection(db, ['leads', 'candidates', 'candidats']);
    if (!collName) return res.json([]);

    // Languages are in summary_metrics.primary_language_code (and secondary/tertiary)
    const grouped = await db.collection(collName).aggregate([
      {
        $facet: {
          primary: [
            { $group: { _id: '$summary_metrics.primary_language_code', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          all: [
            { $project: { langs: ['$summary_metrics.primary_language_code', '$summary_metrics.secondary_language_code', '$summary_metrics.tertiary_language_code'] } },
            { $unwind: '$langs' },
            { $match: { langs: { $ne: null } } },
            { $group: { _id: '$langs', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
        },
      },
    ]).toArray();

    const list = (grouped[0]?.all?.length ? grouped[0].all : grouped[0]?.primary) || [];
    res.json(list.map((g: any) => ({ language: g._id || 'Inconnu', count: g.count })));
  })
);

export default router;
