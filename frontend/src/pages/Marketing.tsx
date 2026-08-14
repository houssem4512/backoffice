import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp, RefreshCw, Search, Eye, Target, Building2,
  Sparkles, Lightbulb, PieChart, BarChart3, Filter, Plus,
  FileSpreadsheet, FileText, AlertCircle, ArrowUpDown,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { fmtMoney, fmtNum, fmtDate } from '../utils/format';

// ===========================================================================
// CONSTANTS
// ===========================================================================
type Period = 'today' | '7d' | '30d' | '90d' | 'perso';

const PERIODS: { value: Period; label: string; days: number }[] = [
  { value: 'today', label: "Aujourd'hui", days: 1 },
  { value: '7d', label: '7j', days: 7 },
  { value: '30d', label: '30j', days: 30 },
  { value: '90d', label: '90j', days: 90 },
  { value: 'perso', label: 'Perso', days: 0 },
];

const CANDIDAT_CHANNELS = ['Facebook', 'Google', 'TikTok', 'Emailing', 'Affiliation', 'Créations'];
const PROSPECT_CHANNELS = ['LinkedIn', 'Emailing B2B', 'Événements', 'Créations B2B'];

const SEGMENTS = ['Exp. 0-6 mois', 'Exp. 6-12 mois', 'Exp. 1-3 ans', 'Exp. 3-5 ans', 'Exp. 5 ans+'];
const LANGUAGES = ['Français', 'Arabe', 'Anglais'];
const CITIES = ['Tunis', 'Sfax', 'Sousse', 'Ariana', 'Manouba', 'Monastir', 'Bizerte'];
const GENDERS = ['Homme', 'Femme'];

// ===========================================================================
// NULL-SAFE HELPERS — none of these ever throw
// ===========================================================================

function safeStr(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return String(v);
}

function safeLower(v: any): string {
  return safeStr(v).toLowerCase();
}

function pickAny(...vals: any[]): any {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (typeof v === 'number' && Number.isNaN(v)) continue;
    return v;
  }
  return undefined;
}

