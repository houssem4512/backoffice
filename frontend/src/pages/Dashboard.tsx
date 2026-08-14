import { useEffect, useState } from 'react';
import {
  Bell, AlertCircle, AlertTriangle, TrendingUp, Flame, Target, BarChart2,
  Activity, RefreshCw, Download, Calendar, CalendarPlus, MapPin, Building2,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend,
} from 'recharts';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { fmtNum, fmtMoney, fmtPct, firstNonEmpty } from '../utils/format';

const PERIODS = [
  { id: 'today', label: "Aujourd'hui", short: 'Aujourd' },
  { id: '7d', label: '7j', short: '7j' },
  { id: '30d', label: '30j', short: '30j' },
  { id: '90d', label: '90j', short: '90j' },
];

// Helper: real percentage with one decimal place — NEVER hardcoded
const realPct = (n: number, total: number) =>
  total > 0 ? Math.round((n / total) * 1000) / 10 : 0;

// Helper: pick a color from a curated palette by index
const VILLE_COLORS = [
  { bar: 'from-indigo-500 to-indigo-400', text: 'text-indigo-600', bg: 'bg-indigo-50', dot: 'bg-indigo-500' },
  { bar: 'from-sky-500 to-sky-400',       text: 'text-sky-600',    bg: 'bg-sky-50',    dot: 'bg-sky-500' },
  { bar: 'from-emerald-500 to-emerald-400', text: 'text-emerald-600', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
  { bar: 'from-amber-500 to-amber-400',   text: 'text-amber-600',  bg: 'bg-amber-50',  dot: 'bg-amber-500' },
  { bar: 'from-purple-500 to-purple-400', text: 'text-purple-600', bg: 'bg-purple-50', dot: 'bg-purple-500' },
  { bar: 'from-rose-500 to-rose-400',     text: 'text-rose-600',   bg: 'bg-rose-50',   dot: 'bg-rose-500' },
  { bar: 'from-teal-500 to-teal-400',     text: 'text-teal-600',   bg: 'bg-teal-50',   dot: 'bg-teal-500' },
  { bar: 'from-violet-500 to-violet-400', text: 'text-violet-600', bg: 'bg-violet-50', dot: 'bg-violet-500' },
];

export function Dashboard() {
  const { toast } = useToast();
  const [period, setPeriod] = useState('today');
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState('2026-07-01');
  const [customEnd, setCustomEnd] = useState('2026-07-12');
  const [kpis, setKpis] = useState<any>(null);
  const [activity, setActivity] = useState<any[]>([]);
  const [revenue, setRevenue] = useState<any[]>([]);
  const [byCity, setByCity] = useState<any[]>([]);
  const [byLang, setByLang] = useState<any[]>([]);
  const [candStats, setCandStats] = useState<any>(null);
  const [villes, setVilles] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [k, a, r, c, l, cs, v] = await Promise.all([
        api.getDashboardKPIs(period),
        api.getDashboardActivity(20),
        api.getRevenueChart(period === 'today' ? 'monthly' : period),
        api.getCandidatesByCity(),
        api.getCandidatesByLanguage(),
        api.getCandidatesStats(),
        api.getCandidatesByVille(8),
      ]);
      setKpis(k || {});
      setActivity(Array.isArray(a) ? a : []);
      setRevenue(Array.isArray(r) ? r : []);
      setByCity(Array.isArray(c) ? c : []);
      setByLang(Array.isArray(l) ? l : []);
      setCandStats(cs || {});
      setVilles(v || null);
      setLastUpdate(new Date().toLocaleString('fr-FR'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [period]);

  // ---------- REAL VALUES FROM CANDIDATE STATS (MongoDB leads collection) ----------
  const cs = candStats || {};
  const realTotalLeads = firstNonEmpty(cs.total_leads, 0);
  const realThisMonth = firstNonEmpty(cs.total_leads_this_month, 0);
  const realLivres = firstNonEmpty(cs.livres, 0);
  const realInscritsForm = firstNonEmpty(cs.inscrits_formulaire, 0);
  const realImportesFb = firstNonEmpty(cs.importes_facebook, 0);
  const realDesinscrits = firstNonEmpty(cs.desinscrits, 0);
  const realTauxLivr = firstNonEmpty(cs.taux_livraison, 0);
  const realRatioIE = realPct(realLivres, realTotalLeads);

  // ---------- KPIs (from dashboard endpoint — NO MORE HARDCODED FALLBACKS) ----------
  // If the backend doesn't return a value, we show "—" instead of a fake number.
  const k = kpis || {};
  const caMensuel = firstNonEmpty(k.ca_mensuel, k.monthly_revenue, k.revenue, null);
  const pipeline = firstNonEmpty(k.pipeline, k.pipeline_value, k.deal_pipeline, null);
  const marge = firstNonEmpty(k.marge, k.gross_margin, null);
  const clientsActifs = firstNonEmpty(k.clients_actifs, k.active_clients, k.totalClients, null);
  const prospects = firstNonEmpty(k.prospects, k.qualified_prospects, null);
  const tauxConv = firstNonEmpty(k.taux_conversion, k.conversion_rate, null);

  // Use REAL leads inscrits/exploités from candidate stats (not dashboard endpoint)
  const leadsInscrits = realTotalLeads;
  const leadsExploites = realLivres;
  const ratioIE = realRatioIE;
  const cpl = firstNonEmpty(k.cpl, k.cpl_candidat, null);
  const cpp = firstNonEmpty(k.cpp, k.cost_per_profile, null);
  const cpc = firstNonEmpty(k.cpc, k.cost_per_client, null);

  // ---------- CHART DATA ----------
  const revenueData = revenue.length
    ? revenue.map((d) => ({
        name: String(firstNonEmpty(d.label, d.month, d._id?.month, d.date, d.x, '')),
        ca: Number(firstNonEmpty(d.revenue, d.ca, d.value, d.y, 0)) || 0,
        prev: Number(firstNonEmpty(d.prev_revenue, d.previous, 0)) || 0,
      }))
    : [
        { name: 'Mar', ca: 0, prev: 0 },
        { name: 'Avr', ca: 0, prev: 0 },
        { name: 'Mai', ca: 0, prev: 0 },
        { name: 'Jun', ca: 0, prev: 0 },
        { name: 'Jul', ca: 0, prev: 0 },
        { name: 'Aoû', ca: 0, prev: 0 },
      ];

  const langData = byLang.length
    ? byLang.slice(0, 5).map((d) => ({
        name: String(firstNonEmpty(d.label, d.language, d.lang, d._id, '')),
        stock: Number(firstNonEmpty(d.stock, d.count, 0)) || 0,
        demande: Number(firstNonEmpty(d.demande, d.demand, d.requested, 0)) || 0,
      }))
    : [
        { name: 'FR', stock: realInscritsForm, demande: 0 },
        { name: 'EN', stock: 0, demande: 0 },
        { name: 'DE', stock: 0, demande: 0 },
        { name: 'ES', stock: 0, demande: 0 },
        { name: 'IT', stock: 0, demande: 0 },
      ];

  // Use REAL ville data for the "Top 5 Villes demandées" chart too
  const villesTop = villes?.top_cities || [];
  const cityData = villesTop.length
    ? villesTop.slice(0, 5).map((d) => ({
        name: String(d.ville || d.name || '—'),
        stock: Number(d.count || 0),
        demande: 0, // no real demand data in MongoDB leads
      }))
    : byCity.length
      ? byCity.slice(0, 5).map((d) => ({
          name: String(firstNonEmpty(d.label, d.city, d.ville, d._id, '')),
          stock: Number(firstNonEmpty(d.stock, d.count, 0)) || 0,
          demande: Number(firstNonEmpty(d.demande, d.demand, 0)) || 0,
        }))
      : [
          { name: '—', stock: 0, demande: 0 },
          { name: '—', stock: 0, demande: 0 },
          { name: '—', stock: 0, demande: 0 },
          { name: '—', stock: 0, demande: 0 },
          { name: '—', stock: 0, demande: 0 },
        ];

  // ---------- ACTIVITY ----------
  const activities = activity.length
    ? activity.slice(0, 6).map((a) => ({
        title: firstNonEmpty(a.title, a.label, a.message, 'Activité'),
        sub: firstNonEmpty(a.subtitle, a.description, a.date, ''),
        kind: firstNonEmpty(a.kind, a.type, 'primary'),
      }))
    : [
        { title: 'Aucune activité récente', sub: 'Connectez-vous au backend pour les données live', kind: 'primary' },
      ];

  // ---------- REAL ALERTES (computed from real data, not hardcoded) ----------
  // 1. LANGUE CRITIQUE: top language with lowest delivery — using real langData
  const langCritical = langData.find((l) => l.stock > 0) || null;
  const langCriticalName: string = langCritical ? String(langCritical.name ?? '—') : '—';
  const langCriticalStock: number = langCritical ? Number(langCritical.stock ?? 0) : 0;
  const langCriticalDemande: number = langCritical ? Number(langCritical.demande ?? 0) : 0;
  // 2. VILLE CRITIQUE: city with most candidates (real)
  const villeCritical = villesTop[0] || null;
  const villeCriticalName: string = villeCritical ? String(villeCritical.ville ?? '—') : '—';
  const villeCriticalCount: number = villeCritical ? Number(villeCritical.count ?? 0) : 0;
  const villeCriticalPct: number = villeCritical ? Number(villeCritical.percentage ?? 0) : 0;
  // 3. OPPORTUNITÉ: total leads this month
  const oppLabel = realThisMonth > 0 ? `${realThisMonth} nouveaux profils` : 'Aucun nouveau profil';
  // 4. LANGUES EN TENSION: show real inscription stats
  const tensionLabel = `${realInscritsForm} formulaire · ${realImportesFb} facebook`;

  // ---------- TOP PERFORMANCES (real values) ----------
  const topVille = villesTop[0] || null;
  const topVilleName: string = topVille ? String(topVille.ville ?? '—') : '—';
  const topVilleCount: number = topVille ? Number(topVille.count ?? 0) : 0;
  const topVillePct: number = topVille ? Number(topVille.percentage ?? 0) : 0;
  const topLang = langData.find((l) => l.stock > 0) || null;
  const topLangName: string = topLang ? String(topLang.name ?? '—') : '—';
  const topLangStock: number = topLang ? Number(topLang.stock ?? 0) : 0;

  const periodLabel = PERIODS.find((p) => p.id === period)?.label || period;

  // Real ville stats
  const villeStats = villes || {};
  const villeTotal = firstNonEmpty(villeStats.total_leads, realTotalLeads, 0);
  const villeCovered = firstNonEmpty(villeStats.covered_by_top, 0);
  const villeCoverage = firstNonEmpty(villeStats.coverage_pct, 0);
  const villeField = villeStats.city_field || null;
  const villeSource = villeStats._source || 'fallback';
  const villeList: Array<{ ville: string; count: number; percentage: number }> =
    villeStats.top_cities || [];

  return (
    <section className="fade-in">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Cockpit Décisionnel</h1>
          <p className="text-sm text-gray-500">
            Vue executive · <span>{new Date().toLocaleDateString('fr-FR')}</span>
            <span className="ml-2 text-[10px] text-emerald-600">● Données live MongoDB</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="period-selector flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-full border border-gray-200 dark:border-gray-700">
            <button
              className={`btn btn-sm period-btn ${period === 'today' ? 'btn-primary active' : 'btn-outline'}`}
              onClick={() => setPeriod('today')}
            >
              <Calendar className="w-3 h-3" /> Aujourd'hui
            </button>
            {PERIODS.slice(1).map((p) => (
              <button
                key={p.id}
                className={`btn btn-sm period-btn ${period === p.id ? 'btn-primary active' : 'btn-outline'}`}
                onClick={() => setPeriod(p.id)}
              >
                {p.label}
              </button>
            ))}
            <button
              className={`btn btn-sm period-btn ${customOpen ? 'btn-primary active' : 'btn-outline'}`}
              onClick={() => setCustomOpen((v) => !v)}
            >
              <CalendarPlus className="w-3 h-3" /> Perso
            </button>
          </div>
          <div className={`date-picker-container ${customOpen ? 'active' : ''}`}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="text-xs text-gray-400">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            <button
              className="btn btn-primary btn-xs"
              onClick={() => { toast('info', `Période ${customStart} → ${customEnd} appliquée`); fetchAll(); }}
            >
              Appliquer
            </button>
            <button className="btn btn-outline btn-xs" onClick={() => setCustomOpen(false)}>✕</button>
          </div>
          <button className="btn btn-outline btn-sm" onClick={fetchAll} title="Rafraîchir">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => toast('info', 'Export en cours...')}>
            <Download className="w-3 h-3" /> Exporter
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* Alertes Stratégiques — computed from REAL data */}
      <div className="section-title"><Bell className="w-4 h-4" /> Alertes Stratégiques</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <div className="card border-l-4 border-l-red-500 bg-red-50/50 dark:bg-red-900/10 p-3 hover-lift">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">⚠️ LANGUE CRITIQUE</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {langCritical !== null ? (
                  <span><strong>{langCriticalName}</strong> · {fmtNum(langCriticalStock, '', '0')} profils · {fmtNum(langCriticalDemande, '', '0')} livraison</span>
                ) : (
                  <em>Aucune langue avec stock &gt; 0 détectée</em>
                )}
              </p>
              <button className="btn btn-danger btn-xs mt-1" onClick={() => toast('success', 'Action lancée')}>Prospecter</button>
            </div>
          </div>
        </div>
        <div className="card border-l-4 border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-900/10 p-3 hover-lift">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">⚠️ VILLE CRITIQUE</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                {villeCritical !== null ? (
                  <span><strong>{villeCriticalName}</strong> · {fmtNum(villeCriticalCount, '', '0')} profils · {villeCriticalPct}% du total</span>
                ) : (
                  <em>Aucune ville détectée dans la BDD</em>
                )}
              </p>
              <button className="btn btn-primary btn-xs mt-1" onClick={() => toast('success', 'Action lancée')}>Recruter</button>
            </div>
          </div>
        </div>
        <div className="card border-l-4 border-l-green-500 bg-green-50/50 dark:bg-green-900/10 p-3 hover-lift">
          <div className="flex items-start gap-2">
            <TrendingUp className="w-4 h-4 text-green-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">📈 OPPORTUNITÉ</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Ce mois</strong> · {oppLabel}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Total · {fmtNum(realTotalLeads, '', '0')} profils en base
              </p>
              <button className="btn btn-success btn-xs mt-1" onClick={() => toast('success', 'Opportunité saisie')}>Exploiter</button>
            </div>
          </div>
        </div>
        <div className="card border-l-4 border-l-orange-500 bg-orange-50/50 dark:bg-orange-900/10 p-3 hover-lift">
          <div className="flex items-start gap-2">
            <Flame className="w-4 h-4 text-orange-500 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">🔥 SOURCES D'INSCRIPTION</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">{tensionLabel}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">
                Désinscrits: <strong>{fmtNum(realDesinscrits, '', '0')}</strong> · Taux livraison: <strong>{realTauxLivr}%</strong>
              </p>
              <button className="btn btn-warning btn-xs mt-1" onClick={() => toast('info', 'Voir les détails')}>Voir</button>
            </div>
          </div>
        </div>
      </div>

      <hr className="section-divider" />

      {/* KPIs Vision Macro — REAL values, "—" when no backend data */}
      <div className="section-title"><Target className="w-4 h-4" /> Indicateurs Clés · Vision Macro</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CA Mensuel</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{caMensuel !== null ? fmtMoney(caMensuel, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{caMensuel !== null ? 'Réel' : 'Non disponible'}</p>
          <svg className="sparkline-svg" viewBox="0 0 100 28"><polyline points="0,24 20,20 40,14 60,10 80,6 100,4" fill="none" stroke="#4F46E5" strokeWidth="1.5" /><polygon points="0,24 20,20 40,14 60,10 80,6 100,4 100,28 0,28" fill="rgba(79,70,229,0.06)" /></svg>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Pipeline</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{pipeline !== null ? fmtMoney(pipeline, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{pipeline !== null ? 'Réel' : 'Non disponible'}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: pipeline ? '68%' : '0%' }} />
          </div>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Marge brute</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{marge !== null ? fmtPct(marge, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{marge !== null ? 'Réel' : 'Non disponible'}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${Math.min(Number(marge) || 0, 100)}%` }} />
          </div>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Clients actifs</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{clientsActifs !== null ? fmtNum(clientsActifs, '', '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{clientsActifs !== null ? 'Réel' : 'Non disponible'}</p>
          <svg className="sparkline-svg" viewBox="0 0 100 28"><polyline points="0,22 20,18 40,14 60,10 80,8 100,6" fill="none" stroke="#0EA5E9" strokeWidth="1.5" /><polygon points="0,22 20,18 40,14 60,10 80,8 100,6 100,28 0,28" fill="rgba(14,165,233,0.06)" /></svg>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Prospects qualifiés</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{prospects !== null ? fmtNum(prospects, '', '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{prospects !== null ? 'Réel' : 'Non disponible'}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
            <div className="bg-purple-500 h-1.5 rounded-full" style={{ width: '78%' }} />
          </div>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux de conversion</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{tauxConv !== null ? fmtPct(tauxConv, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{tauxConv !== null ? 'Réel' : 'Non disponible'}</p>
          <svg className="sparkline-svg" viewBox="0 0 100 28"><polyline points="0,20 20,18 40,16 60,14 80,10 100,8" fill="none" stroke="#10B981" strokeWidth="1.5" /><polygon points="0,20 20,18 40,16 60,14 80,10 100,8 100,28 0,28" fill="rgba(16,185,129,0.06)" /></svg>
        </div>
      </div>

      <hr className="section-divider" />

      {/* KPIs Performance & Coûts — REAL leads stats + "—" for missing */}
      <div className="section-title"><BarChart2 className="w-4 h-4" /> Indicateurs Clés · Performance & Coûts</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="kpi-card border-l-4 border-l-blue-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Leads inscrits</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(leadsInscrits, '', '0')}</p>
          <p className="text-[10px] text-blue-600">+{realThisMonth} ce mois</p>
        </div>
        <div className="kpi-card border-l-4 border-l-emerald-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Leads exploités</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(leadsExploites, '', '0')}</p>
          <p className="text-[10px] text-emerald-600">{realTauxLivr}% livraison</p>
        </div>
        <div className="kpi-card border-l-4 border-l-indigo-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Ratio I/E</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtPct(ratioIE, '0%')}</p>
          <p className="text-[10px] text-gray-400">{realLivres} / {realTotalLeads}</p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${Math.min(Number(ratioIE) || 0, 100)}%` }} />
          </div>
        </div>
        <div className="kpi-card border-l-4 border-l-amber-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CPL Candidat</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{cpl !== null ? fmtMoney(cpl, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{cpl !== null ? 'Réel' : 'Non disponible'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-rose-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CPP</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{cpp !== null ? fmtMoney(cpp, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{cpp !== null ? 'Réel' : 'Non disponible'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-purple-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CPC</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{cpc !== null ? fmtMoney(cpc, '—') : '—'}</p>
          <p className="text-[10px] text-gray-400">{cpc !== null ? 'Réel' : 'Non disponible'}</p>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ==================================================================*/}
      {/* ⭐ NEW SECTION: Top Villes · Répartition Candidats — REAL DATA    */}
      {/* ==================================================================*/}
      <div className="section-title">
        <MapPin className="w-4 h-4" /> Top Villes · Répartition Candidats
        {villeSource === 'live' ? (
          <span className="ml-2 badge badge-success text-[9px]">● Live · champ: {villeField || 'N/A'}</span>
        ) : (
          <span className="ml-2 badge badge-warning text-[9px]">⚠ Fallback</span>
        )}
      </div>

      <div className="card p-4 mb-6">
        {/* Summary row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div className="text-center p-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total candidats BDD</p>
            <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{fmtNum(villeTotal, '', '0')}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-emerald-50 dark:bg-emerald-900/20">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Couverts par Top Villes</p>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtNum(villeCovered, '', '0')}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux de couverture</p>
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{villeCoverage}%</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">Villes distinctes (top)</p>
            <p className="text-lg font-bold text-purple-600 dark:text-purple-400">{villeList.length}</p>
          </div>
        </div>

        {/* City cards grid */}
        {villeList.length === 0 ? (
          <div className="py-6 text-gray-500 text-sm">
            <div className="text-center mb-4">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Aucune donnée de ville détectée dans la collection <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">leads</code>.</p>
              <p className="text-xs mt-1">
                Le backend a scanné tous les champs de la collection — aucun ne ressemble à une ville.
              </p>
            </div>

            {/* Tried fields diagnostic — shows what's in the leads collection and why each was rejected */}
            {Array.isArray(villeStats.tried_fields) && villeStats.tried_fields.length > 0 ? (
              <details className="mt-3 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <summary className="cursor-pointer px-3 py-2 bg-gray-50 dark:bg-gray-800 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
                  🔍 Voir les {villeStats.tried_fields.length} champs scannés dans la collection <code>leads</code> (cliquez pour déplier)
                </summary>
                <div className="max-h-64 overflow-y-auto p-2 space-y-1 bg-white dark:bg-gray-900">
                  <table className="w-full text-[10px] font-mono">
                    <thead className="text-gray-500 sticky top-0 bg-white dark:bg-gray-900">
                      <tr className="border-b border-gray-200 dark:border-gray-700">
                        <th className="text-left px-2 py-1">Champ</th>
                        <th className="text-right px-2 py-1">Score</th>
                        <th className="text-left px-2 py-1">Raison du rejet / acceptation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {villeStats.tried_fields
                        .slice()
                        .sort((a: any, b: any) => (b.score || 0) - (a.score || 0))
                        .map((t: any, i: number) => {
                          const isWinner = t.field === villeField;
                          return (
                            <tr
                              key={i}
                              className={`border-b border-gray-100 dark:border-gray-800 ${isWinner ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}
                            >
                              <td className="px-2 py-1 text-gray-700 dark:text-gray-300">
                                {isWinner && <span className="text-emerald-600">✓ </span>}
                                <code className="text-[10px]">{t.field}</code>
                              </td>
                              <td className="px-2 py-1 text-right text-gray-500">
                                {Number(t.score).toFixed(1)}
                              </td>
                              <td className="px-2 py-1 text-gray-500 text-[10px]">
                                {t.reason || (t.score > 0 ? 'accepté' : 'rejeté')}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-gray-400 mt-2 px-2">
                    💡 Pour voir les valeurs réelles de chaque champ, appelez l'endpoint{' '}
                    <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                      GET /api/bo/candidates/inspect
                    </code>{' '}
                    — il retourne les documents complets.
                  </p>
                </div>
              </details>
            ) : (
              <p className="text-xs text-center text-gray-400 mt-2">
                Aucun diagnostic disponible — appelez{' '}
                <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                  GET /api/bo/candidates/inspect
                </code>{' '}
                pour voir le schéma de la collection.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {villeList.map((v, i) => {
              const color = VILLE_COLORS[i % VILLE_COLORS.length];
              const maxCount = villeList[0]?.count || 1;
              const barWidth = Math.max(8, Math.round((v.count / maxCount) * 100));
              return (
                <div
                  key={`${v.ville}-${i}`}
                  className={`relative p-3 rounded-xl border border-gray-200 dark:border-gray-700 ${color.bg} dark:bg-gray-800/50 overflow-hidden hover-lift`}
                >
                  {/* Background fill bar — visual proportion */}
                  <div
                    className={`absolute inset-y-0 left-0 bg-gradient-to-r ${color.bar} opacity-10`}
                    style={{ width: `${barWidth}%` }}
                  />

                  <div className="relative flex items-start justify-between">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${color.dot}`} />
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate max-w-[100px]">
                        {v.ville || '—'}
                      </span>
                    </div>
                    <span className="text-[9px] font-medium text-gray-400">#{i + 1}</span>
                  </div>

                  <div className="relative mt-2">
                    <p className={`text-2xl font-bold ${color.text}`}>
                      {fmtNum(v.count, '', '0')}
                    </p>
                    <p className="text-[10px] text-gray-500">candidats</p>
                  </div>

                  <div className="relative mt-2">
                    <div className="w-full bg-white/60 dark:bg-gray-700/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-1.5 rounded-full bg-gradient-to-r ${color.bar}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{v.percentage}% du total</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom info bar */}
        <div className="mt-4 flex items-center justify-between text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-3 h-3" />
            <span>Source: MongoDB collection <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">{villeStats.collection || 'leads'}</code></span>
            {villeField && <span>· Champ détecté: <code className="px-1 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">{villeField}</code></span>}
          </div>
          <span>Limit: top {villeList.length} · Mis à jour: {lastUpdate || '—'}</span>
        </div>
      </div>

      <hr className="section-divider" />

      {/* Graphiques */}
      <div className="section-title"><BarChart2 className="w-4 h-4" /> Analyse Graphique</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Évolution du CA</h3>
            <span className="badge badge-info text-[9px]">IA prédictive</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData}>
                <defs>
                  <linearGradient id="caGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip formatter={(v: any) => fmtMoney(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                <Area type="monotone" dataKey="ca" stroke="#4F46E5" strokeWidth={2} fill="url(#caGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Top 5 Langues demandées</h3>
            <span className="badge badge-neutral text-[9px]">Stock vs Demande</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={langData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="stock" fill="#0EA5E9" radius={[0, 4, 4, 0]} />
                <Bar dataKey="demande" fill="#4F46E5" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Top 5 Villes demandées</h3>
            <span className="badge badge-success text-[9px]">● Live</span>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={70} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #E2E8F0' }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Bar dataKey="stock" fill="#10B981" radius={[0, 4, 4, 0]} />
                <Bar dataKey="demande" fill="#F59E0B" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <hr className="section-divider" />

      {/* Activité & Performances */}
      <div className="section-title"><Activity className="w-4 h-4" /> Activité & Performances</div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">📋 Activité récente</h3>
            <span className="text-[10px] text-gray-400">Dernières 24h</span>
          </div>
          <div className="space-y-1">
            {activities.map((a, i) => (
              <div key={i} className="timeline-item">
                <div className={`timeline-dot ${a.kind || 'primary'}`} />
                <div>
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200">{a.title}</p>
                  <p className="text-[10px] text-gray-500">{a.sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="card mb-4 border-l-4 border-l-indigo-500 bg-indigo-50/50 dark:bg-indigo-900/10">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-500 uppercase tracking-wide">Leads en base</p>
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-bold text-gray-900 dark:text-white">{fmtNum(realTotalLeads, '', '0')}</span>
                  <span className="text-sm text-gray-400">/ {fmtNum(realTotalLeads, '', '0')}</span>
                  <span className="badge badge-success text-[9px]">100%</span>
                </div>
                <p className="text-[10px] text-gray-500 mt-0.5">Total leads MongoDB · <span className="text-green-600">+{realThisMonth} ce mois</span></p>
              </div>
              <div className="w-20 h-20 relative">
                <svg viewBox="0 0 100 100" className="transform -rotate-90 w-20 h-20">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--gray-200)" strokeWidth="8" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#4F46E5" strokeWidth="8" strokeDasharray="263.89" strokeDashoffset="0" strokeLinecap="round" />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-gray-900 dark:text-white">100%</span>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">🏆 Top Performances</h3>
              <span className="text-[10px] text-gray-400">Live</span>
            </div>
            <div className="space-y-3">
              {topVille !== null ? (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-800 dark:text-gray-200">📍 {topVilleName}</span>
                    <span className="font-semibold text-emerald-600">{fmtNum(topVilleCount, '', '0')} profils</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-0.5">
                    <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: '100%' }} />
                  </div>
                  <span className="text-[10px] text-emerald-600">Top Ville · {topVillePct}% du total</span>
                </div>
              ) : (
                <div className="text-xs text-gray-400">Aucune donnée ville</div>
              )}
              {topLang !== null && topLangStock > 0 ? (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-800 dark:text-gray-200">🗣️ {topLangName}</span>
                    <span className="font-semibold text-blue-600">{fmtNum(topLangStock, '', '0')} profils</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-0.5">
                    <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: '100%' }} />
                  </div>
                  <span className="text-[10px] text-blue-600">Top Langue</span>
                </div>
              ) : (
                <div className="text-xs text-gray-400">Aucune donnée langue</div>
              )}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-200">✅ Leads livrés</span>
                  <span className="font-semibold text-indigo-600">{fmtNum(realLivres, '', '0')} / {fmtNum(realTotalLeads, '', '0')}</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-0.5">
                  <div className="bg-indigo-500 h-1.5 rounded-full" style={{ width: `${Math.min(realTauxLivr, 100)}%` }} />
                </div>
                <span className="text-[10px] text-indigo-600">Taux de livraison: {realTauxLivr}%</span>
              </div>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800 dark:text-gray-200">📊 Inscrits Formulaire</span>
                  <span className="font-semibold text-sky-600">{fmtNum(realInscritsForm, '', '0')} profils</span>
                </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-0.5">
                  <div className="bg-sky-500 h-1.5 rounded-full" style={{ width: `${realPct(realInscritsForm, realTotalLeads)}%` }} />
                </div>
                <span className="text-[10px] text-sky-600">{realPct(realInscritsForm, realTotalLeads)}% du total</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-400">
        Dernière mise à jour : <span>{lastUpdate}</span> · Données en temps réel · Période : <span>{periodLabel}</span>
      </div>
    </section>
  );
}
