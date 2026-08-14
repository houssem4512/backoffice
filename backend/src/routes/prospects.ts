/**
 * prospects.ts — PRO v1.0
 * -----------------------------------------------------------------------------
 * Complete CRM backend for the Prospects module.
 *
 * Endpoints:
 *   GET  /api/bo/prospects                  — paginated list with advanced server-side filters
 *   GET  /api/bo/prospects/stats            — full KPI dashboard (total, CA, conversion, 7j, offres)
 *   GET  /api/bo/prospects/pipeline          — pipeline funnel by stage
 *   GET  /api/bo/prospects/filters           — dropdown options (sources, cities, stages)
 *   POST /api/bo/prospects                   — create new prospect
 *   PUT  /api/bo/prospects/:id               — update prospect
 *   DELETE /api/bo/prospects/:id             — delete prospect
 *
 * Pro features:
 *   • Server-side filter pipeline (source, statut, cycle, ville, search, date range)
 *   • French cycle names ↔ English stage codes mapping
 *   • Returns totalUnfiltered + diagnostics so UI can show "X exclus par filtres"
 *   • Single-pass aggregation for /stats (1 DB round-trip where possible)
 *   • Tunisian governorate awareness (city normalization)
 *   • CA prévisionnel computed from active pipeline (new→negotiation)
 *   • Taux de conversion = won / total
 *   • Nouveaux 7j = created in last 7 days
 *   • Offres en cours = stage in {proposal, negotiation}
 * -----------------------------------------------------------------------------
 */
import { Router } from 'express';
import mongoose from 'mongoose';
import { Prospect } from '../models/Prospect';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

const router = Router();

// ---------------------------------------------------------------------------
// French cycle ↔ English stage code mapping
// ---------------------------------------------------------------------------
const CYCLE_TO_STAGE: Record<string, string> = {
  'Nouveau':      'new',
  'Contacté':     'qualified',
  'Démo':         'qualified',
  'Devis':        'proposal',
  'Négociation':  'negotiation',
  'Gagné':        'won',
  'Perdu':        'lost',
};
const STAGE_TO_CYCLE: Record<string, string> = Object.entries(CYCLE_TO_STAGE)
  .reduce((acc, [fr, en]) => { if (!acc[en]) acc[en] = fr; return acc; }, {} as Record<string, string>);

const STAGE_LABELS_FR: Record<string, string> = {
  new: 'Nouveau', qualified: 'Contacté', proposal: 'Devis',
  negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu',
};

const STATUT_OFFRE_TO_QUERY: Record<string, any> = {
  'Avec offre':  { stage: { $in: ['proposal', 'negotiation', 'won'] } },
  'Sans offre':  { stage: { $in: ['new', 'qualified', 'lost'] } },
  'Qualifié':    { stage: 'qualified' },
};

const SOURCE_LABELS_FR: Record<string, string> = {
  'Site web': 'Site web', 'Manuel': 'Manuel', 'Manual': 'Manuel',
  'LinkedIn': 'LinkedIn', 'Referral': 'Referral', 'Salon': 'Salon',
  'Cold email': 'Email', 'Email': 'Email', 'Téléphone': 'Téléphone',
  'Facebook': 'Facebook', 'Formulaire': 'Formulaire',
};

// Tunisian governorates (mirrors candidatesStats.ts)
const TUNISIAN_CITIES: string[] = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul', 'Zaghouan',
  'Bizerte', 'Béja', 'Jendouba', 'Le Kef', 'Sousse', 'Monastir',
  'Mahdia', 'Sfax', 'Kairouan', 'Kasserine', 'Sidi Bouzid',
  'Gabès', 'Médenine', 'Tataouine', 'Gafsa', 'Tozeur', 'Kebili', 'Siliana',
];

// Normalize a city name to canonical Tunisian name (case-insensitive, accent-insensitive)
function normalizeCity(input: string): string | null {
  if (!input) return null;
  const lower = String(input).toLowerCase().trim();
  for (const c of TUNISIAN_CITIES) {
    if (c.toLowerCase() === lower) return c;
  }
  // Strip accents then compare
  const stripped = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const c of TUNISIAN_CITIES) {
    const cs = c.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (cs === stripped) return c;
  }
  return null; // Unknown city — caller can decide what to do
}

// ---------------------------------------------------------------------------
// Build MongoDB query from frontend filter params
// ---------------------------------------------------------------------------
interface BuildResult {
  query: any;
  diagnostics: {
    source?: string;
    statut?: string;
    cycle?: string;
    ville?: string;
    search?: string;
    filtersApplied: string[];
    totalFilters: number;
  };
}

