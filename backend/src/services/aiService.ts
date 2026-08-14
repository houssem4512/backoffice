/**
 * aiService.ts — v2.0 — PROFESSIONAL ASSISTANT WITH TOOL CALLING
 * ---------------------------------------------------------------------------
 * Major upgrade: instead of guessing intent with regex, this version exposes
 * 18 tools to the LLM. When the user asks "combien de candidats à Tunis ?",
 * the LLM picks the `get_candidates_by_city` tool, the backend executes it
 * against MongoDB, returns the real count, and the LLM formulates the answer
 * with the real number.
 *
 * Two execution paths:
 *
 * 1. GROQ_API_KEY configured → llama-3.3-70b-versatile with native tool-calling
 *    (OpenAI-compatible /chat/completions API with `tools` parameter).
 *
 * 2. No API key → smart local router that detects intent from keywords and
 *    executes the same tools directly. Less eloquent but always correct.
 *
 * Tools implemented (all query MongoDB directly via raw driver — same pattern
 * as candidatesStats.ts so we read from the REAL `leads` collection, not the
 * Mongoose `candidates` collection which may be empty):
 *
 *   - get_total_candidates
 *   - get_candidates_by_city(city)
 *   - get_top_cities(limit)
 *   - get_candidates_by_language(language)
 *   - get_top_languages(limit)
 *   - get_candidates_by_status(status)
 *   - get_candidates_by_source(source)
 *   - get_recent_candidates(limit)
 *   - get_candidate_details(email?, phone?)
 *   - get_total_companies / get_active_companies
 *   - get_total_orders / get_orders_by_status(status)
 *   - get_total_revenue / get_pending_payments / get_late_payments
 *   - get_total_prospects / get_prospect_pipeline
 *   - get_dashboard_summary()
 *
 * Each tool returns a JSON object with the real numbers. The LLM uses those
 * numbers to phrase its answer.
 *
 * If you don't have GROQ_API_KEY, get a free one at https://console.groq.com
 * (it takes 30 seconds, no credit card needed).
 * ---------------------------------------------------------------------------
 */
import mongoose from 'mongoose';

const GROQ_API_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

export interface AiResult {
  response: string;
  actions?: string[];
  tools_used?: string[];
  data?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// Tunisian governorate lookup (mirrors candidatesStats.ts v7.3)
// ---------------------------------------------------------------------------
const TUNISIAN_CITIES: Record<number, string> = {
  1: 'Tunis', 2: 'Ariana', 3: 'Ben Arous', 4: 'Manouba',
  5: 'Nabeul', 6: 'Zaghouan', 7: 'Bizerte', 8: 'Béja',
  9: 'Jendouba', 10: 'Le Kef', 11: 'Sousse', 12: 'Monastir',
  13: 'Mahdia', 14: 'Sfax', 15: 'Kairouan', 16: 'Kasserine',
  17: 'Sidi Bouzid', 18: 'Gabès', 19: 'Médenine', 20: 'Tataouine',
  21: 'Gafsa', 22: 'Tozeur', 23: 'Kebili', 24: 'Silyana',
  25: 'Le Kef',
};

const CITY_NAME_TO_ID: Record<string, number> = Object.entries(TUNISIAN_CITIES)
  .reduce((acc, [id, name]) => {
    acc[name.toLowerCase()] = Number(id);
    return acc;
  }, {} as Record<string, number>);

function resolveCityId(input: string): number | null {
  if (!input) return null;
  const lower = input.toLowerCase().trim();
  // Direct name match
  if (CITY_NAME_TO_ID[lower] !== undefined) return CITY_NAME_TO_ID[lower];
  // Try without accents
  const stripped = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  for (const [name, id] of Object.entries(CITY_NAME_TO_ID)) {
    const nameStripped = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nameStripped === stripped) return id;
  }
  // Try numeric
  const num = Number(input);
  if (!isNaN(num) && TUNISIAN_CITIES[num]) return num;
  return null;
}

const LANGUAGES: Record<string, string> = {
  AR: 'Arabe', FR: 'Français', EN: 'Anglais', DE: 'Allemand',
  ES: 'Espagnol', IT: 'Italien', TU: 'Turc', PT: 'Portugais',
};

// ---------------------------------------------------------------------------
// Pick the right collection (same logic as candidatesStats.ts)
// ---------------------------------------------------------------------------
async function pickCollection(candidates: string[]): Promise<{ collection: any; name: string } | null> {
  const db: any = mongoose.connection.db;
  if (!db) return null;
  const all = await db.listCollections().toArray();
  const names = all.map((c: any) => c.name);
  for (const n of candidates) {
    if (names.includes(n)) {
      const cnt = await db.collection(n).countDocuments({}, { limit: 1 });
      if (cnt > 0) return { collection: db.collection(n), name: n };
    }
  }
  return null;
}

async function getLeadsCollection() {
  return pickCollection(['leads', 'candidats', 'candidates', 'contacts', 'persons', 'profiles', 'profils']);
}
async function getCompaniesCollection() {
  return pickCollection(['companies', 'clients', 'societes']);
}
async function getOrdersCollection() {
  return pickCollection(['orders', 'commandes']);
}
async function getPaymentsCollection() {
  return pickCollection(['payments', 'paiements']);
}
async function getProspectsCollection() {
  return pickCollection(['prospects', 'prospect']);
}

