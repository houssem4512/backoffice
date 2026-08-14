/**
 * api/client.ts — V12 (V11 + ADMIN TOOLS — pricing / matching / facebook imports)
 * ---------------------------------------------------------------------------
 * What's NEW in V12 (Outils Admin):
 *
 *   PRICING (9 methods)
 *     1.  getPricingConfig()                          — GET    /admin-tools/pricing
 *     2.  savePricingConfig(full)                    — PUT    /admin-tools/pricing
 *     3.  savePppModels(models, base, tva, timbre)   — PUT    /admin-tools/pricing/ppp
 *     4.  saveCoefficients(coefficients)             — PUT    /admin-tools/pricing/coefficients
 *     5.  saveValidityTranches(tranches)             — PUT    /admin-tools/pricing/validity
 *     6.  getPreferentialPrices()                     — GET    /admin-tools/pricing/preferential
 *     7.  addPreferentialPrice(data)                 — POST   /admin-tools/pricing/preferential
 *     8.  updatePreferentialPrice(index, data)        — PUT    /admin-tools/pricing/preferential/:index
 *     9.  deletePreferentialPrice(index)              — DELETE /admin-tools/pricing/preferential/:index
 *
 *   MATCHING (4 methods)
 *     10. getMatchingConfig()                         — GET    /admin-tools/matching
 *     11. saveMatchingConfig(fixedCriteria, levels)   — PUT    /admin-tools/matching
 *     12. updateMatchingLevel(level, data)            — PUT    /admin-tools/matching/levels/:level
 *     13. simulateMatching(lotSize, criteria)         — POST   /admin-tools/matching/simulate
 *
 *   FACEBOOK IMPORTS (6 methods)
 *     14. getFacebookImports()                         — GET    /admin-tools/imports
 *     15. getFacebookImport(id)                       — GET    /admin-tools/imports/:id
 *     16. uploadFacebookFile(name, text, size, fmt)   — POST   /admin-tools/imports/upload
 *     17. validateFacebookImport(id, columnMapping)   — POST   /admin-tools/imports/:id/validate
 *     18. cancelFacebookImport(id)                    — POST   /admin-tools/imports/:id/cancel
 *     19. deleteFacebookImport(id)                    — DELETE /admin-tools/imports/:id
 *
 * All 19 are null-safe (use EMPTY_* fallbacks), never throw, and log to console
 * on failure so the AdminTools page never crashes.
 *
 * What was NEW in V11 (CRM Marketing):
 *   1. getMarketingCampaigns()              — GET    /marketing/campaigns
 *   2. getMarketingCampaign(id)             — GET    /marketing/campaigns/:id
 *   3. createMarketingCampaign(data)        — POST   /marketing/campaigns
 *   4. updateMarketingCampaign(id, data)   — PATCH  /marketing/campaigns/:id
 *   5. deleteMarketingCampaign(id)          — DELETE /marketing/campaigns/:id
 *   6. EMPTY_MARKETING_STATS enriched with ALL aliases the Marketing page reads
 *      (totalBudget, budget_total, totalSpend, depenses_total, totalLeads,
 *       leads_total, cplBrut, cpl_brut, avgCPL, cplMoyenSegmente, cacMoyen,
 *       budgetUsagePct, byChannel, bySegment, bySource, bySourceCac)
 *
 * What was NEW in V10 (CRM Paiements):
 *   1. createPayment(data)         — POST   /payments
 *   2. updatePayment(id, data)     — PATCH  /payments/:id
 *   3. deletePayment(id)           — DELETE /payments/:id
 *   4. getPayment(id)              — GET    /payments/:id
 *   5. EMPTY_PAYMENT_STATS enriched with ALL aliases the Payments page reads
 *
 * What was NEW in V9 (CRM Commandes):
 *   1. createOrder(data)          — POST   /orders
 *   2. updateOrder(id, data)      — PATCH  /orders/:id
 *   3. deleteOrder(id)            — DELETE /orders/:id
 *   4. EMPTY_ORDER_STATS enriched with ALL aliases the Orders page reads
 *
 * What was NEW in V8 (CRM Prospects PRO):
 *   1. getProspects(page, limit, filtersOrStage) — accepts stage OR filters
 *   2. getProspectsFilterOptions()                — GET /prospects/filters
 *   3. getProspectsStats()                        — full KPI dashboard
 *   4. updateProspect(id, data)                   — PUT /prospects/:id
 *   5. deleteProspect(id)                         — DELETE /prospects/:id
 *   6. createCompany(data)                        — POST /companies
 *   7. deleteCompany(id)                          — DELETE /companies/:id
 * ---------------------------------------------------------------------------
// Hardcoded API URL — Vite will inline this in the build
const BASE = 'https://backoffice-mpa8.onrender.com/api/bo';
// Force the URL into the bundle (prevents dead code elimination)
if (typeof window !== 'undefined') {
  (window as any).__API_BASE__ = BASE;
}
const TOKEN_KEY = 'ccm_auth_token';

type ListShape<T> = {
  data: T[];
  total: number;
  totalUnfiltered?: number;
  excludedCount?: number;
  diagnostics?: Record<string, any>;
  page?: number;
  limit?: number;
};

// ---------------------------------------------------------------------------
// EMPTY STATS SHAPES — flat, matches what existing pages expect
// ---------------------------------------------------------------------------
const EMPTY_CANDIDATE_STATS_FLAT = {
  total_leads: 0,
  total_leads_this_month: 0,
  inscrits_formulaire: 0,
  importes_facebook: 0,
  desinscrits: 0,
  profils_locked: 0,
  profils_supprimes: 0,
  livres: 0,
  jamais_livres: 0,
  taux_livraison: 0,
  entretien_telephonique: 0,
  entretien_physique: 0,
  formation_j1: 0,
  integres_j7: 0,
  _source: 'fallback' as const,
  _collection: '',
  _debug: null as any,
};

const EMPTY_VILLE_STATS = {
  success: false,
  total_leads: 0,
  covered_by_top: 0,
  coverage_pct: 0,
  city_field: null as string | null,
  top_cities: [] as Array<{ ville: string; count: number; percentage: number }>,
  tried_fields: [] as any[],
  _source: 'fallback' as const,
};

const EMPTY_COMPANY_STATS = {
  total: 0, active: 0, inactive: 0, totalRevenue: 0, totalLeads: 0,
  _source: 'fallback' as const,
};

// ---------------------------------------------------------------------------
// PROSPECT STATS — full PRO v1.0 KPI shape
// All CRM Prospects dashboard KPIs default to 0 instead of fake "6.2M€" fallbacks
// ---------------------------------------------------------------------------
const EMPTY_PROSPECT_STATS = {
  // Legacy fields (kept for backward-compat with code that reads .total / .byStage / .conversionRate)
  total: 0,
  byStage: {} as Record<string, number>,
  conversionRate: 0,

  // PRO v1.0 — full KPI dashboard shape (mirrors backend /prospects/stats)
  total_prospects: 0,
  ca_previsionnel: 0,
  ca_potentiel: 0,
  pipeline_value: 0,
  won_value: 0,
  taux_conversion: 0,
  conversion_rate: 0,
  conversion_delta: 0,
  nouveau_7j: 0,
  new_7d: 0,
  new_this_month: 0,
  new_this_month_delta: 0,
  offres_en_cours: 0,
  active_offers: 0,
  in_negotiation: 0,
  by_stage: {} as Record<string, { count: number; value: number }>,
  stages: {
    new: 0, qualified: 0, proposal: 0, negotiation: 0, won: 0, lost: 0,
  } as Record<string, number>,
  _source: 'fallback' as const,
};

const EMPTY_ORDER_STATS = {
  // Counts
  total: 0,
  total_orders: 0,
  totalOrders: 0,
  pending: 0,
  en_cours: 0,
  inProgress: 0,
  completed: 0,
  livrees: 0,
  delivered: 0,
  confirmed: 0,
  confirme: 0,
  cancelled: 0,
  annulees: 0,
  canceled: 0,
  // Revenue
  totalRevenue: 0,
  total_revenue: 0,
  ca_total: 0,
  ca: 0,
  revenue: 0,
  // Items
  totalItems: 0,
  total_items: 0,
  totalQuantity: 0,
  total_quantity: 0,
  _source: 'fallback' as const,
};

const EMPTY_PAYMENT_STATS = {
  // Counts
  total: 0,
  total_commandes: 0,
  total_orders: 0,
  totalPayments: 0,
  total_payments: 0,
  paid: 0,
  payes: 0,
  pending: 0,
  en_attente: 0,
  enAttente: 0,
  en_retard: 0,
  enRetard: 0,
  late: 0,
  overdue: 0,
  failed: 0,
  impayes: 0,
  partiel: 0,
  partiels: 0,
  // Amounts
  totalAmount: 0,
  total_amount: 0,
  montant_paye: 0,
  paid_amount: 0,
  totalPaid: 0,
  total_paid: 0,
  pending_amount: 0,
  pendingAmount: 0,
  overdue_amount: 0,
  overdueAmount: 0,
  // Rates & averages
  taux_recouvrement: 0,
  recovery_rate: 0,
  delai_moyen: 0,
  avg_delay: 0,
  avg_payment_delay: 0,
  _source: 'fallback' as const,
};

const EMPTY_MARKETING_STATS = {
  // Legacy (kept for backward-compat)
  totalLeads: 0,
  totalSpend: 0,
  avgCPL: 0,
  byChannel: [] as any[],

  // V11 — enriched aliases the Marketing page reads (so nothing is ever undefined)
  totalBudget: 0,
  budget_total: 0,
  total_budget: 0,
  budgetTotal: 0,
  depenses_total: 0,
  total_spend: 0,
  totalSpent: 0,
  leads_total: 0,
  total_leads: 0,
  totalLeadsGenerated: 0,
  totalProspects: 0,
  total_prospects: 0,
  totalClients: 0,
  total_clients: 0,
  cplBrut: 0,
  cpl_brut: 0,
  avg_cpl: 0,
  cplMoyenSegmente: 0,
  cpl_moyen_segmente: 0,
  avg_segment_cpl: 0,
  cacMoyen: 0,
  cac_moyen: 0,
  avg_cac: 0,
  avgCac: 0,
  budgetUsagePct: 0,
  budget_usage_pct: 0,
  budget_usage_percentage: 0,
  bySegment: [] as any[],
  by_segment: [] as any[],
  bySource: [] as any[],
  by_source: [] as any[],
  bySourceCac: [] as any[],
  by_source_cac: [] as any[],
  recommendations: [] as any[],
  _source: 'fallback' as const,
};

const EMPTY_DASHBOARD_KPIS = {
  totalLeads: 0, totalRevenue: 0, totalClients: 0, conversionRate: 0,
  _source: 'fallback' as const,
};

// ---------------------------------------------------------------------------
// Default CRM dropdown options — used when /prospects/filters is unreachable
// (so the page still shows valid French cycles/stages even on a cold backend)
// ---------------------------------------------------------------------------
const DEFAULT_PROSPECT_FILTER_OPTIONS = {
  success: false as const,
  sources: [] as Array<{ label: string; count: number }>,
  cities: [] as Array<{ label: string; count: number }>,
  stages: [
    { code: 'new',         label: 'Nouveau'     },
    { code: 'qualified',   label: 'Contacté'    },
    { code: 'proposal',    label: 'Devis'       },
    { code: 'negotiation', label: 'Négociation' },
    { code: 'won',         label: 'Gagné'       },
    { code: 'lost',        label: 'Perdu'       },
  ],
  cycles: ['Nouveau', 'Contacté', 'Démo', 'Devis', 'Négociation', 'Gagné', 'Perdu'],
};

// ---------------------------------------------------------------------------
// V12 — EMPTY ADMIN-TOOLS SHAPES (returned when backend is unreachable
// or returns a malformed response, so the AdminTools page never crashes)
// ---------------------------------------------------------------------------

const EMPTY_PRICING_CONFIG = {
  key: 'main',
  ppp: {
    models: [] as Array<{ name: string; min: number; cadence: number; mult: number; conv: number }>,
    base: 180,
    tva: 19,
    timbre: 1,
  },
  languesRares: {
    models: [] as Array<{ category: string; credits: number; valueDT: number }>,
    tva: 19,
    timbre: 1,
  },
  coefficients: [] as Array<{ group: string; code?: string; label: string; value: number }>,
  validityTranches: [] as Array<{ days: number; tranches: number }>,
  preferentialPrices: [] as Array<{
    client: string; model: string; defaultCoef: number; newCoef: number;
    remise: number; type: 'À vie' | 'Ponctuelle'; orders: string;
  }>,
  _source: 'fallback' as const,
};

const EMPTY_MATCHING_CONFIG = {
  key: 'main',
  fixedCriteria: ['Langue', 'Genre', 'Expérience globale', 'Activité', 'Expérience Activité', 'Ville', 'Mode de travail'],
  levels: [] as Array<{
    level: string;
    niveauBadge: string;
    dateRange: { badge: string; label: string };
    cells: Record<string, 'OK' | 'KO' | 'ANY'>;
  }>,
  _source: 'fallback' as const,
};

const EMPTY_MATCHING_SIMULATION = {
  success: false as const,
  lotSize: 0,
  criteria: {} as Record<string, any>,
  totalCandidates: 0,
  matched: [] as any[],
  matchedCount: 0,
  byLevel: [] as Array<{ level: string; count: number; pct: number }>,
  levels: [] as Array<{ level: string; count: number; pct: number }>,
  summary: {
    totalCandidates: 0,
    matchedCount: 0,
    matchRate: 0,
    averageLevel: '—',
  },
  _source: 'fallback' as const,
};

const EMPTY_FACEBOOK_IMPORTS = [] as any[];
const EMPTY_FACEBOOK_IMPORT = {
  _id: '',
  fileName: '',
  fileSize: 0,
  format: 'csv',
  status: 'cancelled',
  rows: [] as any[],
  stats: { total: 0, valid: 0, invalid: 0, duplicates: 0 },
  createdAt: '',
  _source: 'fallback' as const,
};

const EMPTY_IMPORT_UPLOAD_RESULT = {
  success: false as const,
  importId: '',
  fileName: '',
  fileSize: 0,
  format: 'csv',
  totalRows: 0,
  preview: [] as any[],
  detectedColumns: [] as string[],
  columnMapping: {} as Record<string, string>,
  suggestedMapping: {} as Record<string, string>,
  duplicates: 0,
  errors: [] as string[],
  _source: 'fallback' as const,
};

const EMPTY_IMPORT_VALIDATE_RESULT = {
  success: false as const,
  importId: '',
  insertedCount: 0,
  duplicateCount: 0,
  errorCount: 0,
  errors: [] as string[],
  sampleInserted: [] as any[],
  _source: 'fallback' as const,
};

class ApiClient {
  private token: string | null = null;

  constructor() {
    try {
      this.token = localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }

  setToken(t: string) {
    this.token = t;
    try { localStorage.setItem(TOKEN_KEY, t); } catch {}
  }

  clearToken() {
    this.token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  hasToken() { return !!this.token; }

  /**
   * Wraps a promise. NEVER throws. On error:
   *   - Logs full error details (URL, status, body) to the browser console
   *   - Returns the typed `fallback` so the UI never crashes
   */
  private async safe<T>(p: Promise<T>, fallback: T, pathForLog = ''): Promise<T> {
    try {
      const v = await p;
      if (v === null || v === undefined) {
        console.warn(`[api] empty response from ${pathForLog || 'endpoint'} — using fallback`);
        return fallback;
      }
      return v;
    } catch (e: any) {
      console.group(`%c[api] request failed: ${pathForLog || 'endpoint'}`, 'color:#dc2626;font-weight:bold');
      console.warn('Error message:', e?.message || e);
      if (e?.status) console.warn('HTTP status:', e.status);
      if (e?.body) console.warn('Response body:', e.body);
      console.warn('Returning fallback:', fallback);
      console.groupEnd();
      return fallback;
    }
  }

  private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.headers && typeof opts.headers === 'object' && !(opts.headers as any).forEach) {
      Object.assign(headers, opts.headers);
    }
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const url = `${BASE}${path}`;
    let res: Response;
    try {
      res = await fetch(url, { ...opts, headers });
    } catch (networkErr: any) {
      const err: any = new Error(`Network error: ${networkErr?.message || 'fetch failed'}`);
      err.path = path;
      err.cause = networkErr;
      throw err;
    }

    const txt = await res.text();
    let json: any = null;
    if (txt) {
      try { json = JSON.parse(txt); } catch { json = { raw: txt }; }
    }

    if (!res.ok) {
      const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
      const err: any = new Error(msg);
      err.status = res.status;
      err.body = json || txt;
      err.path = path;
      throw err;
    }

    if (
      json &&
      Object.prototype.hasOwnProperty.call(json, 'data') &&
      json.data !== undefined &&
      !Object.prototype.hasOwnProperty.call(json, 'total') &&
      !Object.prototype.hasOwnProperty.call(json, 'page') &&
      !Object.prototype.hasOwnProperty.call(json, 'limit') &&
      // Don't unwrap if the response looks like a stats object (has success/top_cities/stats/etc.)
      // — those need to be returned whole so the caller sees tried_fields, debug info, etc.
      !Object.prototype.hasOwnProperty.call(json, 'success') &&
      !Object.prototype.hasOwnProperty.call(json, 'top_cities') &&
      !Object.prototype.hasOwnProperty.call(json, 'stats') &&
      !Object.prototype.hasOwnProperty.call(json, 'tried_fields') &&
      // Don't unwrap AI chat responses — they legitimately contain a `data` field
      // (tool results) alongside `response`, `tools_used`, `actions`.
      !Object.prototype.hasOwnProperty.call(json, 'response') &&
      !Object.prototype.hasOwnProperty.call(json, 'tools_used')
    ) {
      return json.data as T;
    }
    return json as T;
  }

  /* ---------------- AUTH (these throw — Login page needs the error) ---------------- */
  login = (email: string, password: string) =>
    this.request<{ token: string; user?: any }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

  getMe = () => this.request<any>('/auth/me');

  /* ---------------- DASHBOARD ---------------- */
  getDashboardKPIs = (period = '30d') =>
    this.safe(
      this.request<any>(`/dashboard/kpis?period=${encodeURIComponent(period)}`),
      EMPTY_DASHBOARD_KPIS,
      '/dashboard/kpis'
    );

  getDashboardActivity = (limit = 20) =>
    this.safe(
      this.request<any[]>(`/dashboard/activity?limit=${limit}`),
      [] as any[],
      '/dashboard/activity'
    );

  getRevenueChart = (period = 'monthly') =>
    this.safe(
      this.request<any[]>(`/dashboard/charts/revenue?period=${period}`),
      [] as any[],
      '/dashboard/charts/revenue'
    );

  getCandidatesByCity = () =>
    this.safe(
      this.request<any[]>('/dashboard/charts/candidates-by-city'),
      [] as any[],
      '/dashboard/charts/candidates-by-city'
    );

  getCandidatesByLanguage = () =>
    this.safe(
      this.request<any[]>('/dashboard/charts/candidates-by-language'),
      [] as any[],
      '/dashboard/charts/candidates-by-language'
    );

  /* ---------------- CANDIDATES ---------------- */
  getCandidates = (page = 1, limit = 20, filters: Record<string, any> = {}) => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== '' && v !== 'Tous' && v !== 'Toutes') qs.append(k, String(v));
    }
    return this.safe(
      this.request<ListShape<any>>(`/candidates?${qs.toString()}`),
      { data: [], total: 0 } as ListShape<any>,
      '/candidates'
    );
  };

  /**
   * Returns dynamic dropdown options from the DB so the Candidates page
   * shows REAL cities / languages / statuses instead of hardcoded
   * Paris/Lyon/Berlin that don't exist in the Tunisian context.
   *
   * v2: returns { cities, languages, statuses, sources, age_range,
   *               score_range, experience_options, last_activity_options, total }
   */
  getCandidatesFilterOptions = () =>
    this.safe(
      this.request<any>('/candidates/filters'),
      {
        success: false,
        total: 0,
        cities: [],
        languages: [],
        statuses: [],
        sources: [],
        age_range: { min: 18, max: 65 },
        score_range: { min: 0, max: 100 },
        experience_options: ['0-1 an', '1-3 ans', '3-5 ans', '5+ ans'],
        last_activity_options: ['< 7 jours', '7-30 jours', '30-90 jours', '> 90 jours'],
      } as any,
      '/candidates/filters'
    );

  /**
   * Returns candidate stats as a FLAT object (backward compatible).
   */
  getCandidatesStats = async () => {
    const response: any = await this.safe(
      this.request<any>('/candidates/stats'),
      { success: false, stats: EMPTY_CANDIDATE_STATS_FLAT, _source: 'fallback' },
      '/candidates/stats'
    );

    if (!response || response._source === 'fallback' || response.success === false) {
      console.warn('[api] getCandidatesStats: backend unreachable or returned success=false');
      return { ...EMPTY_CANDIDATE_STATS_FLAT };
    }

    const stats = response.stats || {};
    const percentages = response.percentages || {};

    return {
      total_leads: stats.total_leads ?? 0,
      total_leads_this_month: stats.total_leads_this_month ?? 0,
      inscrits_formulaire: stats.inscrits_formulaire ?? 0,
      importes_facebook: stats.importes_facebook ?? 0,
      desinscrits: stats.desinscrits ?? 0,
      profils_locked: stats.profils_locked ?? 0,
      profils_supprimes: stats.profils_supprimes ?? 0,
      livres: stats.livres ?? 0,
      jamais_livres: stats.jamais_livres ?? 0,
      taux_livraison: stats.taux_livraison ?? 0,
      entretien_telephonique: stats.entretien_telephonique ?? 0,
      entretien_physique: stats.entretien_physique ?? 0,
      formation_j1: stats.formation_j1 ?? 0,
      integres_j7: stats.integres_j7 ?? 0,
      pct_inscrits_formulaire: percentages.inscrits_formulaire ?? 0,
      pct_importes_facebook: percentages.importes_facebook ?? 0,
      pct_desinscrits: percentages.desinscrits ?? 0,
      _source: 'live' as const,
      _collection: response.collection || '',
      _debug: response.debug || null,
    };
  };

  /**
   * Real candidate counts grouped by city.
   * Calls GET /api/bo/candidates/stats-by-ville
   *
   * v7.1: also auto-fetches /candidates/inspect when:
   *   - the backend response is missing `tried_fields` (old deployed backend)
   *   - OR no city_field was found (so the dashboard can show the schema)
   *
   * Returns:
   *   { success, total_leads, covered_by_top, coverage_pct,
   *     city_field, top_cities: [{ville, count, percentage}],
   *     tried_fields: [{field, score, reason}],
   *     inspect_fields: [{field, coverage, types, sampleValues}] (fallback),
   *     _source }
   */
  getCandidatesByVille = async (limit = 10) => {
    const response: any = await this.safe(
      this.request<any>(`/candidates/stats-by-ville?limit=${limit}`),
      EMPTY_VILLE_STATS,
      '/candidates/stats-by-ville'
    );

    // Log raw response for debugging
    console.log('[api] /candidates/stats-by-ville response:', {
      success: response?.success,
      city_field: response?.city_field,
      top_cities_count: response?.top_cities?.length ?? 0,
      tried_fields_count: response?.tried_fields?.length ?? 0,
      _source: response?._source,
    });

    // If backend is too old OR no city was found, fetch /inspect to get the schema
    const needsInspectFallback =
      !response ||
      response._source === 'fallback' ||
      !Array.isArray(response.tried_fields) ||
      response.tried_fields.length === 0 ||
      (!response.city_field && (!response.top_cities || response.top_cities.length === 0));

    if (needsInspectFallback) {
      console.log('[api] No city found — fetching /candidates/inspect to show schema...');
      const inspect: any = await this.safe(
        this.request<any>('/candidates/inspect'),
        { success: false, error: 'inspect endpoint failed', fields: [], distinctValues: {} },
        '/candidates/inspect'
      );

      if (inspect && inspect.success && Array.isArray(inspect.fields)) {
        // Build a synthetic tried_fields list from inspect output so the
        // dashboard diagnostic panel has something to show.
        const synthTried = inspect.fields.map((f: any) => ({
          field: f.field,
          score: 0,
          reason: `types: ${(f.types || []).join('|')}, coverage: ${f.coverage || '?'}, samples: ${(f.sampleValues || []).slice(0, 3).join(' | ')}`,
        }));
        return {
          ...response,
          tried_fields: synthTried,
          inspect_fields: inspect.fields,
          inspect_sample: inspect.sampleDocument || null,
          _inspect: inspect,
        };
      }
    }

    return response;
  };

  /**
   * Calls /api/bo/candidates/inspect — returns the actual MongoDB schema.
   */
  getCandidatesInspect = () =>
    this.safe(
      this.request<any>('/candidates/inspect'),
      { success: false, error: 'inspect endpoint failed', fields: [], distinctValues: {} },
      '/candidates/inspect'
    );

  /* ---------------- COMPANIES (CLIENTS) ---------------- */
  getCompanies = (page = 1, limit = 20) =>
    this.safe(
      this.request<ListShape<any>>(`/companies?page=${page}&limit=${limit}`),
      { data: [], total: 0 } as ListShape<any>,
      '/companies'
    );

  getCompanyStats = () =>
    this.safe(
      this.request<any>('/companies/stats'),
      EMPTY_COMPANY_STATS,
      '/companies/stats'
    );

  updateCompany = (id: string, data: any) =>
    this.safe(
      this.request<any>(`/companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      {} as any,
      `/companies/${id} (PATCH)`
    );

  createCompany = (data: any) =>
    this.safe(
      this.request<any>(`/companies`, { method: 'POST', body: JSON.stringify(data) }),
      {} as any,
      `/companies (POST)`
    );

  deleteCompany = (id: string) =>
    this.safe(
      this.request<any>(`/companies/${id}`, { method: 'DELETE' }),
      {} as any,
      `/companies/${id} (DELETE)`
    );

  /* ======================================================================= */
  /* ==================== PROSPECTS — CRM PRO v1.0 ======================= */
  /* ======================================================================= */

  /**
   * GET /api/bo/prospects — paginated list with server-side filters.
   *
   * Accepts EITHER:
   *   - LEGACY: getProspects(page, limit, 'new')  — string stage filter
   *   - NEW:    getProspects(page, limit, { source, statut, cycle, ville,
   *                                       search, dateStart, dateEnd, ... })
   *
   * Backend returns:
   *   { success, data, total, totalUnfiltered, excludedCount,
   *     page, limit, diagnostics, totalPages }
   *
   * Each enriched prospect has both raw fields (name, email, stage, value, ...)
   * AND French-friendly aliases (contact_name, cycle, ca_potential,
   * next_action, source_label, ...) so the UI doesn't need to translate.
   */
  getProspects = (
    page = 1,
    limit = 20,
    filtersOrStage: Record<string, any> | string = {}
  ) => {
    const qs = new URLSearchParams({ page: String(page), limit: String(limit) });

    // Backward compat: 3rd arg can be a stage string (old API) OR a filters object (new API)
    const filters: Record<string, any> =
      typeof filtersOrStage === 'string'
        ? (filtersOrStage ? { stage: filtersOrStage } : {})
        : (filtersOrStage || {});

    for (const [k, v] of Object.entries(filters)) {
      if (
        v !== undefined &&
        v !== null &&
        v !== '' &&
        v !== 'Tous' &&
        v !== 'Toutes'
      ) {
        qs.append(k, String(v));
      }
    }

    return this.safe(
      this.request<ListShape<any>>(`/prospects?${qs.toString()}`),
      {
        data: [],
        total: 0,
        totalUnfiltered: 0,
        excludedCount: 0,
        diagnostics: { filtersApplied: [], totalFilters: 0 },
      } as ListShape<any>,
      '/prospects'
    );
  };

  /**
   * GET /api/bo/prospects/stats — full KPI dashboard.
   *
   * Returns a FLAT object that exposes BOTH:
   *   - Legacy fields (total, byStage, conversionRate) for old code paths
   *   - New PRO v1.0 fields (total_prospects, ca_previsionnel, taux_conversion,
   *     nouveau_7j, offres_en_cours, by_stage, stages, won_value, ...)
   *
   * On backend failure, returns EMPTY_PROSPECT_STATS (everything 0 — never fake).
   */
  getProspectsStats = async () => {
    const response: any = await this.safe(
      this.request<any>('/prospects/stats'),
      { success: false, ...EMPTY_PROSPECT_STATS },
      '/prospects/stats'
    );

    if (
      !response ||
      (response as any)._source === 'fallback' ||
      response.success === false
    ) {
      console.warn(
        '[api] getProspectsStats: backend unreachable or returned success=false — using empty stats'
      );
      return { ...EMPTY_PROSPECT_STATS };
    }

    // Backend returns the rich shape. Build legacy-compatible aliases
    // so old code that reads .total / .byStage / .conversionRate keeps working.
    const byStageLegacy: Record<string, number> = {};
    if (response.by_stage && typeof response.by_stage === 'object') {
      for (const [k, v] of Object.entries(response.by_stage)) {
        const val = v as any;
        byStageLegacy[k] =
          val && typeof val === 'object' && 'count' in val
            ? val.count
            : (typeof val === 'number' ? val : 0);
      }
    }

    return {
      ...EMPTY_PROSPECT_STATS,
      ...response,
      // Legacy aliases
      total: response.total ?? response.total_prospects ?? 0,
      byStage: byStageLegacy,
      conversionRate: response.conversion_rate ?? response.taux_conversion ?? 0,
      _source: 'live' as const,
    };
  };

  /**
   * GET /api/bo/prospects/pipeline — funnel grouped by stage.
   * Returns { stages: [{ code, name, count, value }], total }
   */
  getProspectPipeline = () =>
    this.safe(
      this.request<any>('/prospects/pipeline'),
      { stages: [], total: 0 } as any,
      '/prospects/pipeline'
    );

  /**
   * GET /api/bo/prospects/filters — dynamic dropdown options.
   *
   * Returns:
   *   { success, sources: [{label, count}], cities: [{label, count}],
   *     stages: [{code, label}], cycles: ['Nouveau', 'Contacté', ...] }
   *
   * On failure, returns hardcoded French defaults so the UI still renders.
   */
  getProspectsFilterOptions = () =>
    this.safe(
      this.request<any>('/prospects/filters'),
      DEFAULT_PROSPECT_FILTER_OPTIONS,
      '/prospects/filters'
    );

  /**
   * ALIAS: getProspectsFilters = getProspectsFilterOptions
   * (kept for backward-compat with Prospects.tsx that calls `api.getProspectsFilters()`)
   */
  getProspectsFilters = () =>
    this.getProspectsFilterOptions();

  /**
   * POST /api/bo/prospects — create a new prospect.
   * Body can use either English fields (name, stage, value, nextAction) OR
   * French aliases (first_name, last_name, cycle, ca_potential, next_action).
   * The backend normalizes both.
   */
  createProspect = (data: any) =>
    this.safe(
      this.request<any>('/prospects', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
      {} as any,
      '/prospects (POST)'
    );

  /**
   * PUT /api/bo/prospects/:id — update a prospect.
   * Same field normalization as POST (English OR French aliases both work).
   */
  updateProspect = (id: string, data: any) =>
    this.safe(
      this.request<any>(`/prospects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
      {} as any,
      `/prospects/${id} (PUT)`
    );

  /**
   * DELETE /api/bo/prospects/:id — delete a prospect.
   */
  deleteProspect = (id: string) =>
    this.safe(
      this.request<any>(`/prospects/${id}`, { method: 'DELETE' }),
      {} as any,
      `/prospects/${id} (DELETE)`
    );

  /* ---------------- ORDERS ----------------
   *
   * V9: full CRUD — getOrders, getOrderStats, getOrder, createOrder,
   *     updateOrder, deleteOrder.
   *
   * The Orders page (Commandes.tsx) reads these fields from getOrderStats():
   *   total / total_orders / totalOrders
   *   totalRevenue / total_revenue / ca_total / ca / revenue
   *   pending / en_cours / inProgress
   *   completed / livrees / delivered
   *   cancelled / annulees / canceled
   * All aliases are present in EMPTY_ORDER_STATS so none of them is ever
   * undefined (which would cause `Cannot read properties of undefined
   * (reading 'toString')` somewhere downstream).
   */
  getOrders = (page = 1, limit = 20) =>
    this.safe(
      this.request<ListShape<any>>(`/orders?page=${page}&limit=${limit}`),
      { data: [], total: 0 } as ListShape<any>,
      '/orders'
    );

  getOrderStats = () =>
    this.safe(
      this.request<any>('/orders/stats'),
      EMPTY_ORDER_STATS,
      '/orders/stats'
    );

  getOrder = (id: string) =>
    this.safe(
      this.request<any>(`/orders/${id}`),
      {} as any,
      `/orders/${id}`
    );

  /**
   * POST /api/bo/orders — create a new order.
   *
   * Body accepts either English fields (orderNumber, total, status, ...)
   * OR French aliases (order_number, montant, statut, ...).
   * The backend is expected to normalize both.
   *
   * Returns: the created order object (or `{}` on failure — never throws).
   */
  createOrder = (data: any) =>
    this.safe(
      this.request<any>(`/orders`, { method: 'POST', body: JSON.stringify(data) }),
      {} as any,
      `/orders (POST)`
    );

  /**
   * PATCH /api/bo/orders/:id — partial update.
   * Works with any subset of fields (e.g. { status: 'Livrée' }).
   */
  updateOrder = (id: string, data: any) =>
    this.safe(
      this.request<any>(`/orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      {} as any,
      `/orders/${id} (PATCH)`
    );

  /**
   * DELETE /api/bo/orders/:id — delete one order by id.
   */
  deleteOrder = (id: string) =>
    this.safe(
      this.request<any>(`/orders/${id}`, { method: 'DELETE' }),
      {} as any,
      `/orders/${id} (DELETE)`
    );

  /* ---------------- PAYMENTS ----------------
   *
   * V10: full CRUD — getPayments, getPaymentStats, getPayment, createPayment,
   *      updatePayment, deletePayment.
   *
   * The Payments page (Paiements.tsx) reads these fields from getPaymentStats():
   *   total / total_commandes / total_orders
   *   montant_paye / paid_amount / totalPaid / total_paid
   *   en_attente / pending_amount
   *   impayes / overdue_amount
   *   taux_recouvrement / recovery_rate
   *   delai_moyen / avg_delay
   * All aliases are present in EMPTY_PAYMENT_STATS so none of them is ever
   * undefined (which would cause `Cannot read properties of undefined
   * (reading 'toString')` somewhere downstream).
   */
  getPayments = (page = 1, limit = 20) =>
    this.safe(
      this.request<ListShape<any>>(`/payments?page=${page}&limit=${limit}`),
      { data: [], total: 0 } as ListShape<any>,
      '/payments'
    );

  getPaymentStats = () =>
    this.safe(
      this.request<any>('/payments/stats'),
      EMPTY_PAYMENT_STATS,
      '/payments/stats'
    );

  getPayment = (id: string) =>
    this.safe(
      this.request<any>(`/payments/${id}`),
      {} as any,
      `/payments/${id}`
    );

  /**
   * POST /api/bo/payments — record a new payment.
   *
   * Body accepts either English fields (orderNumber, paidAmount, paymentMethod, ...)
   * OR French aliases (order_number, paid_amount, payment_method, ...).
   * The backend is expected to normalize both.
   *
   * Returns: the created payment object (or `{}` on failure — never throws).
   */
  createPayment = (data: any) =>
    this.safe(
      this.request<any>(`/payments`, { method: 'POST', body: JSON.stringify(data) }),
      {} as any,
      `/payments (POST)`
    );

  /**
   * PATCH /api/bo/payments/:id — partial update.
   * Works with any subset of fields (e.g. { status: 'Payé' }).
   */
  updatePayment = (id: string, data: any) =>
    this.safe(
      this.request<any>(`/payments/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      {} as any,
      `/payments/${id} (PATCH)`
    );

  /**
   * DELETE /api/bo/payments/:id — delete one payment by id.
   */
  deletePayment = (id: string) =>
    this.safe(
      this.request<any>(`/payments/${id}`, { method: 'DELETE' }),
      {} as any,
      `/payments/${id} (DELETE)`
    );

  /* ---------------- USERS ---------------- */
  getUsers = (page = 1, limit = 20) =>
    this.safe(
      this.request<ListShape<any>>(`/users?page=${page}&limit=${limit}`),
      { data: [], total: 0 } as ListShape<any>,
      '/users'
    );

  /* ---------------- MARKETING ----------------
   *
   * V11: full CRUD — getMarketingCampaigns, getMarketingCampaign,
   *      createMarketingCampaign, updateMarketingCampaign, deleteMarketingCampaign.
   *
   * The Marketing page (Marketing.tsx) computes ALL KPIs locally from the
   * campaigns array (budget total, dépenses, CPL brut, CPL segmenté, CAC,
   * per-channel stats, per-segment stats, per-source stats, IA recommendations).
   * getMarketingCampaigns() is the primary data source.
   *
   * getMarketingStats() / getMarketingChannels() / getMarketingCPL() are kept
   * for backward-compat but the page no longer depends on them.
   */

  /**
   * GET /api/bo/marketing/campaigns — list all marketing campaigns.
   * Returns: ListShape<Campaign> or plain array (page handles both).
   * Fallback: empty array (page shows "Aucune campagne trouvée" but never crashes).
   */
  getMarketingCampaigns = (page = 1, limit = 100) =>
    this.safe(
      this.request<any>(`/marketing/campaigns?page=${page}&limit=${limit}`),
      { data: [], total: 0 } as any,
      '/marketing/campaigns'
    );

  /**
   * GET /api/bo/marketing/campaigns/:id — single campaign detail.
   */
  getMarketingCampaign = (id: string) =>
    this.safe(
      this.request<any>(`/marketing/campaigns/${id}`),
      {} as any,
      `/marketing/campaigns/${id}`
    );

  /**
   * POST /api/bo/marketing/campaigns — create a new campaign.
   * Body accepts either English (name, channel, budget, spend, leads, ...)
   * or French aliases (nom, canal, budget, depense, ...). Backend normalizes.
   */
  createMarketingCampaign = (data: any) =>
    this.safe(
      this.request<any>(`/marketing/campaigns`, { method: 'POST', body: JSON.stringify(data) }),
      {} as any,
      '/marketing/campaigns (POST)'
    );

  /**
   * PATCH /api/bo/marketing/campaigns/:id — partial update.
   */
  updateMarketingCampaign = (id: string, data: any) =>
    this.safe(
      this.request<any>(`/marketing/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      {} as any,
      `/marketing/campaigns/${id} (PATCH)`
    );

  /**
   * DELETE /api/bo/marketing/campaigns/:id — delete one campaign.
   */
  deleteMarketingCampaign = (id: string) =>
    this.safe(
      this.request<any>(`/marketing/campaigns/${id}`, { method: 'DELETE' }),
      {} as any,
      `/marketing/campaigns/${id} (DELETE)`
    );

  /* Legacy marketing endpoints (kept for backward-compat) */
  getMarketingStats = () =>
    this.safe(
      this.request<any>('/marketing/stats'),
      EMPTY_MARKETING_STATS,
      '/marketing/stats'
    );

  getMarketingChannels = () =>
    this.safe(
      this.request<any[]>('/marketing/channels'),
      [] as any[],
      '/marketing/channels'
    );

  getMarketingCPL = () =>
    this.safe(
      this.request<any>('/marketing/cpl'),
      { avgCPL: 0, byChannel: [] } as any,
      '/marketing/cpl'
    );

  /* ---------------- ANALYTICS ---------------- */
  getProfitability = () =>
    this.safe(
      this.request<any>('/analytics/profitability'),
      { revenue: 0, costs: 0, profit: 0, margin: 0 } as any,
      '/analytics/profitability'
    );

  getMatchingStats = () =>
    this.safe(
      this.request<any>('/analytics/matching'),
      { totalMatches: 0, successRate: 0, byStage: {} } as any,
      '/analytics/matching'
    );

  getSignupTrends = () =>
    this.safe(
      this.request<any[]>('/analytics/signups'),
      [] as any[],
      '/analytics/signups'
    );

  /* ---------------- AI ASSISTANT ---------------- */
  aiChat = (messages: any[], message: string) =>
    this.safe(
      this.request<{ response: string; actions?: string[] }>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({ messages, message }),
      }),
      {
        response: "Désolé, le service IA est momentanément indisponible. Vérifiez que le backend tourne et que la clé GROQ_API_KEY est configurée.",
        actions: [] as string[],
      },
      '/ai/chat'
    );

  /* ======================================================================= */
  /* ============== V12 — ADMIN TOOLS (pricing / matching / imports) ====== */
  /* ======================================================================= */
  /* All 19 methods are null-safe (use EMPTY_* fallbacks declared at the top
   * of this file). They NEVER throw — on failure they return a safe default
   * and log the error to the browser console, so the AdminTools page can
   * keep rendering even if the backend is partially broken.
   */

  /* ----------- PRICING (9 methods) ----------- */

  /**
   * GET /api/bo/admin-tools/pricing
   * Returns the singleton pricing config (auto-creates defaults if missing).
   */
  getPricingConfig = () =>
    this.safe(
      this.request<any>('/admin-tools/pricing'),
      EMPTY_PRICING_CONFIG,
      '/admin-tools/pricing'
    );

  /**
   * PUT /api/bo/admin-tools/pricing
   * Save the FULL pricing config (ppp, languesRares, coefficients,
   * validityTranches, preferentialPrices). Upserts on key='main'.
   */
  savePricingConfig = (full: any) =>
    this.safe(
      this.request<any>('/admin-tools/pricing', {
        method: 'PUT',
        body: JSON.stringify(full),
      }),
      {} as any,
      '/admin-tools/pricing (PUT)'
    );

  /**
   * PUT /api/bo/admin-tools/pricing/ppp
   * Save just the PPP block (models[] + base + tva + timbre).
   * Helper for the AdminTools "Save PPP" button.
   */
  savePppModels = (
    models: any[],
    base: number,
    tva: number,
    timbre: number
  ) =>
    this.safe(
      this.request<any>('/admin-tools/pricing/ppp', {
        method: 'PUT',
        body: JSON.stringify({ models, base, tva, timbre }),
      }),
      {} as any,
      '/admin-tools/pricing/ppp (PUT)'
    );

  /**
   * PUT /api/bo/admin-tools/pricing/coefficients
   * Save the entire coefficients[] array (langue / experience / activite /
   * operation / ville / genre groups).
   */
  saveCoefficients = (coefficients: any[]) =>
    this.safe(
      this.request<any>('/admin-tools/pricing/coefficients', {
        method: 'PUT',
        body: JSON.stringify({ coefficients }),
      }),
      {} as any,
      '/admin-tools/pricing/coefficients (PUT)'
    );

  /**
   * PUT /api/bo/admin-tools/pricing/validity
   * Save the validityTranches[] array ({ days, tranches } entries).
   */
  saveValidityTranches = (tranches: any[]) =>
    this.safe(
      this.request<any>('/admin-tools/pricing/validity', {
        method: 'PUT',
        body: JSON.stringify({ validityTranches: tranches }),
      }),
      {} as any,
      '/admin-tools/pricing/validity (PUT)'
    );

  /**
   * GET /api/bo/admin-tools/pricing/preferential
   * Returns just the preferentialPrices[] array (lighter than getPricingConfig
   * if the page only needs that block).
   */
  getPreferentialPrices = () =>
    this.safe(
      this.request<any>('/admin-tools/pricing/preferential'),
      { preferentialPrices: [] } as any,
      '/admin-tools/pricing/preferential'
    );

  /**
   * POST /api/bo/admin-tools/pricing/preferential
   * Append a new preferential price entry. Body shape:
   *   { client, model, defaultCoef, newCoef, remise, type: 'À vie'|'Ponctuelle', orders }
   */
  addPreferentialPrice = (data: any) =>
    this.safe(
      this.request<any>('/admin-tools/pricing/preferential', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
      {} as any,
      '/admin-tools/pricing/preferential (POST)'
    );

  /**
   * PUT /api/bo/admin-tools/pricing/preferential/:index
   * Update one preferential price by array index.
   */
  updatePreferentialPrice = (index: number, data: any) =>
    this.safe(
      this.request<any>(`/admin-tools/pricing/preferential/${index}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
      {} as any,
      `/admin-tools/pricing/preferential/${index} (PUT)`
    );

  /**
   * DELETE /api/bo/admin-tools/pricing/preferential/:index
   * Remove one preferential price by array index.
   */
  deletePreferentialPrice = (index: number) =>
    this.safe(
      this.request<any>(`/admin-tools/pricing/preferential/${index}`, {
        method: 'DELETE',
      }),
      {} as any,
      `/admin-tools/pricing/preferential/${index} (DELETE)`
    );

  /* ----------- MATCHING (4 methods) ----------- */

  /**
   * GET /api/bo/admin-tools/matching
   * Returns the singleton matching config (fixedCriteria + 9 levels).
   */
  getMatchingConfig = () =>
    this.safe(
      this.request<any>('/admin-tools/matching'),
      EMPTY_MATCHING_CONFIG,
      '/admin-tools/matching'
    );

  /**
   * PUT /api/bo/admin-tools/matching
   * Save BOTH the fixedCriteria[] AND the levels[] (N1..N9).
   * Helper for the AdminTools "Save Matching" button.
   */
  saveMatchingConfig = (fixedCriteria: string[], levels: any[]) =>
    this.safe(
      this.request<any>('/admin-tools/matching', {
        method: 'PUT',
        body: JSON.stringify({ fixedCriteria, levels }),
      }),
      {} as any,
      '/admin-tools/matching (PUT)'
    );

  /**
   * PUT /api/bo/admin-tools/matching/levels/:level
   * Update ONE matching level by its code (e.g. 'N1'..'N9').
   * Body: the full level object { level, niveauBadge, dateRange, cells }.
   */
  updateMatchingLevel = (level: string, data: any) =>
    this.safe(
      this.request<any>(`/admin-tools/matching/levels/${encodeURIComponent(level)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
      {} as any,
      `/admin-tools/matching/levels/${level} (PUT)`
    );

  /**
   * POST /api/bo/admin-tools/matching/simulate
   * Run a real simulation against the `candidates` collection.
   * Body: { lotSize: number, criteria: Record<string, any> }
   * Returns: { success, lotSize, criteria, totalCandidates, matched, matchedCount,
   *            byLevel: [{ level, count, pct }], summary }
   *
   * On failure returns EMPTY_MATCHING_SIMULATION (all zeros) — the page
   * shows "0 candidats matchés" instead of crashing.
   */
  simulateMatching = (lotSize: number, criteria: Record<string, any>) =>
    this.safe(
      this.request<any>('/admin-tools/matching/simulate', {
        method: 'POST',
        body: JSON.stringify({ lotSize, criteria }),
      }),
      EMPTY_MATCHING_SIMULATION,
      '/admin-tools/matching/simulate'
    );

  /* ----------- FACEBOOK IMPORTS (6 methods) ----------- */

  /**
   * GET /api/bo/admin-tools/imports
   * Returns all import history records (newest first).
   * Each record has: { _id, fileName, fileSize, format, status,
   *                    rows[], stats: { total, valid, invalid, duplicates },
   *                    createdAt }
   */
  getFacebookImports = () =>
    this.safe(
      this.request<any>('/admin-tools/imports'),
      EMPTY_FACEBOOK_IMPORTS as any,
      '/admin-tools/imports'
    );

  /**
   * GET /api/bo/admin-tools/imports/:id
   * Returns a single import record by its _id (for the preview / validate page).
   */
  getFacebookImport = (id: string) =>
    this.safe(
      this.request<any>(`/admin-tools/imports/${id}`),
      EMPTY_FACEBOOK_IMPORT as any,
      `/admin-tools/imports/${id}`
    );

  /**
   * POST /api/bo/admin-tools/imports/upload
   * Upload a Facebook leads export (CSV or XLSX-as-text) to the backend.
   * The backend parses the file, dedups against existing candidates by
   * email/phone, and returns a preview + suggested column mapping.
   *
   * Body: { fileName, fileContent (text), fileSize, format: 'csv'|'xlsx' }
   * Returns: { success, importId, fileName, fileSize, format, totalRows,
   *            preview: [...first 10 rows], detectedColumns: [...],
   *            columnMapping / suggestedMapping: {...}, duplicates, errors }
   */
  uploadFacebookFile = (
    fileName: string,
    fileContent: string,
    fileSize: number,
    format: 'csv' | 'xlsx' = 'csv'
  ) =>
    this.safe(
      this.request<any>('/admin-tools/imports/upload', {
        method: 'POST',
        body: JSON.stringify({ fileName, fileContent, fileSize, format }),
      }),
      EMPTY_IMPORT_UPLOAD_RESULT as any,
      '/admin-tools/imports/upload'
    );

  /**
   * POST /api/bo/admin-tools/imports/:id/validate
   * Finalize an upload: insert all valid rows into the `candidates` collection
   * with source='Facebook' and the user-supplied column mapping.
   *
   * Body: { columnMapping: Record<string, string> }
   *   e.g. { 'full_name': 'nom', 'email_address': 'email', 'phone_number': 'tel' }
   * Returns: { success, importId, insertedCount, duplicateCount, errorCount,
   *            errors: [...], sampleInserted: [...first 5 inserted docs] }
   */
  validateFacebookImport = (id: string, columnMapping: Record<string, string>) =>
    this.safe(
      this.request<any>(`/admin-tools/imports/${id}/validate`, {
        method: 'POST',
        body: JSON.stringify({ columnMapping }),
      }),
      EMPTY_IMPORT_VALIDATE_RESULT as any,
      `/admin-tools/imports/${id}/validate`
    );

  /**
   * POST /api/bo/admin-tools/imports/:id/cancel
   * Mark an import as 'cancelled' (no rows inserted; the upload record stays
   * in the DB for audit but is flagged cancelled).
   */
  cancelFacebookImport = (id: string) =>
    this.safe(
      this.request<any>(`/admin-tools/imports/${id}/cancel`, {
        method: 'POST',
      }),
      {} as any,
      `/admin-tools/imports/${id}/cancel`
    );

  /**
   * DELETE /api/bo/admin-tools/imports/:id
   * Hard-delete one import record (and all its rows). Does NOT delete any
   * candidates that were already inserted by a previous /validate call —
   * only the import audit record is removed.
   */
  deleteFacebookImport = (id: string) =>
    this.safe(
      this.request<any>(`/admin-tools/imports/${id}`, { method: 'DELETE' }),
      {} as any,
      `/admin-tools/imports/${id} (DELETE)`
    );
}

export const api = new ApiClient();