function buildQuery(reqQuery: any): BuildResult {
  const q: any = {};
  const filtersApplied: string[] = [];
  const diag: any = { filtersApplied, totalFilters: 0 };

  // Source — match if source field contains the requested label (case-insensitive)
  if (reqQuery.source && reqQuery.source !== 'Toutes') {
    const src = String(reqQuery.source);
    q.source = { $regex: src, $options: 'i' };
    diag.source = src;
    filtersApplied.push(`Source: ${src}`);
  }

  // Statut offre — maps to stage combinations
  if (reqQuery.statut && reqQuery.statut !== 'Tous') {
    const sq = STATUT_OFFRE_TO_QUERY[reqQuery.statut];
    if (sq) {
      if (q.$and) q.$and.push(sq);
      else q.$and = [sq];
      diag.statut = reqQuery.statut;
      filtersApplied.push(`Statut: ${reqQuery.statut}`);
    }
  }

  // Cycle (French) → stage (English)
  if (reqQuery.cycle && reqQuery.cycle !== 'Tous') {
    const stageCode = CYCLE_TO_STAGE[reqQuery.cycle];
    if (stageCode) {
      // "Démo" maps to "qualified" but so does "Contacté" — when user selects "Démo"
      // specifically we treat it as qualified (no finer-grained stage exists in the model).
      if (q.$and) q.$and.push({ stage: stageCode });
      else q.$and = [{ stage: stageCode }];
      diag.cycle = reqQuery.cycle;
      filtersApplied.push(`Cycle: ${reqQuery.cycle}`);
    }
  }

  // Ville — case-insensitive regex match on city field
  if (reqQuery.ville && reqQuery.ville !== 'Toutes') {
    const ville = String(reqQuery.ville);
    q.city = { $regex: ville, $options: 'i' };
    diag.ville = ville;
    filtersApplied.push(`Ville: ${ville}`);
  }

  // Search — across name, company, email, phone
  if (reqQuery.search) {
    const escaped = String(reqQuery.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(escaped, 'i');
    q.$or = [
      { name: re }, { company: re }, { email: re }, { phone: re },
    ];
    diag.search = reqQuery.search;
    filtersApplied.push(`Recherche: "${reqQuery.search}"`);
  }

  // Date range — based on createdAt
  if (reqQuery.dateStart || reqQuery.dateEnd) {
    q.createdAt = {};
    if (reqQuery.dateStart) {
      const d = new Date(String(reqQuery.dateStart));
      if (!isNaN(d.getTime())) q.createdAt.$gte = d;
    }
    if (reqQuery.dateEnd) {
      const d = new Date(String(reqQuery.dateEnd));
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + 1); // inclusive end
        q.createdAt.$lt = d;
      }
    }
    filtersApplied.push(`Date: ${reqQuery.dateStart || '...'} → ${reqQuery.dateEnd || '...'}`);
  }

  diag.totalFilters = filtersApplied.length;
  return { query: q, diagnostics: diag };
}

// ---------------------------------------------------------------------------
// Enrich prospect doc with French-friendly fields for the frontend
// ---------------------------------------------------------------------------
function enrich(p: any): any {
  if (!p) return p;
  const stageCode = p.stage || 'new';
  const cycleFr = STAGE_LABELS_FR[stageCode] || 'Nouveau';
  const srcFr = SOURCE_LABELS_FR[p.source] || p.source || 'Manuel';
  // Split name into first/last if the model only has `name`
  const fullName = p.name || '';
  const spaceIdx = fullName.indexOf(' ');
  const firstName = spaceIdx > 0 ? fullName.substring(0, spaceIdx) : fullName;
  const lastName = spaceIdx > 0 ? fullName.substring(spaceIdx + 1) : '';
  return {
    ...p,
    id: p._id?.toString() || p.id,
    first_name: firstName,
    last_name: lastName,
    contact_name: fullName,
    cycle: cycleFr,
    cycle_fr: cycleFr,
    stage_code: stageCode,
    source_label: srcFr,
    ca_potential: p.value || 0,
    potential_revenue: p.value || 0,
    offer_label: p.nextAction || (p.value ? `${p.currency || 'EUR'} ${p.value}` : ''),
    next_action: p.nextAction || '',
    next_action_date: p.nextActionAt || null,
  };
}