// ---------------------------------------------------------------------------
// TOOL DEFINITIONS (for Groq / OpenAI-compatible tool-calling API)
// ---------------------------------------------------------------------------
interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_total_candidates',
      description: "Get the total number of candidates/leads in the database. Use this for questions like 'combien de candidats avons-nous ?'",
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidates_by_city',
      description: "Count candidates in a specific city (Tunisian governorate). Use for 'combien de candidats à Tunis ?'. Tunisian cities include: Tunis, Ariana, Ben Arous, Manouba, Nabeul, Zaghouan, Bizerte, Béja, Jendouba, Le Kef, Sousse, Monastir, Mahdia, Sfax, Kairouan, Kasserine, Sidi Bouzid, Gabès, Médenine, Tataouine, Gafsa, Tozeur, Kebili, Silyana.",
      parameters: {
        type: 'object',
        properties: {
          city: { type: 'string', description: 'City name (e.g. Tunis, Sousse, Sfax). Accepts with/without accents.' },
        },
        required: ['city'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_cities',
      description: 'Get the top N cities by candidate count, with counts and percentages. Use for "top villes" or "répartition par ville".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of top cities to return (default 5, max 10)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidates_by_language',
      description: "Count candidates who speak a specific language. Use for 'combien de candidats francophones ?'. Language codes: AR (Arabic), FR (French), EN (English), DE (German), ES (Spanish), IT (Italian).",
      parameters: {
        type: 'object',
        properties: {
          language: { type: 'string', description: 'Language code (AR, FR, EN, DE, ES, IT) or full name (Arabe, Français, Anglais, Allemand, Espagnol, Italien)' },
        },
        required: ['language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_languages',
      description: 'Get top N most demanded languages with candidate counts. Use for "top langues" or "langues demandées".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of top languages (default 5)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidates_by_status',
      description: "Count candidates by lead stage. Use for 'combien de candidats livrés ?'. Statuses: new, qualified, interview, delivered, cancelled, unsubscribed.",
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'One of: new, qualified, interview, delivered, cancelled, unsubscribed' },
        },
        required: ['status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidates_by_source',
      description: "Count candidates by acquisition source. Use for 'combien de candidats du formulaire ?' or 'combien viennent de Facebook ?'.",
      parameters: {
        type: 'object',
        properties: {
          source: { type: 'string', description: "One of: 'formulaire' (site form), 'facebook' (FB import), 'import' (any import)" },
        },
        required: ['source'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_recent_candidates',
      description: 'Get the most recently created candidates. Use for "nouveaux candidats" or "derniers inscrits".',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of candidates to return (default 5, max 20)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_candidate_details',
      description: 'Look up a specific candidate by email OR phone. Returns their profile, city, status, languages. Use for "trouve le candidat sami@test.com".',
      parameters: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Email address (optional)' },
          phone: { type: 'string', description: 'Phone number (optional)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_total_companies',
      description: 'Get total number of companies/clients in the database.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_active_companies',
      description: 'Get count of active companies (status=Actif).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_total_orders',
      description: 'Get total number of orders/commandes in the database.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_orders_by_status',
      description: "Count orders by status. Use for 'combien de commandes livrées ?'. Statuses: Livrée, En cours, Confirmée, En attente, Annulée.",
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'One of: Livrée, En cours, Confirmée, En attente, Annulée' },
        },
        required: ['status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_total_revenue',
      description: 'Get total paid revenue (sum of all payments with status=Payé). Use for "chiffre d\'affaires" or "revenu encaissé".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_pending_payments',
      description: 'Get pending payments count and total amount. Use for "paiements en attente".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_late_payments',
      description: 'Get late/overdue payments count and total amount. Use for "paiements en retard".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_total_prospects',
      description: 'Get total number of prospects in the pipeline.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_prospect_pipeline',
      description: 'Get prospect counts grouped by pipeline stage: new, qualified, proposal, negotiation, won, lost.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_summary',
      description: 'Get a complete dashboard overview: total candidates, companies, orders, revenue, prospects — all in one call. Use for "résumé" or "vue d\'ensemble" or when user asks multiple things at once.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

// ---------------------------------------------------------------------------
// TOOL IMPLEMENTATIONS — each queries MongoDB directly
// ---------------------------------------------------------------------------
type ToolExecutor = (args: any) => Promise<any>;

const toolExecutors: Record<string, ToolExecutor> = {
  get_total_candidates: async () => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', total: 0 };
    const total = await col.collection.countDocuments({ deleted_at: null });
    return { total_candidates: total, collection: col.name };
  },

  get_candidates_by_city: async (args: { city: string }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', count: 0 };
    const cityId = resolveCityId(args.city);
    if (cityId === null) {
      return {
        error: `Ville inconnue: "${args.city}"`,
        hint: 'Villes supportées: Tunis, Ariana, Ben Arous, Manouba, Nabeul, Zaghouan, Bizerte, Béja, Jendouba, Le Kef, Sousse, Monastir, Mahdia, Sfax, Kairouan, Kasserine, Sidi Bouzid, Gabès, Médenine, Tataouine, Gafsa, Tozeur, Kebili, Silyana',
      };
    }
    const cityName = TUNISIAN_CITIES[cityId];
    const count = await col.collection.countDocuments({
      'location.city_id': cityId,
      deleted_at: null,
    });
    const total = await col.collection.countDocuments({ deleted_at: null });
    const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return {
      city: cityName,
      city_id: cityId,
      count,
      total_candidates: total,
      percentage,
    };
  },

  get_top_cities: async (args: { limit?: number }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', top_cities: [] };
    const limit = Math.min(10, Math.max(1, args.limit || 5));
    const grouped = await col.collection.aggregate([
      { $match: { 'location.city_id': { $exists: true, $ne: null, $nin: [null, ''] } } },
      { $group: { _id: '$location.city_id', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]).toArray();
    const total = await col.collection.countDocuments({ deleted_at: null });
    const top = grouped
      .filter((g: any) => g._id != null)
      .map((g: any) => ({
        city: TUNISIAN_CITIES[Number(g._id)] || `Ville #${g._id}`,
        city_id: g._id,
        count: g.count,
        percentage: total > 0 ? Math.round((g.count / total) * 1000) / 10 : 0,
      }));
    return { top_cities: top, total_candidates: total, collection: col.name };
  },

  get_candidates_by_language: async (args: { language: string }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', count: 0 };
    const langUpper = args.language.toUpperCase().substring(0, 2);
    const langLabel = LANGUAGES[langUpper];
    if (!langLabel) {
      return {
        error: `Langue inconnue: "${args.language}"`,
        hint: 'Codes supportés: AR (Arabe), FR (Français), EN (Anglais), DE (Allemand), ES (Espagnol), IT (Italien)',
      };
    }
    const count = await col.collection.countDocuments({
      $or: [
        { 'summary_metrics.primary_language_code': langUpper },
        { 'summary_metrics.secondary_language_code': langUpper },
        { 'summary_metrics.tertiary_language_code': langUpper },
      ],
      deleted_at: null,
    });
    const total = await col.collection.countDocuments({ deleted_at: null });
    const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return {
      language: langLabel,
      language_code: langUpper,
      count,
      total_candidates: total,
      percentage,
    };
  },

  get_top_languages: async (args: { limit?: number }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', top_languages: [] };
    const limit = Math.min(10, Math.max(1, args.limit || 5));
    const grouped = await col.collection.aggregate([
      { $project: { langs: ['$summary_metrics.primary_language_code', '$summary_metrics.secondary_language_code', '$summary_metrics.tertiary_language_code'] } },
      { $unwind: '$langs' },
      { $match: { langs: { $ne: null } } },
      { $group: { _id: '$langs', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]).toArray();
    const top = grouped.map((g: any) => ({
      language: LANGUAGES[g._id] || g._id,
      language_code: g._id,
      count: g.count,
    }));
    return { top_languages: top, collection: col.name };
  },

  get_candidates_by_status: async (args: { status: string }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', count: 0 };
    const stageMap: Record<string, number> = {
      new: 0, qualified: 1, interview: 3, delivered: 6, cancelled: -1, unsubscribed: 4,
    };
    const stage = stageMap[args.status.toLowerCase()];
    if (stage === undefined) {
      return {
        error: `Statut inconnu: "${args.status}"`,
        hint: 'Statuts supportés: new, qualified, interview, delivered, cancelled, unsubscribed',
      };
    }
    let query: any;
    if (args.status.toLowerCase() === 'delivered') {
      query = { lead_stage: { $gte: 6 }, deleted_at: null };
    } else if (args.status.toLowerCase() === 'cancelled') {
      query = { lead_stage: -1, deleted_at: null };
    } else if (args.status.toLowerCase() === 'unsubscribed') {
      query = { account_status: 4, deleted_at: null };
    } else {
      query = { lead_stage: stage, deleted_at: null };
    }
    const count = await col.collection.countDocuments(query);
    const total = await col.collection.countDocuments({ deleted_at: null });
    const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return { status: args.status, count, total_candidates: total, percentage };
  },

  get_candidates_by_source: async (args: { source: string }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', count: 0 };
    let query: any;
    let sourceLabel: string;
    const s = args.source.toLowerCase();
    if (s === 'formulaire' || s === 'form' || s === 'site' || s === 'web') {
      query = { channel: 1, deleted_at: null };
      sourceLabel = 'Formulaire site';
    } else if (s === 'facebook' || s === 'fb') {
      query = { channel: 2, deleted_at: null };
      sourceLabel = 'Facebook';
    } else if (s === 'import') {
      query = { imported: true, deleted_at: null };
      sourceLabel = 'Import';
    } else {
      return { error: `Source inconnue: "${args.source}"`, hint: "Sources: 'formulaire', 'facebook', 'import'" };
    }
    const count = await col.collection.countDocuments(query);
    const total = await col.collection.countDocuments({ deleted_at: null });
    const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return { source: sourceLabel, count, total_candidates: total, percentage };
  },

  get_recent_candidates: async (args: { limit?: number }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found', candidates: [] };
    const limit = Math.min(20, Math.max(1, args.limit || 5));
    const docs = await col.collection.find({ deleted_at: null })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
    const candidates = docs.map((d: any) => ({
      id: d.public_id || d._id?.toString(),
      name: `${d.first_name || ''} ${d.last_name || ''}`.trim() || 'N/A',
      email: d.email || d.email_normalized || null,
      phone: d.phone || null,
      city: d?.location?.city_id != null ? (TUNISIAN_CITIES[Number(d.location.city_id)] || `Ville #${d.location.city_id}`) : null,
      created_at: d.created_at,
    }));
    return { candidates, count: candidates.length, collection: col.name };
  },

  get_candidate_details: async (args: { email?: string; phone?: string }) => {
    const col = await getLeadsCollection();
    if (!col) return { error: 'No leads collection found' };
    const or: any[] = [];
    if (args.email) or.push({ email: args.email.toLowerCase() }, { email_normalized: args.email.toLowerCase() });
    if (args.phone) or.push({ phone: args.phone });
    if (or.length === 0) return { error: 'Provide email or phone' };
    const doc: any = await col.collection.findOne({ $or: or });
    if (!doc) return { error: 'Candidat non trouvé' };
    return {
      id: doc.public_id || doc._id?.toString(),
      name: `${doc.first_name || ''} ${doc.last_name || ''}`.trim(),
      email: doc.email || doc.email_normalized,
      phone: doc.phone,
      city: doc?.location?.city_id != null ? (TUNISIAN_CITIES[Number(doc.location.city_id)] || `Ville #${doc.location.city_id}`) : null,
      city_id: doc?.location?.city_id,
      age: doc.date_of_birth ? (new Date().getFullYear() - new Date(doc.date_of_birth).getFullYear()) : null,
      languages: [
        doc?.summary_metrics?.primary_language_code,
        doc?.summary_metrics?.secondary_language_code,
        doc?.summary_metrics?.tertiary_language_code,
      ].filter(Boolean),
      lead_stage: doc.lead_stage,
      account_status: doc.account_status,
      profile_completion: doc.profile_completion,
      created_at: doc.created_at,
    };
  },

  get_total_companies: async () => {
    const col = await getCompaniesCollection();
    if (!col) return { error: 'No companies collection found', total: 0 };
    const total = await col.collection.countDocuments({ deleted_at: null });
    return { total_companies: total, collection: col.name };
  },

  get_active_companies: async () => {
    const col = await getCompaniesCollection();
    if (!col) return { error: 'No companies collection found', active: 0 };
    const active = await col.collection.countDocuments({
      deleted_at: null,
      $or: [
        { account_status: 1 },
        { status: { $in: ['Actif', 'active', 'Active', 1] } },
        { record_status: 1 },
        { current_account_status: 'active' },
      ],
    });
    const total = await col.collection.countDocuments({ deleted_at: null });
    return { active_companies: active, total_companies: total, collection: col.name };
  },

  get_total_orders: async () => {
    const col = await getOrdersCollection();
    if (!col) return { error: 'No orders collection found', total: 0 };
    const total = await col.collection.countDocuments({ deleted_at: null });
    return { total_orders: total, collection: col.name };
  },

  get_orders_by_status: async (args: { status: string }) => {
    const col = await getOrdersCollection();
    if (!col) return { error: 'No orders collection found', count: 0 };
    const validStatuses = ['Livrée', 'En cours', 'Confirmée', 'En attente', 'Annulée'];
    if (!validStatuses.includes(args.status)) {
      return { error: `Statut inconnu: "${args.status}"`, hint: `Statuts supportés: ${validStatuses.join(', ')}` };
    }
    const count = await col.collection.countDocuments({
      status: args.status,
      deleted_at: null,
    });
    const total = await col.collection.countDocuments({ deleted_at: null });
    const percentage = total > 0 ? Math.round((count / total) * 1000) / 10 : 0;
    return { status: args.status, count, total_orders: total, percentage };
  },

  get_total_revenue: async () => {
    const col = await getPaymentsCollection();
    if (!col) return { error: 'No payments collection found', total_revenue: 0 };
    const agg = await col.collection.aggregate([
      { $match: { $or: [{ payment_status: 1 }, { payment_status: 'paid' }, { payment_status: 'Payé' }], deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
    ]).toArray();
    const total = agg[0]?.total || 0;
    const count = agg[0]?.count || 0;
    return {
      total_revenue: total,
      total_revenue_formatted: `${total.toLocaleString('fr-FR')} DT`,
      paid_payments_count: count,
      collection: col.name,
    };
  },

  get_pending_payments: async () => {
    const col = await getPaymentsCollection();
    if (!col) return { error: 'No payments collection found', pending_amount: 0 };
    const agg = await col.collection.aggregate([
      { $match: { $or: [{ payment_status: 2 }, { payment_status: 'pending' }, { payment_status: 'En attente' }], deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
    ]).toArray();
    const total = agg[0]?.total || 0;
    const count = agg[0]?.count || 0;
    return {
      pending_amount: total,
      pending_amount_formatted: `${total.toLocaleString('fr-FR')} DT`,
      pending_count: count,
    };
  },

  get_late_payments: async () => {
    const col = await getPaymentsCollection();
    if (!col) return { error: 'No payments collection found', late_amount: 0 };
    const agg = await col.collection.aggregate([
      { $match: { $or: [{ payment_status: 3 }, { payment_status: 'late' }, { payment_status: 'En retard' }], deleted_at: null } },
      { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
    ]).toArray();
    const total = agg[0]?.total || 0;
    const count = agg[0]?.count || 0;
    return {
      late_amount: total,
      late_amount_formatted: `${total.toLocaleString('fr-FR')} DT`,
      late_count: count,
    };
  },

  get_total_prospects: async () => {
    const col = await getProspectsCollection();
    if (!col) return { error: 'No prospects collection found', total: 0 };
    const total = await col.collection.countDocuments({});
    return { total_prospects: total, collection: col.name };
  },

  get_prospect_pipeline: async () => {
    const col = await getProspectsCollection();
    if (!col) return { error: 'No prospects collection found', pipeline: {} };
    const grouped = await col.collection.aggregate([
      { $group: { _id: '$stage', count: { $sum: 1 }, value: { $sum: '$value' } } },
    ]).toArray();
    const stages = ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
    const labels: Record<string, string> = {
      new: 'Nouveau', qualified: 'Qualifié', proposal: 'Proposition',
      negotiation: 'Négociation', won: 'Gagné', lost: 'Perdu',
    };
    const map: Record<string, any> = {};
    for (const s of grouped as any[]) {
      map[s._id || 'unknown'] = { count: s.count, value: s.value || 0 };
    }
    const pipeline = stages.map((s) => ({
      stage: s,
      label: labels[s],
      count: map[s]?.count || 0,
      value: map[s]?.value || 0,
    }));
    const totalValue = pipeline.reduce((sum, p) => sum + p.value, 0);
    return { pipeline, total_value: totalValue, total_value_formatted: `${totalValue.toLocaleString('fr-FR')} DT` };
  },

  get_dashboard_summary: async () => {
    const [leadsCol, companiesCol, ordersCol, paymentsCol, prospectsCol] = await Promise.all([
      getLeadsCollection(),
      getCompaniesCollection(),
      getOrdersCollection(),
      getPaymentsCollection(),
      getProspectsCollection(),
    ]);

    const [totalCandidates, totalCompanies, activeCompanies, totalOrders, revenueAgg, prospectsPipeline] = await Promise.all([
      leadsCol ? leadsCol.collection.countDocuments({ deleted_at: null }) : 0,
      companiesCol ? companiesCol.collection.countDocuments({ deleted_at: null }) : 0,
      companiesCol ? companiesCol.collection.countDocuments({
        deleted_at: null,
        $or: [
          { account_status: 1 },
          { status: { $in: ['Actif', 'active', 'Active', 1] } },
          { record_status: 1 },
          { current_account_status: 'active' },
        ],
      }) : 0,
      ordersCol ? ordersCol.collection.countDocuments({ deleted_at: null }) : 0,
      paymentsCol ? paymentsCol.collection.aggregate([
        { $match: { $or: [{ payment_status: 1 }, { payment_status: 'paid' }, { payment_status: 'Payé' }] } },
        { $group: { _id: null, total: { $sum: '$payment_amount' }, count: { $sum: 1 } } },
      ]).toArray() : [],
      prospectsCol ? prospectsCol.collection.aggregate([
        { $group: { _id: '$stage', count: { $sum: 1 } } },
      ]).toArray() : [],
    ]);

    const revenue = revenueAgg[0]?.total || 0;
    const totalProspects = prospectsPipeline.reduce((sum: number, s: any) => sum + (s.count || 0), 0);

    return {
      total_candidates: totalCandidates,
      total_companies: totalCompanies,
      active_companies: activeCompanies,
      total_orders: totalOrders,
      total_revenue: revenue,
      total_revenue_formatted: `${revenue.toLocaleString('fr-FR')} DT`,
      total_prospects: totalProspects,
      collections: {
        leads: leadsCol?.name || null,
        companies: companiesCol?.name || null,
        orders: ordersCol?.name || null,
        payments: paymentsCol?.name || null,
        prospects: prospectsCol?.name || null,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export async function chat(history: ChatTurn[], message: string): Promise<AiResult> {
  if (GROQ_API_KEY && GROQ_API_KEY !== 'your-groq-api-key-here') {
    try {
      return await chatWithGroqTools(history, message);
    } catch (err) {
      console.warn('[ai] Groq failed, falling back to local:', (err as Error).message);
    }
  }
  return chatWithLocalRouter(message);
}

// ---------------------------------------------------------------------------
// PATH 1: Groq + native tool-calling
// ---------------------------------------------------------------------------
async function chatWithGroqTools(history: ChatTurn[], message: string): Promise<AiResult> {
  const systemPrompt = `Tu es l'assistant IA professionnel du back-office CallCenterMatch (CCM), une plateforme CRM tunisienne de gestion de centres d'appels.

Tu réponds en français, de manière professionnelle, concise et factuelle. Tu as accès à des outils qui interrogent la base de données MongoDB en temps réel — UTILISE-LES dès que l'utilisateur demande une information chiffrée (combien, top, liste, etc.).

=== CONNAISSANCES PLATEFORME ===

Domaines que tu maîtrises:
1. **Candidats/Leads** — collection \`leads\` avec champs: first_name, last_name, email, phone, location.city_id (ID numérique 1-25), summary_metrics.{primary,secondary,tertiary}_language_code, lead_stage (0=new, 1=qualified, 3=interview, 6=delivered, -1=cancelled), account_status (4=unsubscribed), profile_completion (0-100), created_at, channel (1=formulaire, 2=facebook), imported (bool).
2. **Sociétés/Clients** — collection \`companies\` avec: company_name, status (Actif/Inactif), account_status, main_address.city.
3. **Commandes** — collection \`orders\` avec: order_number, client_name, amount, status (Livrée/En cours/Confirmée/En attente/Annulée), payment_status.
4. **Paiements** — collection \`payments\` avec: payment_amount, payment_status (1=Payé, 2=En attente, 3=En retard), payment_method, payment_declared_at.
5. **Prospects** — collection \`prospects\` avec: stage (new/qualified/proposal/negotiation/won/lost), value.
6. **Villes tunisiennes** — 24 gouvernorats avec IDs: 1=Tunis, 2=Ariana, 3=Ben Arous, 4=Manouba, 5=Nabeul, 6=Zaghouan, 7=Bizerte, 8=Béja, 9=Jendouba, 10=Le Kef, 11=Sousse, 12=Monastir, 13=Mahdia, 14=Sfax, 15=Kairouan, 16=Kasserine, 17=Sidi Bouzid, 18=Gabès, 19=Médenine, 20=Tataouine, 21=Gafsa, 22=Tozeur, 23=Kebili, 24=Silyana.
7. **Langues** — codes: AR (Arabe), FR (Français), EN (Anglais), DE (Allemand), ES (Espagnol), IT (Italien).

=== RÈGLES ===

1. **TOUJOURS utiliser les outils** pour obtenir des chiffres réels — ne JAMAIS inventer un nombre.
2. Répondre en français, ton professionnel et chaleureux.
3. Citer les chiffres précis avec leur source (ex: "5 candidats à Tunis, soit 35.7% du total de 14 candidats").
4. Si l'utilisateur demande une liste, la formater proprement avec puces ou tableau.
5. Si l'outil retourne une erreur (ville inconnue, etc.), expliquer poliment et proposer une alternative.
6. Pour les questions multiples, appeler plusieurs outils en parallèle.
7. Max 5 phrases sauf si l'utilisateur demande explicitement plus de détail.
8. Pour les salutations, présenter brièvement tes capacités (1-2 phrases) et proposer 3 exemples de questions.`;

  const toolsUsed: string[] = [];
  const toolResults: Record<string, any> = {};

  // Step 1: send user message + tools to Groq
  const messages: any[] = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
    { role: 'user', content: message },
  ];

  const maxIterations = 5;
  let finalReply = '';

  for (let iter = 0; iter < maxIterations; iter++) {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 1000,
      }),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Groq ${res.status}: ${txt.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const choice = data?.choices?.[0];
    const msg = choice?.message;

    if (!msg) throw new Error('Empty response from Groq');

    // If the model wants to call tools, execute them
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.tool_calls,
      });

      for (const tc of msg.tool_calls) {
        const toolName = tc.function.name;
        let args: any = {};
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
        console.log(`[ai] tool_call: ${toolName}(${JSON.stringify(args)})`);

        let result: any;
        try {
          const executor = toolExecutors[toolName];
          if (!executor) {
            result = { error: `Unknown tool: ${toolName}` };
          } else {
            result = await executor(args);
          }
        } catch (err: any) {
          result = { error: err.message };
        }

        toolsUsed.push(toolName);
        toolResults[toolName] = result;

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: toolName,
          content: JSON.stringify(result),
        });
      }
      // Continue the loop — the model will respond with either more tool calls
      // or the final natural-language answer.
      continue;
    }

    // No tool calls — this is the final answer
    finalReply = (msg.content || '').trim();
    break;
  }

  if (!finalReply) {
    finalReply = 'Je n\'ai pas pu formuler une réponse. Veuillez reformuler votre question.';
  }

  return {
    response: finalReply,
    actions: toolsUsed.map((t) => `tool:${t}`),
    tools_used: toolsUsed,
    data: toolResults,
  };
}

// ---------------------------------------------------------------------------
// PATH 2: Local smart router (no API key)
// ---------------------------------------------------------------------------
async function chatWithLocalRouter(message: string): Promise<AiResult> {
  const q = message.toLowerCase().trim();
  const toolsUsed: string[] = [];
  const toolResults: Record<string, any> = {};

  // Helper: run a tool and store its result
  async function runTool(name: string, args: any = {}) {
    const executor = toolExecutors[name];
    if (!executor) return { error: `unknown tool: ${name}` };
    const result = await executor(args);
    toolsUsed.push(name);
    toolResults[name] = result;
    return result;
  }

  // Greeting / help
  if (/^(bonjour|salut|hello|hi|hey|coucou|bonsoir)/i.test(q) || q === '' || q === 'aide' || q === 'help') {
    const summary = await runTool('get_dashboard_summary');
    return {
      response: `Bonjour ! Je suis l'assistant IA du back-office CCM. Voici l'état actuel de la plateforme :

• **${summary.total_candidates}** candidats en base
• **${summary.total_companies}** sociétés (${summary.active_companies} actives)
• **${summary.total_orders}** commandes
• **${summary.total_revenue_formatted}** de revenu encaissé
• **${summary.total_prospects}** prospects dans le pipeline

Vous pouvez me demander par exemple :
- "Combien de candidats à Tunis ?"
- "Top 5 des langues demandées"
- "Combien de candidats livrés ?"
- "Paiements en retard"
- "Résumé du pipeline prospects"
- "Derniers 5 candidats inscrits"
- "Trouve le candidat sami@test.com"

${GROQ_API_KEY ? '' : '💡 Configurez GROQ_API_KEY dans backend/.env (gratuit sur https://console.groq.com) pour activer le mode IA complet avec compréhension du langage naturel.'}`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Dashboard summary
  if (/\b(résumé|resume|vue d'ensemble|overview|dashboard|state|status global|bilan)/i.test(q)) {
    const s = await runTool('get_dashboard_summary');
    return {
      response: `📊 **Vue d'ensemble de la plateforme CCM**

• **Candidats** : ${s.total_candidates}
• **Sociétés** : ${s.total_companies} (${s.active_companies} actives)
• **Commandes** : ${s.total_orders}
• **Revenu encaissé** : ${s.total_revenue_formatted}
• **Prospects** : ${s.total_prospects}

Collections interrogées : ${Object.entries(s.collections).filter(([_, v]) => v).map(([k, v]) => `${k}=${v}`).join(', ')}`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Candidate by city
  if (/\bcandidat/.test(q) && (/\b(ville|à|a)\b/.test(q) || /\b(tunis|ariana|ben arous|manouba|nabeul|zaghouan|bizerte|béja|beja|jendouba|le kef|sousse|monastir|mahdia|sfax|kairouan|kasserine|sidi bouzid|gabès|gabes|médenine|medenine|tataouine|gafsa|tozeur|kebili|silyana)\b/i.test(q))) {
    const cityMatch = q.match(/\b(tunis|ariana|ben arous|manouba|nabeul|zaghouan|bizerte|béja|beja|jendouba|le kef|sousse|monastir|mahdia|sfax|kairouan|kasserine|sidi bouzid|gabès|gabes|médenine|medenine|tataouine|gafsa|tozeur|kebili|silyana)\b/i);
    if (cityMatch) {
      const r: any = await runTool('get_candidates_by_city', { city: cityMatch[1] });
      if (r.error) {
        return { response: `Désolé, ${r.error}.`, actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
      }
      return {
        response: `Il y a actuellement **${r.count} candidats** à **${r.city}** (city_id=${r.city_id}), soit ${r.percentage}% du total de ${r.total_candidates} candidats en base.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
  }

  // Top cities
  if (/\b(top|répartition|repartition).*(ville|cities)/i.test(q) || /\bville/i.test(q) && /\b(top|combien)/.test(q)) {
    const limitMatch = q.match(/top\s+(\d+)/);
    const limit = limitMatch ? Number(limitMatch[1]) : 5;
    const r: any = await runTool('get_top_cities', { limit });
    if (!r.top_cities || r.top_cities.length === 0) {
      return { response: 'Aucune donnée de ville disponible dans la base.', actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    const lines = r.top_cities.map((c: any, i: number) => `${i + 1}. **${c.city}** — ${c.count} candidats (${c.percentage}%)`);
    return {
      response: `📊 **Top ${r.top_cities.length} villes par candidats**\n\n${lines.join('\n')}\n\nTotal: ${r.total_candidates} candidats.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Candidate by language
  if (/\b(langue|francophone|francophones|anglophone|anglophones|arabophone|arabophones|germanophone|germanophones|hispanophone|hispanophones|italophone|italophones)\b/.test(q) || /\b(arabe|français|francais|anglais|allemand|espagnol|italien)\b/i.test(q) || /\b(ar|fr|en|de|es|it)\b/i.test(q)) {
    const langMap: Record<string, string> = {
      'arabe': 'AR', 'arabic': 'AR',
      'français': 'FR', 'francais': 'FR', 'french': 'FR', 'francophone': 'FR', 'francophones': 'FR',
      'anglais': 'EN', 'english': 'EN', 'anglophone': 'EN', 'anglophones': 'EN',
      'allemand': 'DE', 'german': 'DE', 'germanophone': 'DE', 'germanophones': 'DE',
      'espagnol': 'ES', 'spanish': 'ES', 'hispanophone': 'ES', 'hispanophones': 'ES',
      'italien': 'IT', 'italian': 'IT', 'italophone': 'IT', 'italophones': 'IT',
    };
    let langCode = '';
    for (const [k, v] of Object.entries(langMap)) {
      if (q.includes(k)) { langCode = v; break; }
    }
    if (langCode && /\b(candidat|profil|combien)/.test(q)) {
      const r: any = await runTool('get_candidates_by_language', { language: langCode });
      if (r.error) {
        return { response: `Désolé, ${r.error}.`, actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
      }
      return {
        response: `Il y a **${r.count} candidats ${r.language.toLowerCase()}s** (code ${r.language_code}), soit ${r.percentage}% du total de ${r.total_candidates} candidats.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
  }

  // Top languages
  if (/\b(top|demandée|demandees|demandee|répartition|repartition).*(langue)/i.test(q) || /\blangues demand/i.test(q) || /\btop (langue|langages)/i.test(q)) {
    const limitMatch = q.match(/top\s+(\d+)/);
    const limit = limitMatch ? Number(limitMatch[1]) : 5;
    const r: any = await runTool('get_top_languages', { limit });
    if (!r.top_languages || r.top_languages.length === 0) {
      return { response: 'Aucune donnée de langue disponible.', actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    const lines = r.top_languages.map((l: any, i: number) => `${i + 1}. **${l.language}** (${l.language_code}) — ${l.count} candidats`);
    return {
      response: `🗣️ **Top ${r.top_languages.length} langues demandées**\n\n${lines.join('\n')}`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Candidates by status (delivered, cancelled, unsubscribed, etc.)
  if (/\b(livré|livres|livrees|livrées?)\b/i.test(q) || /\b(annulé|annules|annulees|annulées?)\b/i.test(q) || /\b(désinscrit|desinscrit|unsubscribed)\b/i.test(q) || /\b(nouveau|new|qualifié|qualifie|interview|entretien)\b/i.test(q)) {
    let status = 'new';
    if (/\b(livré|livrés|livres|livrees|livrées)\b/i.test(q)) status = 'delivered';
    else if (/\b(annulé|annulés|annules|annulée|annulées|annulees)\b/i.test(q)) status = 'cancelled';
    else if (/\b(désinscrit|desinscrit|unsubscribed)\b/i.test(q)) status = 'unsubscribed';
    else if (/\b(qualifié|qualifie)\b/i.test(q)) status = 'qualified';
    else if (/\b(interview|entretien)\b/i.test(q)) status = 'interview';
    else if (/\b(nouveau|new)\b/i.test(q)) status = 'new';

    const r: any = await runTool('get_candidates_by_status', { status });
    if (r.error) {
      return { response: `Désolé, ${r.error}.`, actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    return {
      response: `Il y a **${r.count} candidats** avec le statut "${r.status}", soit ${r.percentage}% du total de ${r.total_candidates} candidats.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Candidates by source (formulaire, facebook, import)
  if (/\b(formulaire|form\b|site|web)/i.test(q) || /\b(facebook|fb)\b/i.test(q) || /\bimport\b/i.test(q)) {
    let source = 'formulaire';
    if (/\b(facebook|fb)\b/i.test(q)) source = 'facebook';
    else if (/\bimport\b/i.test(q)) source = 'import';

    const r: any = await runTool('get_candidates_by_source', { source });
    if (r.error) {
      return { response: `Désolé, ${r.error}.`, actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    return {
      response: `**${r.count} candidats** proviennent de la source "${r.source}", soit ${r.percentage}% du total de ${r.total_candidates} candidats.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Recent candidates
  if (/\b(dernier|recent|nouveaux|nouveau|récents|recents)/i.test(q) && /\bcandidat/i.test(q)) {
    const limitMatch = q.match(/(\d+)/);
    const limit = limitMatch ? Number(limitMatch[1]) : 5;
    const r: any = await runTool('get_recent_candidates', { limit });
    if (!r.candidates || r.candidates.length === 0) {
      return { response: 'Aucun candidat récent trouvé.', actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    const lines = r.candidates.map((c: any, i: number) => {
      const date = c.created_at ? new Date(c.created_at).toLocaleDateString('fr-FR') : 'N/A';
      return `${i + 1}. **${c.name}** — ${c.email || 'no email'} — ${c.city || 'ville inconnue'} — inscrit le ${date}`;
    });
    return {
      response: `📋 **${r.candidates.length} derniers candidats inscrits**\n\n${lines.join('\n')}`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Candidate details (email or phone)
  const emailMatch = q.match(/[\w.+-]+@[\w.-]+\.\w+/);
  const phoneMatch = q.match(/(\+?\d[\d\s.-]{7,})/);
  if (emailMatch || phoneMatch) {
    const args: any = {};
    if (emailMatch) args.email = emailMatch[0];
    if (phoneMatch) args.phone = phoneMatch[1];
    const r: any = await runTool('get_candidate_details', args);
    if (r.error) {
      return { response: `Candidat non trouvé.`, actions: toolsUsed.map((t) => `tool:${t}`), tools_used: toolsUsed, data: toolResults };
    }
    return {
      response: `👤 **Fiche candidat**

• **Nom** : ${r.name}
• **Email** : ${r.email || 'N/A'}
• **Téléphone** : ${r.phone || 'N/A'}
• **Ville** : ${r.city || 'N/A'} (city_id=${r.city_id ?? 'N/A'})
• **Âge** : ${r.age ?? 'N/A'} ans
• **Langues** : ${(r.languages || []).join(', ') || 'N/A'}
• **Lead stage** : ${r.lead_stage ?? 'N/A'}
• **Profile completion** : ${r.profile_completion ?? 'N/A'}%
• **Inscrit le** : ${r.created_at ? new Date(r.created_at).toLocaleDateString('fr-FR') : 'N/A'}`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Total candidates
  if (/\bcandidat/.test(q) && (/\b(combien|nombre|total)/.test(q))) {
    const r: any = await runTool('get_total_candidates');
    return {
      response: `La base contient actuellement **${r.total_candidates} candidats**. Vous pouvez affiner en précisant une ville (ex: "Combien à Tunis ?"), une langue ("Combien de francophones ?") ou un statut ("Combien de livrés ?").`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Companies / clients
  if (/\b(client|société|societe|company|companies)/.test(q)) {
    if (/\b(actif|active|actives)/i.test(q)) {
      const r: any = await runTool('get_active_companies');
      return {
        response: `Il y a **${r.active_companies} sociétés actives** sur un total de ${r.total_companies} sociétés en base.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    const r: any = await runTool('get_total_companies');
    return {
      response: `La base contient **${r.total_companies} sociétés**. Vous pouvez aussi demander "combien de sociétés actives ?".`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Orders
  if (/\b(commande|order|orders)/.test(q)) {
    if (/\b(livrée|livré|livres|livrees)/i.test(q)) {
      const r: any = await runTool('get_orders_by_status', { status: 'Livrée' });
      return {
        response: `Il y a **${r.count} commandes livrées**, soit ${r.percentage}% du total de ${r.total_orders} commandes.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    if (/\b(en cours)/i.test(q)) {
      const r: any = await runTool('get_orders_by_status', { status: 'En cours' });
      return {
        response: `Il y a **${r.count} commandes en cours**, soit ${r.percentage}% du total de ${r.total_orders} commandes.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    if (/\b(annulée|annulé|annulees|annules)/i.test(q)) {
      const r: any = await runTool('get_orders_by_status', { status: 'Annulée' });
      return {
        response: `Il y a **${r.count} commandes annulées**, soit ${r.percentage}% du total de ${r.total_orders} commandes.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    const r: any = await runTool('get_total_orders');
    return {
      response: `La base contient **${r.total_orders} commandes**. Vous pouvez affiner par statut: "combien de commandes livrées ?", "en cours ?", "annulées ?".`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Revenue
  if (/\b(revenu|chiffre|revenue|ca\b|encaissé|encaisse)/.test(q)) {
    const r: any = await runTool('get_total_revenue');
    return {
      response: `💰 Le revenu encaissé (paiements payés) s'élève à **${r.total_revenue_formatted}** sur ${r.paid_payments_count} transaction(s).`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Pending payments
  if (/\b(paiement|payment).*(attente|pending)/i.test(q) || /\battente.*paiement/i.test(q)) {
    const r: any = await runTool('get_pending_payments');
    return {
      response: `⏳ **${r.pending_count} paiement(s) en attente**, pour un total de **${r.pending_amount_formatted}**.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Late payments
  if (/\b(paiement|payment).*(retard|late|overdue)/i.test(q) || /\bretard.*paiement/i.test(q)) {
    const r: any = await runTool('get_late_payments');
    if (r.late_count === 0) {
      return {
        response: `✅ Aucun paiement en retard actuellement.`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    return {
      response: `⚠️ **${r.late_count} paiement(s) en retard**, pour un total de **${r.late_amount_formatted}**.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Prospects
  if (/\bprospect/.test(q)) {
    if (/\b(pipeline|étape|etape|stage)/i.test(q)) {
      const r: any = await runTool('get_prospect_pipeline');
      const lines = r.pipeline.map((p: any) => `• **${p.label}** : ${p.count} (${p.value.toLocaleString('fr-FR')} DT)`);
      return {
        response: `📊 **Pipeline prospects**\n\n${lines.join('\n')}\n\nValeur totale: ${r.total_value_formatted}`,
        actions: toolsUsed.map((t) => `tool:${t}`),
        tools_used: toolsUsed,
        data: toolResults,
      };
    }
    const r: any = await runTool('get_total_prospects');
    return {
      response: `Il y a **${r.total_prospects} prospects** dans le pipeline. Demandez "pipeline prospects" pour voir la répartition par étape.`,
      actions: toolsUsed.map((t) => `tool:${t}`),
      tools_used: toolsUsed,
      data: toolResults,
    };
  }

  // Fallback — show summary + help
  const summary = await runTool('get_dashboard_summary');
  return {
    response: `Je n'ai pas tout à fait compris votre demande. Voici un aperçu de la plateforme :

• **${summary.total_candidates}** candidats
• **${summary.total_companies}** sociétés (${summary.active_companies} actives)
• **${summary.total_orders}** commandes
• **${summary.total_revenue_formatted}** de revenu encaissé
• **${summary.total_prospects}** prospects

Vous pouvez me demander :
- "Combien de candidats à Tunis ?"
- "Top 5 langues demandées"
- "Combien de candidats livrés ?"
- "Paiements en retard"
- "Pipeline prospects"
- "Derniers 5 candidats"
- "Trouve candidat sami@test.com"`,
    actions: toolsUsed.map((t) => `tool:${t}`),
    tools_used: toolsUsed,
    data: toolResults,
  };
}