function pickNum(...vals: any[]): number | undefined {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    const n = typeof v === 'string' ? parseFloat(v.replace(/[^\d.-]/g, '')) : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pickMoney(...vals: any[]): number {
  for (const v of vals) {
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
      const cleaned = v.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

// ===========================================================================
// FIELD NORMALIZER — accepts whatever shape the backend returns
// ===========================================================================

function normalizeCampaign(raw: any, idx = 0): any {
  if (!raw || typeof raw !== 'object') return null;

  const campaign_id = pickAny(raw.campaign_id, raw.campaignId, raw.id, raw._id);
  const campaign_reference = pickAny(raw.campaign_reference, raw.campaignReference, raw.reference, raw.ref);
  const name = pickAny(raw.name, raw.campaign_name, raw.campaignName, raw.title, raw.label, raw.nom);

  let channel = pickAny(raw.channel, raw.canal, raw.platform, raw.source_channel, raw.sourceChannel);
  if (!channel) {
    const src = safeLower(raw.source);
    if (src.includes('facebook')) channel = 'Facebook';
    else if (src.includes('google')) channel = 'Google';
    else if (src.includes('tiktok')) channel = 'TikTok';
    else if (src.includes('linkedin')) channel = 'LinkedIn';
    else if (src.includes('email') && src.includes('b2b')) channel = 'Emailing B2B';
    else if (src.includes('email')) channel = 'Emailing';
    else if (src.includes('event') || src.includes('salon')) channel = 'Événements';
    else if (src.includes('affiliation')) channel = 'Affiliation';
    else channel = `Canal ${idx + 1}`;
  }

  let category = pickAny(raw.category, raw.categorie, raw.type, raw.audience);
  if (!category) {
    const ch = safeLower(channel);
    if (CANDIDAT_CHANNELS.some((c) => safeLower(c) === ch)) category = 'Candidats';
    else if (PROSPECT_CHANNELS.some((c) => safeLower(c) === ch)) category = 'Prospects';
    else category = 'Candidats';
  }

  const source = pickAny(raw.source, raw.origine, raw.lead_source, raw.leadSource);
  const segment = pickAny(raw.segment, raw.experience, raw.exp_level, raw.expLevel, raw.candidate_segment);
  const budget = pickMoney(raw.budget, raw.budget_total, raw.budgetTotal, raw.planned_budget, raw.plannedBudget);
  const spend = pickMoney(raw.spend, raw.depense, raw.depenses, raw.actual_spend, raw.actualSpend, raw.cost, raw.cout);
  const leads = pickNum(raw.leads, raw.leads_count, raw.leadsCount, raw.nb_leads, raw.nbLeads) || 0;
  const prospects = pickNum(raw.prospects, raw.prospect_count, raw.prospectCount, raw.nb_prospects) || 0;
  const clients = pickNum(raw.clients, raw.client_count, raw.clientCount, raw.nb_clients, raw.converted) || 0;
  const language = pickAny(raw.language, raw.langue, raw.lang) || 'Français';
  const city = pickAny(raw.city, raw.ville, raw.location) || 'Tunis';
  const gender = pickAny(raw.gender, raw.genre, raw.sexe) || 'Homme';
  const created_at = pickAny(raw.created_at, raw.createdAt, raw.start_date, raw.startDate, raw.date) || new Date();
  const start_date = pickAny(raw.start_date, raw.startDate, raw.created_at, raw.createdAt) || created_at;
  const end_date = pickAny(raw.end_date, raw.endDate) || null;

  return {
    _id: raw._id,
    campaign_id: safeStr(campaign_id),
    campaign_reference: safeStr(campaign_reference),
    name: safeStr(name) || `${channel} Campaign ${idx + 1}`,
    channel: safeStr(channel),
    category: safeStr(category),
    source: safeStr(source),
    segment: segment ? safeStr(segment) : null,
    budget,
    spend,
    leads,
    prospects,
    clients,
    language: safeStr(language),
    city: safeStr(city),
    gender: safeStr(gender),
    created_at: created_at instanceof Date ? created_at : new Date(created_at),
    start_date: start_date instanceof Date ? start_date : new Date(start_date),
    end_date: end_date instanceof Date ? end_date : (end_date ? new Date(end_date) : null),
  };
}

// ===========================================================================
// LOCAL KPI COMPUTATION — no fake fallbacks, everything from real data
// ===========================================================================

function computeKpis(campaigns: any[]) {
  const totalBudget = campaigns.reduce((s, c) => s + (c.budget || 0), 0);
  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0);
  const totalLeads = campaigns.reduce((s, c) => s + (c.leads || 0), 0);
  const totalProspects = campaigns.reduce((s, c) => s + (c.prospects || 0), 0);
  const totalClients = campaigns.reduce((s, c) => s + (c.clients || 0), 0);

  const cplBrut = totalLeads > 0 ? totalSpend / totalLeads : 0;

  const segMap = new Map<string, { leads: number; spend: number }>();
  for (const c of campaigns) {
    if (c.segment && c.leads > 0) {
      const cur = segMap.get(c.segment) || { leads: 0, spend: 0 };
      cur.leads += c.leads;
      cur.spend += c.spend;
      segMap.set(c.segment, cur);
    }
  }
  const segCpls: number[] = [];
  segMap.forEach((v) => { if (v.leads > 0) segCpls.push(v.spend / v.leads); });
  const cplMoyenSegmente = segCpls.length > 0 ? segCpls.reduce((a, b) => a + b, 0) / segCpls.length : 0;

  const b2bSpend = campaigns
    .filter((c) => safeLower(c.category).includes('prospect'))
    .reduce((s, c) => s + (c.spend || 0), 0);
  const cacMoyen = totalClients > 0 ? b2bSpend / totalClients : 0;
  const budgetUsagePct = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;

  return {
    totalBudget, totalSpend, totalLeads, totalProspects, totalClients,
    cplBrut, cplMoyenSegmente, cacMoyen, budgetUsagePct,
  };
}

function computeChannelStats(campaigns: any[], channels: string[]) {
  const map = new Map<string, any>();
  for (const ch of channels) {
    map.set(ch, {
      channel: ch,
      category: CANDIDAT_CHANNELS.includes(ch) ? 'Candidats' : 'Prospects',
      count: 0, budget: 0, spend: 0, leads: 0, prospects: 0, clients: 0, cpl: 0, cac: 0,
    });
  }
  for (const c of campaigns) {
    if (!map.has(c.channel)) continue;
    const s = map.get(c.channel)!;
    s.count++; s.budget += c.budget || 0; s.spend += c.spend || 0;
    s.leads += c.leads || 0; s.prospects += c.prospects || 0; s.clients += c.clients || 0;
  }
  for (const s of map.values()) {
    s.cpl = s.leads > 0 ? s.spend / s.leads : 0;
    s.cac = s.clients > 0 ? s.spend / s.clients : 0;
  }
  return Array.from(map.values());
}

function computeSegmentStats(campaigns: any[], filters: { language: string; city: string; gender: string }) {
  let filtered = campaigns.filter((c) => c.segment && c.leads > 0);
  if (filters.language !== 'Toutes') filtered = filtered.filter((c) => c.language === filters.language);
  if (filters.city !== 'Toutes') filtered = filtered.filter((c) => c.city === filters.city);
  if (filters.gender !== 'Tous') filtered = filtered.filter((c) => c.gender === filters.gender);

  const map = new Map<string, { leads: number; spend: number }>();
  for (const c of filtered) {
    const cur = map.get(c.segment) || { leads: 0, spend: 0 };
    cur.leads += c.leads; cur.spend += c.spend;
    map.set(c.segment, cur);
  }
  return SEGMENTS.map((seg) => {
    const v = map.get(seg) || { leads: 0, spend: 0 };
    return { segment: seg, leads: v.leads, spend: v.spend, cpl: v.leads > 0 ? v.spend / v.leads : 0 };
  });
}

function computeSourceStats(campaigns: any[]) {
  const map = new Map<string, { leads: number; spend: number }>();
  for (const c of campaigns) {
    if (safeLower(c.category).includes('candidat') && c.source) {
      const cur = map.get(c.source) || { leads: 0, spend: 0 };
      cur.leads += c.leads || 0; cur.spend += c.spend || 0;
      map.set(c.source, cur);
    }
  }
  const result: any[] = [];
  map.forEach((v, k) => result.push({ source: k, leads: v.leads, spend: v.spend, cpl: v.leads > 0 ? v.spend / v.leads : 0 }));
  return result.sort((a, b) => b.leads - a.leads);
}

function computeSourceCacStats(campaigns: any[]) {
  const map = new Map<string, { prospects: number; clients: number; spend: number }>();
  for (const c of campaigns) {
    if (safeLower(c.category).includes('prospect') && c.source) {
      const cur = map.get(c.source) || { prospects: 0, clients: 0, spend: 0 };
      cur.prospects += c.prospects || 0; cur.clients += c.clients || 0; cur.spend += c.spend || 0;
      map.set(c.source, cur);
    }
  }
  const result: any[] = [];
  map.forEach((v, k) => result.push({
    source: k, prospects: v.prospects, clients: v.clients, spend: v.spend,
    cac: v.clients > 0 ? v.spend / v.clients : 0,
    conversionRate: v.prospects > 0 ? (v.clients / v.prospects) * 100 : 0,
  }));
  return result.sort((a, b) => b.prospects - a.prospects);
}

// ===========================================================================
// CSV / EXCEL EXPORT — real, not fake
// ===========================================================================

function exportCSV(campaigns: any[]) {
  const headers = ['Campaign ID', 'Reference', 'Name', 'Channel', 'Category', 'Source', 'Segment',
    'Budget (€)', 'Spend (€)', 'Leads', 'Prospects', 'Clients',
    'Language', 'City', 'Gender', 'Start Date', 'End Date'];
  const rows = campaigns.map((c) => [
    c.campaign_id, c.campaign_reference, c.name, c.channel, c.category, c.source,
    c.segment || '', c.budget.toFixed(2), c.spend.toFixed(2), c.leads, c.prospects, c.clients,
    c.language, c.city, c.gender,
    c.start_date ? fmtDate(c.start_date) : '',
    c.end_date ? fmtDate(c.end_date) : '',
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marketing_campaigns_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(campaigns: any[]) {
  const headers = ['Campaign ID', 'Reference', 'Name', 'Channel', 'Category', 'Source', 'Segment',
    'Budget (€)', 'Spend (€)', 'Leads', 'Prospects', 'Clients',
    'Language', 'City', 'Gender', 'Start Date', 'End Date'];
  const rows = campaigns.map((c) => [
    c.campaign_id, c.campaign_reference, c.name, c.channel, c.category, c.source,
    c.segment || '', c.budget.toFixed(2), c.spend.toFixed(2), c.leads, c.prospects, c.clients,
    c.language, c.city, c.gender,
    c.start_date ? fmtDate(c.start_date) : '',
    c.end_date ? fmtDate(c.end_date) : '',
  ]);
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"></head><body><table border="1"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `marketing_campaigns_${new Date().toISOString().slice(0, 10)}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===========================================================================
// MAIN COMPONENT
// ===========================================================================

export function Marketing() {
  const { toast } = useToast();
  const [rawCampaigns, setRawCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [period, setPeriod] = useState<Period>('30d');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'spend' | 'leads' | 'cpl' | 'budget'>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const [detailCampaign, setDetailCampaign] = useState<any | null>(null);

  const [segFilters, setSegFilters] = useState({ language: 'Toutes', city: 'Toutes', gender: 'Tous' });
  const [showSegFilters, setShowSegFilters] = useState(false);

  // -------------------------------------------------------------------------
  // FETCH — real data from API, no fake fallbacks
  // -------------------------------------------------------------------------
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api.getMarketingCampaigns();
      const candidate: any = Array.isArray(res)
        ? res
        : (res as any)?.data ?? (res as any)?.campaigns ?? [];
      const arr: any[] = Array.isArray(candidate) ? candidate : [];
      setRawCampaigns(arr);
      setLastUpdate(new Date());
    } catch (e: any) {
      const msg = e?.message || 'Erreur lors du chargement des campagnes marketing';
      setError(msg);
      if (!silent) toast('error', msg);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // -------------------------------------------------------------------------
  // AUTO-REFRESH — 30s polling + window focus + network online
  // -------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => fetchData(true), 30000);
    const onFocus = () => fetchData(true);
    const onOnline = () => fetchData(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [fetchData]);

  // -------------------------------------------------------------------------
  // NORMALIZE + FILTER BY PERIOD + SEARCH
  // -------------------------------------------------------------------------
  const campaigns = useMemo(() => {
    const normalized = rawCampaigns
      .map((raw, i) => normalizeCampaign(raw, i))
      .filter(Boolean);
    const periodCfg = PERIODS.find((p) => p.value === period);
    if (periodCfg && periodCfg.days > 0) {
      const cutoff = new Date(Date.now() - periodCfg.days * 86400000);
      const filtered = normalized.filter((c) => {
        const d = c.created_at instanceof Date ? c.created_at : new Date(c.created_at);
        return d >= cutoff;
      });
      return filtered.length > 0 ? filtered : normalized;
    }
    return normalized;
  }, [rawCampaigns, period]);

  const filteredCampaigns = useMemo(() => {
    let result = campaigns;
    if (search.trim()) {
      const q = safeLower(search);
      result = result.filter((c) =>
        safeLower(c.name).includes(q) ||
        safeLower(c.channel).includes(q) ||
        safeLower(c.source).includes(q) ||
        safeLower(c.campaign_id).includes(q) ||
        safeLower(c.campaign_reference).includes(q)
      );
    }
    result = [...result].sort((a, b) => {
      let av: number, bv: number;
      switch (sortBy) {
        case 'leads': av = a.leads; bv = b.leads; break;
        case 'cpl': av = a.leads > 0 ? a.spend / a.leads : Infinity; bv = b.leads > 0 ? b.spend / b.leads : Infinity; break;
        case 'budget': av = a.budget; bv = b.budget; break;
        default: av = a.spend; bv = b.spend;
      }
      return sortDir === 'desc' ? bv - av : av - bv;
    });
    return result;
  }, [campaigns, search, sortBy, sortDir]);

  const kpis = useMemo(() => computeKpis(campaigns), [campaigns]);
  const candidatChannelStats = useMemo(() => computeChannelStats(campaigns, CANDIDAT_CHANNELS), [campaigns]);
  const prospectChannelStats = useMemo(() => computeChannelStats(campaigns, PROSPECT_CHANNELS), [campaigns]);
  const segmentStats = useMemo(() => computeSegmentStats(campaigns, segFilters), [campaigns, segFilters]);
  const sourceStats = useMemo(() => computeSourceStats(campaigns), [campaigns]);
  const sourceCacStats = useMemo(() => computeSourceCacStats(campaigns), [campaigns]);

  const recommendations = useMemo(() => {
    const recs: { icon: any; title: string; body: string; color: string }[] = [];
    const allChannels = [...candidatChannelStats, ...prospectChannelStats].filter((c) => c.leads > 0);
    if (allChannels.length > 0) {
      const sortedByCpl = [...allChannels].sort((a, b) => b.cpl - a.cpl);
      const worst = sortedByCpl[0];
      if (worst && worst.cpl > 0) {
        recs.push({
          icon: TrendingUp,
          title: 'CPL en hausse',
          body: `Les leads ${worst.channel} coûtent ${worst.cpl.toFixed(2)}€ — le plus élevé de tous les canaux.`,
          color: 'text-red-600',
        });
      }
    }
    if (allChannels.length > 1) {
      const sortedByCpl = [...allChannels].sort((a, b) => a.cpl - b.cpl);
      const best = sortedByCpl[0];
      const second = sortedByCpl[1];
      recs.push({
        icon: Lightbulb,
        title: 'CPL le plus bas',
        body: `${best.channel} : ${best.cpl.toFixed(2)}€ · ${second.channel} : ${second.cpl.toFixed(2)}€`,
        color: 'text-green-600',
      });
    }
    if (segmentStats.length > 0) {
      const sorted = [...segmentStats].sort((a, b) => a.cpl - b.cpl);
      const bestSeg = sorted[0];
      if (bestSeg && bestSeg.leads > 0) {
        recs.push({
          icon: Target,
          title: 'Segment le plus rentable',
          body: `${bestSeg.segment} — CPL : ${bestSeg.cpl.toFixed(2)}€ · ${bestSeg.leads.toLocaleString('fr-FR')} leads`,
          color: 'text-blue-600',
        });
      }
    }
    const creationsSpend = candidatChannelStats.find((c) => c.channel === 'Créations')?.spend || 0;
    const creationsB2bSpend = prospectChannelStats.find((c) => c.channel === 'Créations B2B')?.spend || 0;
    const totalCreationsSpend = creationsSpend + creationsB2bSpend;
    if (kpis.totalSpend > 0) {
      const pct = (totalCreationsSpend / kpis.totalSpend) * 100;
      recs.push({
        icon: Sparkles,
        title: 'Dépenses créations',
        body: `Total : ${fmtMoney(totalCreationsSpend)}€ (${pct.toFixed(0)}% du budget total)`,
        color: 'text-purple-600',
      });
    }
    return recs;
  }, [candidatChannelStats, prospectChannelStats, segmentStats, kpis]);

  const handleSort = (col: 'spend' | 'leads' | 'cpl' | 'budget') => {
    if (sortBy === col) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSortBy(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: 'spend' | 'leads' | 'cpl' | 'budget' }) => (
    <ArrowUpDown size={12} className={`inline ml-1 ${sortBy === col ? 'text-blue-600' : 'text-gray-400'}`} />
  );

  // -------------------------------------------------------------------------
  // LOADING / ERROR STATES
  // -------------------------------------------------------------------------
  if (loading && rawCampaigns.length === 0) {
    return (
      <section className="fade-in">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-blue-600" />
            <p className="text-gray-500">Chargement des données marketing…</p>
          </div>
        </div>
      </section>
    );
  }

  if (error && rawCampaigns.length === 0) {
    return (
      <section className="fade-in">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center max-w-md">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-red-500" />
            <p className="text-red-600 font-medium mb-2">Page en erreur</p>
            <p className="text-gray-600 text-sm mb-4">{error}</p>
            <button onClick={() => fetchData()} className="btn btn-primary btn-sm">
              Réessayer
            </button>
          </div>
        </div>
      </section>
    );
  }

  const paginatedCampaigns = filteredCampaigns.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filteredCampaigns.length / pageSize);

  return (
    <section className="fade-in">
      {/* ===== HEADER (matches Payments.tsx pattern) ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Marketing</h1>
          <p className="text-sm text-gray-500">
            Cockpit multicanal · {campaigns.length} campagnes · MAJ : {lastUpdate.toLocaleString('fr-FR')}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={() => fetchData()}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => exportCSV(filteredCampaigns)}>
            <FileText className="w-3 h-3 text-green-600" /> CSV
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => exportExcel(filteredCampaigns)}>
            <FileSpreadsheet className="w-3 h-3 text-green-700" /> Excel
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ===== PERIOD SELECTOR ===== */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <span className="text-xs text-gray-500">Période :</span>
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`btn btn-sm ${period === p.value ? 'btn-primary' : 'btn-outline'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* ===== KPIs ===== */}
      <div className="section-title"><TrendingUp className="w-4 h-4" /> Indicateurs de Synthèse</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Budget Total</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(kpis.totalBudget, '0 €')}</p>
          <p className="text-[10px] text-gray-400">Total planifié</p>
        </div>
        <div className="kpi-card border-l-4 border-l-orange-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Dépenses Total</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(kpis.totalSpend, '0 €')}</p>
          <p className="text-[10px] text-orange-600">{kpis.budgetUsagePct.toFixed(0)}% du budget</p>
        </div>
        <div className="kpi-card border-l-4 border-l-purple-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CPL Brut</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{kpis.cplBrut.toFixed(2)} €</p>
          <p className="text-[10px] text-gray-400">Coût par lead moyen</p>
        </div>
        <div className="kpi-card border-l-4 border-l-indigo-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CPL Moyen Segmenté</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{kpis.cplMoyenSegmente.toFixed(2)} €</p>
          <p className="text-[10px] text-gray-400">Moyenne par segment</p>
        </div>
        <div className="kpi-card border-l-4 border-l-green-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Leads Générés</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(kpis.totalLeads, '', '0')}</p>
          <p className="text-[10px] text-green-600">Prospects : {fmtNum(kpis.totalProspects, '', '0')}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-red-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CAC Moyen</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{kpis.cacMoyen.toFixed(0)} €</p>
          <p className="text-[10px] text-red-600">Clients : {fmtNum(kpis.totalClients, '', '0')}</p>
        </div>
      </div>

      {/* ===== CHANNEL PERFORMANCE ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Candidats */}
        <div>
          <div className="section-title">
            <span className="text-base">🎯</span> Dépenses Candidats
            <span className="ml-auto text-xs text-gray-500 font-normal">
              Total : {fmtMoney(candidatChannelStats.reduce((s, c) => s + c.spend, 0), '0 €')}
            </span>
          </div>
          <div className="space-y-2">
            {candidatChannelStats.map((ch) => {
              const maxSpend = Math.max(...candidatChannelStats.map((c) => c.spend), 1);
              const widthPct = Math.min(100, (ch.spend / maxSpend) * 100);
              const isCreations = ch.channel === 'Créations';
              return (
                <div key={ch.channel} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{ch.channel}</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {fmtMoney(ch.spend, '0 €')} · {fmtNum(ch.leads, '', '0')} leads
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${widthPct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-24 text-right">
                      {isCreations ? 'Designs, vidéos'
                        : ch.cpl > 0 ? `CPL: ${ch.cpl.toFixed(2)}€`
                        : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Prospects */}
        <div>
          <div className="section-title">
            <span className="text-base">🏢</span> Dépenses Prospects &amp; Clients
            <span className="ml-auto text-xs text-gray-500 font-normal">
              Total : {fmtMoney(prospectChannelStats.reduce((s, c) => s + c.spend, 0), '0 €')}
            </span>
          </div>
          <div className="space-y-2">
            {prospectChannelStats.map((ch) => {
              const maxSpend = Math.max(...prospectChannelStats.map((c) => c.spend), 1);
              const widthPct = Math.min(100, (ch.spend / maxSpend) * 100);
              const isCreations = ch.channel === 'Créations B2B';
              return (
                <div key={ch.channel} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-900 dark:text-white">{ch.channel}</span>
                    <span className="text-gray-600 dark:text-gray-400">
                      {fmtMoney(ch.spend, '0 €')} · {fmtNum(ch.leads, '', '0')} leads
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${widthPct}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-24 text-right">
                      {isCreations ? 'Visuels B2B'
                        : ch.cac > 0 ? `CAC: ${ch.cac.toFixed(0)}€`
                        : ch.cpl > 0 ? `CPL: ${ch.cpl.toFixed(2)}€`
                        : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== SEGMENT CPL ANALYSIS ===== */}
      <div className="section-title">
        <BarChart3 className="w-4 h-4" /> Analyse CPL Segmenté
        <button
          onClick={() => setShowSegFilters(!showSegFilters)}
          className="ml-auto btn btn-outline btn-sm"
        >
          <Filter className="w-3 h-3" /> Filtres
        </button>
      </div>

      {showSegFilters && (
        <div className="mb-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500">Langue</label>
              <select
                value={segFilters.language}
                onChange={(e) => setSegFilters((f) => ({ ...f, language: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 rounded-lg text-sm"
              >
                <option value="Toutes">Toutes</option>
                {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Ville</label>
              <select
                value={segFilters.city}
                onChange={(e) => setSegFilters((f) => ({ ...f, city: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 rounded-lg text-sm"
              >
                <option value="Toutes">Toutes</option>
                {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Genre</label>
              <select
                value={segFilters.gender}
                onChange={(e) => setSegFilters((f) => ({ ...f, gender: e.target.value }))}
                className="w-full mt-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 rounded-lg text-sm"
              >
                <option value="Tous">Tous</option>
                {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end mt-2">
            <button
              onClick={() => setSegFilters({ language: 'Toutes', city: 'Toutes', gender: 'Tous' })}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
              <th className="py-2 pr-4">Segment</th>
              <th className="py-2 px-4 text-right">Nb Leads</th>
              <th className="py-2 px-4 text-right">Dépenses</th>
              <th className="py-2 px-4 text-right">CPL</th>
              <th className="py-2 pl-4">Recommandation</th>
            </tr>
          </thead>
          <tbody>
            {segmentStats.map((s) => {
              const rec = s.cpl === 0 ? '⚪ N/A'
                : s.cpl < 6 ? '🟢 Bon marché'
                : s.cpl < 10 ? '🟡 À surveiller'
                : s.cpl < 15 ? '🔴 Coûteux'
                : '🔴 Très cher';
              return (
                <tr key={s.segment} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{s.segment}</td>
                  <td className="py-2 px-4 text-right">{fmtNum(s.leads, '', '0')}</td>
                  <td className="py-2 px-4 text-right">{fmtMoney(s.spend, '0 €')}</td>
                  <td className="py-2 px-4 text-right font-medium">
                    {s.cpl > 0 ? `${s.cpl.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2 pl-4 text-xs">{rec}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ===== SOURCE TABLES ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <div>
          <div className="section-title"><span className="text-base">🎯</span> CPL par Source (Candidats)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 px-4 text-right">Nb Leads</th>
                  <th className="py-2 px-4 text-right">Dépenses</th>
                  <th className="py-2 pl-4 text-right">CPL</th>
                </tr>
              </thead>
              <tbody>
                {sourceStats.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400">Aucune source candidat</td></tr>
                ) : sourceStats.map((s) => (
                  <tr key={s.source} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{s.source}</td>
                    <td className="py-2 px-4 text-right">{fmtNum(s.leads, '', '0')}</td>
                    <td className="py-2 px-4 text-right">{fmtMoney(s.spend, '0 €')}</td>
                    <td className="py-2 pl-4 text-right font-medium">
                      {s.cpl > 0 ? `${s.cpl.toFixed(2)} €` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="section-title"><span className="text-base">🏢</span> CAC par Source (Prospects → Clients)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500">
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 px-2 text-right">Prospects</th>
                  <th className="py-2 px-2 text-right">Clients</th>
                  <th className="py-2 px-2 text-right">Dépenses</th>
                  <th className="py-2 px-2 text-right">CAC</th>
                  <th className="py-2 pl-2 text-right">Taux Conv.</th>
                </tr>
              </thead>
              <tbody>
                {sourceCacStats.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-400">Aucune source prospect</td></tr>
                ) : sourceCacStats.map((s) => (
                  <tr key={s.source} className="border-b border-gray-100 dark:border-gray-700">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">{s.source}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(s.prospects, '', '0')}</td>
                    <td className="py-2 px-2 text-right">{fmtNum(s.clients, '', '0')}</td>
                    <td className="py-2 px-2 text-right">{fmtMoney(s.spend, '0 €')}</td>
                    <td className="py-2 px-2 text-right font-medium">
                      {s.cac > 0 ? `${s.cac.toFixed(0)} €` : '—'}
                    </td>
                    <td className="py-2 pl-2 text-right text-xs">
                      {s.conversionRate > 0 ? `${s.conversionRate.toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===== IA RECOMMANDATIONS ===== */}
      {recommendations.length > 0 && (
        <>
          <div className="section-title"><Sparkles className="w-4 h-4 text-purple-600" /> Recommandations IA</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            {recommendations.map((rec, i) => {
              const Icon = rec.icon;
              return (
                <div key={i} className="kpi-card flex items-start gap-3">
                  <Icon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${rec.color}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{rec.title}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{rec.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ===== CAMPAIGNS TABLE ===== */}
      <div className="section-title">
        <BarChart3 className="w-4 h-4" /> Campagnes ({filteredCampaigns.length})
      </div>
      <div className="mb-4 relative max-w-md">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Rechercher une campagne…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="w-full pl-9 pr-3 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 text-left text-gray-500 bg-gray-50 dark:bg-gray-800">
              <th className="py-2 px-4">Campaign ID</th>
              <th className="py-2 px-4">Nom</th>
              <th className="py-2 px-4">Canal</th>
              <th className="py-2 px-4">Catégorie</th>
              <th className="py-2 px-4 cursor-pointer select-none" onClick={() => handleSort('budget')}>
                Budget <SortIcon col="budget" />
              </th>
              <th className="py-2 px-4 cursor-pointer select-none" onClick={() => handleSort('spend')}>
                Dépenses <SortIcon col="spend" />
              </th>
              <th className="py-2 px-4 cursor-pointer select-none" onClick={() => handleSort('leads')}>
                Leads <SortIcon col="leads" />
              </th>
              <th className="py-2 px-4 cursor-pointer select-none" onClick={() => handleSort('cpl')}>
                CPL <SortIcon col="cpl" />
              </th>
              <th className="py-2 px-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginatedCampaigns.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">Aucune campagne trouvée</td>
              </tr>
            ) : paginatedCampaigns.map((c) => {
              const cpl = c.leads > 0 ? c.spend / c.leads : 0;
              return (
                <tr key={c.campaign_id || c._id} className="border-b border-gray-100 dark:border-gray-700">
                  <td className="py-2 px-4 font-mono text-xs text-gray-600 dark:text-gray-400">{c.campaign_id}</td>
                  <td className="py-2 px-4 font-medium text-gray-900 dark:text-white">{c.name}</td>
                  <td className="py-2 px-4 text-gray-600 dark:text-gray-400">{c.channel}</td>
                  <td className="py-2 px-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${
                      c.category === 'Candidats' ? 'bg-blue-100 text-blue-700' :
                      c.category === 'Prospects' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {c.category}
                    </span>
                  </td>
                  <td className="py-2 px-4 text-right text-gray-600 dark:text-gray-400">{fmtMoney(c.budget, '0 €')}</td>
                  <td className="py-2 px-4 text-right text-gray-600 dark:text-gray-400">{fmtMoney(c.spend, '0 €')}</td>
                  <td className="py-2 px-4 text-right text-gray-600 dark:text-gray-400">{fmtNum(c.leads, '', '0')}</td>
                  <td className="py-2 px-4 text-right font-medium">
                    {cpl > 0 ? `${cpl.toFixed(2)} €` : '—'}
                  </td>
                  <td className="py-2 px-4">
                    <button
                      onClick={() => setDetailCampaign(c)}
                      className="p-1 text-gray-400 hover:text-blue-600 transition"
                      title="Voir détails"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Page {page + 1} / {totalPages} · {filteredCampaigns.length} campagnes
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="btn btn-outline btn-sm disabled:opacity-40"
            >
              Précédent
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="btn btn-outline btn-sm disabled:opacity-40"
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      {/* ===== DETAIL MODAL ===== */}
      {detailCampaign && (
        <Modal
          open={!!detailCampaign}
          onClose={() => setDetailCampaign(null)}
          title={`Détails · ${detailCampaign.name}`}
        >
          <div className="space-y-2 text-sm">
            <DetailRow label="Campaign ID" value={detailCampaign.campaign_id} />
            <DetailRow label="Référence" value={detailCampaign.campaign_reference} />
            <DetailRow label="Canal" value={detailCampaign.channel} />
            <DetailRow label="Catégorie" value={detailCampaign.category} />
            <DetailRow label="Source" value={detailCampaign.source || '—'} />
            <DetailRow label="Segment" value={detailCampaign.segment || '—'} />
            <DetailRow label="Budget" value={fmtMoney(detailCampaign.budget, '0 €')} />
            <DetailRow label="Dépenses" value={fmtMoney(detailCampaign.spend, '0 €')} />
            <DetailRow
              label="Budget utilisé"
              value={detailCampaign.budget > 0
                ? `${((detailCampaign.spend / detailCampaign.budget) * 100).toFixed(0)}%`
                : '—'}
            />
            <DetailRow label="Leads" value={fmtNum(detailCampaign.leads, '', '0')} />
            <DetailRow label="Prospects" value={fmtNum(detailCampaign.prospects, '', '0')} />
            <DetailRow label="Clients" value={fmtNum(detailCampaign.clients, '', '0')} />
            <DetailRow
              label="CPL"
              value={detailCampaign.leads > 0
                ? `${(detailCampaign.spend / detailCampaign.leads).toFixed(2)} €`
                : '—'}
            />
            <DetailRow
              label="CAC"
              value={detailCampaign.clients > 0
                ? `${(detailCampaign.spend / detailCampaign.clients).toFixed(0)} €`
                : '—'}
            />
            <DetailRow label="Langue" value={detailCampaign.language} />
            <DetailRow label="Ville" value={detailCampaign.city} />
            <DetailRow label="Genre" value={detailCampaign.gender} />
            <DetailRow label="Date début" value={fmtDate(detailCampaign.start_date)} />
            <DetailRow label="Date fin" value={detailCampaign.end_date ? fmtDate(detailCampaign.end_date) : '—'} />
          </div>
        </Modal>
      )}
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