// ---------------------------------------------------------------------------
// GET /api/bo/prospects/stats
// Returns all KPIs for the dashboard
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [total, byStage, totalValueAgg, new7j, newThisMonth, wonCount, offresEnCoursAgg] = await Promise.all([
      Prospect.countDocuments(),
      Prospect.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
      ]),
      Prospect.aggregate([{ $match: { stage: 'won' } }, { $group: { _id: null, total: { $sum: '$value' } } }]),
      Prospect.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Prospect.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Prospect.countDocuments({ stage: 'won' }),
      Prospect.countDocuments({ stage: { $in: ['proposal', 'negotiation'] } }),
    ]);

    const byStageMap: Record<string, { count: number; value: number }> = {};
    for (const s of byStage as any[]) byStageMap[s._id || 'unknown'] = { count: s.count, value: s.value };

    // CA prévisionnel = sum of value for active pipeline (new → negotiation, excludes won/lost)
    const caPrev =
      (byStageMap['new']?.value || 0) +
      (byStageMap['qualified']?.value || 0) +
      (byStageMap['proposal']?.value || 0) +
      (byStageMap['negotiation']?.value || 0);

    // Taux de conversion = won / total
    const tauxConv = total > 0 ? Math.round((wonCount / total) * 1000) / 10 : 0;

    // Previous-month stats for delta computation
    const lastMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
    const lastMonthEnd = startOfMonth;
    const [lastMonthNew, lastMonthWon] = await Promise.all([
      Prospect.countDocuments({ createdAt: { $gte: lastMonthStart, $lt: lastMonthEnd } }),
      Prospect.countDocuments({ stage: 'won', closedAt: { $gte: lastMonthStart, $lt: lastMonthEnd } }),
    ]);
    const newThisMonthDelta = newThisMonth - lastMonthNew;
    const tauxConvLastMonth = lastMonthNew > 0 ? Math.round((lastMonthWon / lastMonthNew) * 1000) / 10 : 0;
    const tauxConvDelta = Math.round((tauxConv - tauxConvLastMonth) * 10) / 10;

    // Count prospects in negotiation for "X en négociation" badge
    const inNegotiation = byStageMap['negotiation']?.count || 0;

    res.json({
      success: true,
      total_prospects: total,
      total: total,
      nouveau_7j: new7j,
      new_7d: new7j,
      new_this_month: newThisMonth,
      new_this_month_delta: newThisMonthDelta,
      ca_previsionnel: caPrev,
      ca_potentiel: caPrev,
      pipeline_value: caPrev,
      won_value: totalValueAgg[0]?.total || 0,
      taux_conversion: tauxConv,
      conversion_rate: tauxConv,
      conversion_delta: tauxConvDelta,
      offres_en_cours: offresEnCoursAgg,
      active_offers: offresEnCoursAgg,
      in_negotiation: inNegotiation,
      by_stage: byStageMap,
      stages: {
        new: byStageMap['new']?.count || 0,
        qualified: byStageMap['qualified']?.count || 0,
        proposal: byStageMap['proposal']?.count || 0,
        negotiation: byStageMap['negotiation']?.count || 0,
        won: byStageMap['won']?.count || 0,
        lost: byStageMap['lost']?.count || 0,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/prospects/pipeline
// ---------------------------------------------------------------------------
router.get(
  '/pipeline',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const STAGES = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
    const stages = await Prospect.aggregate([
      { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    ]);
    const stagesMap: Record<string, { count: number; value: number }> = {};
    for (const s of stages as any[]) stagesMap[s._id || 'new'] = { count: s.count, value: s.value };
    res.json({
      stages: STAGES.map((s) => ({
        id: s,
        code: s,
        name: STAGE_LABELS_FR[s] || s,
        count: stagesMap[s]?.count || 0,
        value: stagesMap[s]?.value || 0,
      })),
      total: STAGES.reduce((acc, s) => acc + (stagesMap[s]?.count || 0), 0),
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/prospects/filters — dropdown options
// ---------------------------------------------------------------------------
router.get(
  '/filters',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [sourcesAgg, citiesAgg] = await Promise.all([
      Prospect.aggregate([
        { $match: { source: { $exists: true, $ne: null } } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Prospect.aggregate([
        { $match: { city: { $exists: true, $nin: [null, ''] } } },
        { $group: { _id: '$city', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const sources = sourcesAgg.map((s: any) => ({
      label: SOURCE_LABELS_FR[s._id] || s._id,
      count: s.count,
    }));

    // For cities, normalize Tunisian names; merge counts if duplicates
    const cityMap: Record<string, number> = {};
    for (const c of citiesAgg as any[]) {
      const norm = normalizeCity(c._id) || c._id;
      cityMap[norm] = (cityMap[norm] || 0) + c.count;
    }
    const cities = Object.entries(cityMap)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      success: true,
      sources,
      cities,
      stages: [
        { code: 'new', label: 'Nouveau' },
        { code: 'qualified', label: 'Contacté' },
        { code: 'proposal', label: 'Devis' },
        { code: 'negotiation', label: 'Négociation' },
        { code: 'won', label: 'Gagné' },
        { code: 'lost', label: 'Perdu' },
      ],
      cycles: ['Nouveau', 'Contacté', 'Démo', 'Devis', 'Négociation', 'Gagné', 'Perdu'],
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/prospects — paginated list with server-side filters
// ---------------------------------------------------------------------------
router.get(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;

    const { query, diagnostics } = buildQuery(req.query);

    const [data, total, totalUnfiltered] = await Promise.all([
      Prospect.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Prospect.countDocuments(query),
      Prospect.countDocuments({}),
    ]);

    res.json({
      success: true,
      data: data.map(enrich),
      total,
      totalUnfiltered,
      page,
      limit,
      diagnostics,
      excludedCount: totalUnfiltered - total,
      totalPages: Math.ceil(total / limit),
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/bo/prospects — create
// ---------------------------------------------------------------------------
router.post(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body || {};

    // Build name from first_name + last_name if not provided directly
    let name = body.name;
    if (!name && (body.first_name || body.last_name)) {
      name = `${body.first_name || ''} ${body.last_name || ''}`.trim();
    }
    if (!name) throw new ApiError(400, 'Le nom est requis');

    // Normalize city if Tunisian
    const city = normalizeCity(body.city) || body.city || 'Tunis';

    // Map source label to canonical form
    let source = body.source || 'Site web';
    if (source && !SOURCE_LABELS_FR[source]) {
      // Find matching label
      const match = Object.entries(SOURCE_LABELS_FR).find(([, fr]) => fr === source);
      if (match) source = match[0];
    }

    // Map French cycle to English stage if needed
    let stage = body.stage || 'new';
    if (body.cycle && CYCLE_TO_STAGE[body.cycle]) {
      stage = CYCLE_TO_STAGE[body.cycle];
    }

    const created = await Prospect.create({
      name,
      email: body.email,
      phone: body.phone,
      company: body.company,
      city,
      source,
      stage,
      value: Number(body.value || body.ca_potential || 0),
      currency: body.currency || 'EUR',
      ownerName: body.ownerName,
      nextAction: body.nextAction || body.next_action,
      nextActionAt: body.nextActionAt || body.next_action_date,
      notes: body.notes,
    });

    res.status(201).json({ success: true, data: enrich(created.toObject()) });
  })
);

// ---------------------------------------------------------------------------
// PUT /api/bo/prospects/:id — update
// ---------------------------------------------------------------------------
router.put(
  '/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body || {};
    const update: any = {};
    const allowed = ['name', 'email', 'phone', 'company', 'city', 'source', 'stage', 'value', 'currency', 'ownerName', 'nextAction', 'nextActionAt', 'notes'];

    // Build name from first/last if needed
    if (body.name) update.name = body.name;
    else if (body.first_name || body.last_name) {
      update.name = `${body.first_name || ''} ${body.last_name || ''}`.trim();
    }

    for (const k of allowed) {
      if (body[k] !== undefined && k !== 'name') {
        update[k] = body[k];
      }
    }
    if (body.ca_potential !== undefined) update.value = Number(body.ca_potential);
    if (body.city) update.city = normalizeCity(body.city) || body.city;
    if (body.cycle && CYCLE_TO_STAGE[body.cycle]) update.stage = CYCLE_TO_STAGE[body.cycle];
    if (body.next_action) update.nextAction = body.next_action;
    if (body.next_action_date) update.nextActionAt = body.next_action_date;

    const updated = await Prospect.findByIdAndUpdate(req.params.id, { $set: update }, { new: true }).lean();
    if (!updated) throw new ApiError(404, 'Prospect introuvable');
    res.json({ success: true, data: enrich(updated) });
  })
);

// ---------------------------------------------------------------------------
// DELETE /api/bo/prospects/:id
// ---------------------------------------------------------------------------
router.delete(
  '/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const deleted = await Prospect.findByIdAndDelete(req.params.id);
    if (!deleted) throw new ApiError(404, 'Prospect introuvable');
    res.json({ success: true, id: req.params.id });
  })
);

export default router;
