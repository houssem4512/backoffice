import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  TrendingUp, RefreshCw, Plus, Search, FileSpreadsheet, FileText, RotateCcw,
  Eye, Save, CheckCircle, Mail, Calendar, UserPlus, ArrowUpDown, X, Filter,
  ChevronDown, SlidersHorizontal, AlertCircle, Inbox, MapPin, Briefcase,
  Phone, Building2, Euro, Activity, Target,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { fmtMoney, fmtNum, firstNonEmpty, fmtDate } from '../utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const SOURCES = [
  { id: 'formulaire', label: 'Formulaire', badge: 'badge-formulaire' },
  { id: 'manuel',     label: 'Manuel',     badge: 'badge-manuel'     },
  { id: 'email',      label: 'Email',       badge: 'badge-email'      },
  { id: 'telephone',  label: 'Téléphone',   badge: 'badge-telephone' },
];
const STATUTS_OFFRE = [
  { id: 'avec-offre',  label: 'Avec offre',  badge: 'badge-statut-offre'       },
  { id: 'sans-offre',  label: 'Sans offre',  badge: 'badge-statut-sans-offre'  },
  { id: 'qualifie',    label: 'Qualifié',    badge: 'badge-statut-qualifie'    },
];
const CYCLES = ['Nouveau', 'Contacté', 'Démo', 'Devis', 'Négociation', 'Gagné', 'Perdu'];

// Default Tunisian cities (used if /filters returns nothing — e.g. empty DB)
const DEFAULT_CITIES = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul',
  'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Kairouan',
  'Gabès', 'Médenine', 'Bizerte', 'Béja', 'Gafsa',
];

interface Filters {
  source: string; statut: string; cycle: string; ville: string; search: string;
  dateStart: string; dateEnd: string;
}

const DEFAULT_FILTERS: Filters = {
  source: 'Toutes', statut: 'Tous', cycle: 'Tous', ville: 'Toutes', search: '',
  dateStart: '', dateEnd: '',
};

const PAGE_SIZE = 20;

export function Prospects() {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalUnfiltered, setTotalUnfiltered] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [stats, setStats] = useState<any>({});
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [filterOptions, setFilterOptions] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'createdAt' | 'value' | 'name'>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [advancedOpen, setAdvancedOpen] = useState(true);

  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  // -------------------------------------------------------------------------
  // URL ↔ state sync (shareable filter URLs)
  // -------------------------------------------------------------------------
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const next: Partial<Filters> = {};
      const keys = Object.keys(DEFAULT_FILTERS) as (keyof Filters)[];
      for (const k of keys) {
        const v = params.get(k);
        if (v !== null) (next as any)[k] = v;
      }
      if (Object.keys(next).length > 0) setFilters((p) => ({ ...p, ...next }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try {
      const params = new URLSearchParams();
      (Object.keys(filters) as (keyof Filters)[]).forEach((k) => {
        const v = filters[k];
        if (v && v !== 'Tous' && v !== 'Toutes' && v !== '') params.set(k, v);
      });
      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState({}, '', newUrl);
    } catch { /* ignore */ }
  }, [filters]);

  // -------------------------------------------------------------------------
  // Fetch filter options + pipeline once on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    api.getProspectsFilters().then((opts) => {
      if (opts?.success !== false) setFilterOptions(opts);
    });
    api.getProspectPipeline().then((p) => {
      if (p?.stages) setPipeline(p.stages);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Fetch prospects + stats
  // -------------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        api.getProspects(page, PAGE_SIZE, filters as any),
        api.getProspectsStats(),
      ]);
      setList((l && l.data) || []);
      setTotal((l && l.total) || 0);
      setTotalUnfiltered((l && l.totalUnfiltered) || (l && l.total) || 0);
      setExcludedCount((l && l.excludedCount) || 0);
      setDiagnostics((l && l.diagnostics) || null);
      setStats(s || {});
    } catch (e) {
      console.error('[fetchAll]', e);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  // Debounced auto-fetch on filter/page change
  useEffect(() => {
    const t = setTimeout(() => { fetchAll(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, page]);

  const setF = (k: keyof Filters, v: string) => {
    setFilters((p) => ({ ...p, [k]: v }));
    setPage(1); // reset to first page on filter change
  };

  // -------------------------------------------------------------------------
  // Active filter chips with one-click removal
  // -------------------------------------------------------------------------
  const activeFilters = useMemo(() => {
    const active: { key: keyof Filters; label: string; clear: () => void }[] = [];
    if (filters.source && filters.source !== 'Toutes')
      active.push({ key: 'source', label: `Source: ${filters.source}`, clear: () => setF('source', 'Toutes') });
    if (filters.statut && filters.statut !== 'Tous')
      active.push({ key: 'statut', label: `Statut: ${filters.statut}`, clear: () => setF('statut', 'Tous') });
    if (filters.cycle && filters.cycle !== 'Tous')
      active.push({ key: 'cycle', label: `Cycle: ${filters.cycle}`, clear: () => setF('cycle', 'Tous') });
    if (filters.ville && filters.ville !== 'Toutes')
      active.push({ key: 'ville', label: `Ville: ${filters.ville}`, clear: () => setF('ville', 'Toutes') });
    if (filters.search)
      active.push({ key: 'search', label: `Recherche: "${filters.search}"`, clear: () => setF('search', '') });
    if (filters.dateStart || filters.dateEnd) {
      const label = `Date: ${filters.dateStart || '...'} → ${filters.dateEnd || '...'}`;
      active.push({ key: 'dateStart', label, clear: () => { setF('dateStart', ''); setF('dateEnd', ''); } });
    }
    return active;
  }, [filters]);

  const activeCount = activeFilters.length;
  const isFiltered = activeCount > 0;
  const showEmptyWarning = !loading && total === 0 && isFiltered;

  // Dynamic dropdown options from /prospects/filters
  const cityOptions   = filterOptions?.cities  || [];
  const sourceOptions = filterOptions?.sources || [];

  // Stat extraction — NO more hardcoded fallbacks (use 0 instead of faking data)
  const s = stats || {};
  const totalProspects   = firstNonEmpty(s.total_prospects, s.total, 0);
  const caPrev           = firstNonEmpty(s.ca_previsionnel, s.ca_potentiel, s.pipeline_value, 0);
  const tauxConv         = firstNonEmpty(s.taux_conversion, s.conversion_rate, 0);
  const nouveaux7j        = firstNonEmpty(s.nouveau_7j, s.new_7d, 0);
  const offresEnCours     = firstNonEmpty(s.offres_en_cours, s.active_offers, 0);
  const inNegotiation     = firstNonEmpty(s.in_negotiation, 0);
  const newThisMonthDelta = firstNonEmpty(s.new_this_month_delta, 0);
  const tauxConvDelta     = firstNonEmpty(s.conversion_delta, 0);

  // Pipeline funnel
  const totalPipeline = pipeline.reduce((acc, p) => acc + (p.count || 0), 0);

  // -------------------------------------------------------------------------
  // Sort handler
  // -------------------------------------------------------------------------
  const toggleSort = (col: 'createdAt' | 'value' | 'name') => {
    if (sortBy === col) setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const sortedList = useMemo(() => {
    const arr = [...list];
    arr.sort((a, b) => {
      let av: any, bv: any;
      if (sortBy === 'value') { av = a.value || 0; bv = b.value || 0; }
      else if (sortBy === 'name') { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
      else { av = new Date(a.createdAt || 0).getTime(); bv = new Date(b.createdAt || 0).getTime(); }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [list, sortBy, sortDir]);

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startIdx = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(page * PAGE_SIZE, total);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const openDetail = (p: any) => { setSelected(p); setDetailOpen(true); };

  const createProspect = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data: any = {};
    form.forEach((v, k) => { data[k] = v; });
    try {
      await api.createProspect(data);
      toast('success', 'Prospect créé avec succès');
      setCreateOpen(false);
      fetchAll();
    } catch {
      toast('error', 'Échec de la création du prospect');
    }
  };

  // -------------------------------------------------------------------------
  return (
    <section className="fade-in">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CRM Prospects</h1>
          <p className="text-sm text-gray-500">Suivi complet des prospects · Pipeline commercial</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={fetchAll} title="Rafraîchir">
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3 h-3" /> Nouveau prospect
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* KPIs */}
      <div className="section-title"><TrendingUp className="w-4 h-4" /> Indicateurs de Synthèse</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Prospects Totaux</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(totalProspects, '', '0')}</p>
          <p className={`text-[10px] ${newThisMonthDelta >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
            {newThisMonthDelta >= 0 ? '+' : ''}{newThisMonthDelta} ce mois
          </p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CA Prévisionnel</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(caPrev, '0 €')}</p>
          <p className="text-[10px] text-green-600">Pipeline actif</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux Conversion</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">
            {Number(tauxConv).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) || '0'}%
          </p>
          <p className={`text-[10px] ${tauxConvDelta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
            {tauxConvDelta >= 0 ? '+' : ''}{tauxConvDelta} pts
          </p>
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1">
            <div className="bg-indigo-600 h-1.5 rounded-full transition-all" style={{ width: `${Math.min(Number(tauxConv) || 0, 100)}%` }} />
          </div>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Nouveaux (7j)</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(nouveaux7j, '', '0')}</p>
          <p className="text-[10px] text-green-600">7 derniers jours</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Offres En Cours</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(offresEnCours, '', '0')}</p>
          <p className="text-[10px] text-yellow-600">{inNegotiation} en négociation</p>
        </div>
      </div>

      {/* Pipeline funnel */}
      {pipeline.length > 0 && (
        <div className="card p-3 mb-4">
          <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <Activity className="w-3 h-3" /> Pipeline ({totalPipeline} prospects)
          </div>
          <div className="flex flex-wrap gap-2">
            {pipeline.map((p) => {
              const pct = totalPipeline > 0 ? Math.round((p.count / totalPipeline) * 100) : 0;
              return (
                <div key={p.id} className="flex-1 min-w-[120px] bg-gray-50 dark:bg-gray-800 rounded p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{p.name}</span>
                    <span className="text-xs text-gray-500">{p.count}</span>
                  </div>
                  <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all status-dot-bg-${p.id}`}
                      style={{ width: `${pct}%`, backgroundColor: getStageColor(p.id) }}
                    />
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1">{pct}% · {fmtMoney(p.value || 0, '0 €')}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <hr className="section-divider" />

      {/* Filters */}
      <div className="section-title flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" /> Filtres & Recherche
          {activeCount > 0 && (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
              {activeCount} filtre{activeCount > 1 ? 's' : ''} actif{activeCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button
          className="btn btn-outline btn-xs"
          onClick={() => setAdvancedOpen((v) => !v)}
          title={advancedOpen ? 'Réduire' : 'Développer'}
        >
          <ChevronDown className={`w-3 h-3 transition-transform ${advancedOpen ? '' : '-rotate-90'}`} />
        </button>
      </div>

      {advancedOpen && (
        <div className="card p-3 mb-4">
          <div className="filter-group-prospects">
            <div>
              <label>Source</label>
              <select value={filters.source} onChange={(e) => setF('source', e.target.value)}>
                <option>Toutes</option>
                {sourceOptions.length > 0
                  ? sourceOptions.map((src: any, i: number) => <option key={i} value={src.label}>{src.label} ({src.count})</option>)
                  : SOURCES.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label>Statut Offre</label>
              <select value={filters.statut} onChange={(e) => setF('statut', e.target.value)}>
                <option>Tous</option>
                {STATUTS_OFFRE.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label>Cycle de conversion</label>
              <select value={filters.cycle} onChange={(e) => setF('cycle', e.target.value)}>
                <option>Tous</option>
                {CYCLES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Ville</label>
              <select value={filters.ville} onChange={(e) => setF('ville', e.target.value)}>
                <option>Toutes</option>
                {cityOptions.length > 0
                  ? cityOptions.map((c: any, i: number) => <option key={i} value={c.label}>{c.label} ({c.count})</option>)
                  : DEFAULT_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Recherche</label>
              <input placeholder="Nom, société, email, téléphone..." value={filters.search} onChange={(e) => setF('search', e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => { fetchAll(); toast('success', 'Filtres appliqués'); }}>
                <Search className="w-3 h-3" /> Filtrer
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { setFilters({ ...DEFAULT_FILTERS }); setPage(1); toast('info', 'Filtres réinitialisés'); }}>
                <RotateCcw className="w-3 h-3" /> Réinitialiser
              </button>
            </div>
          </div>

          {/* Active filter chips */}
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            {activeCount === 0 ? (
              <span className="text-xs text-gray-400 ml-2 flex items-center gap-1">
                <SlidersHorizontal className="w-3 h-3" /> Aucun filtre actif — affichage de tous les prospects
              </span>
            ) : (
              <>
                <span className="text-xs text-gray-500 mr-1 flex items-center gap-1">
                  <Filter className="w-3 h-3" /> Filtres actifs:
                </span>
                {activeFilters.map((f, i) => (
                  <span
                    key={i}
                    className="filter-tag inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 text-xs cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    onClick={f.clear}
                    title="Cliquer pour retirer"
                  >
                    {f.label}
                    <X className="w-3 h-3" />
                  </span>
                ))}
                <button
                  className="text-xs text-red-500 hover:text-red-700 ml-2 underline"
                  onClick={() => { setFilters({ ...DEFAULT_FILTERS }); setPage(1); toast('info', 'Tous les filtres effacés'); }}
                >
                  Tout effacer
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* EMPTY STATE WARNING */}
      {showEmptyWarning && (
        <div className="card p-4 mb-4 border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800 dark:text-amber-200">
                0 prospect trouvé sur {totalUnfiltered} dans la BDD
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Vos filtres sont trop restrictifs. {excludedCount > 0 && `${excludedCount} prospect(s) exclu(s) par les filtres actuels.`}
              </p>
              <ul className="text-xs text-amber-700 dark:text-amber-300 mt-2 list-disc list-inside space-y-0.5">
                {diagnostics?.source && <li>Source filtrée sur <strong>{diagnostics.source}</strong> — vérifiez que des prospects ont cette source.</li>}
                {diagnostics?.cycle && <li>Cycle filtré sur <strong>{diagnostics.cycle}</strong> — ceci correspond au stage <em>{diagnostics.cycle}</em> dans le pipeline.</li>}
                {diagnostics?.ville && <li>Ville filtrée sur <strong>{diagnostics.ville}</strong> — si 0 résultat, essayez "Toutes".</li>}
                {diagnostics?.search && <li>Recherche sur <strong>"{diagnostics.search}"</strong> — aucun nom/société/email ne correspond.</li>}
                {diagnostics?.statut && <li>Statut <strong>{diagnostics.statut}</strong> — aucun prospect ne correspond à ce statut d'offre.</li>}
              </ul>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => { setFilters({ ...DEFAULT_FILTERS }); setPage(1); toast('info', 'Filtres effacés'); }}
                >
                  <RotateCcw className="w-3 h-3" /> Effacer tous les filtres
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mb-4 text-xs text-gray-500">
        <span className="font-medium text-gray-700 dark:text-gray-300">Cycle de conversion :</span>
        {CYCLES.map((c) => (
          <span key={c} className="flex items-center gap-1">
            <span className="status-dot" style={{ backgroundColor: getCycleColor(c) }} />{c}
          </span>
        ))}
      </div>

      {/* Table header */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-700 dark:text-gray-300">{total}</span> prospects affichés
          {excludedCount > 0 && (
            <span className="text-amber-500 ml-1">· {excludedCount} exclu(s) par filtres</span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export CSV en cours')}>
            <FileSpreadsheet className="w-3 h-3" /> CSV
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export Excel en cours')}>
            <FileText className="w-3 h-3" /> Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="prospect-table-container">
        <table>
          <thead>
            <tr>
              <th onClick={() => toggleSort('name')} className="cursor-pointer hover:text-blue-600">
                Contact <ArrowUpDown className="w-3 h-3 inline" />
              </th>
              <th onClick={() => toggleSort('name')} className="cursor-pointer hover:text-blue-600">
                Société <ArrowUpDown className="w-3 h-3 inline" />
              </th>
              <th>Source <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Statut <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Ville <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Offre <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th onClick={() => toggleSort('value')} className="cursor-pointer hover:text-blue-600">
                CA Potentiel <ArrowUpDown className="w-3 h-3 inline" />
              </th>
              <th>Prochaine action <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sortedList.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center text-gray-400 py-8">
                  <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p className="font-medium">
                    {isFiltered ? 'Aucun prospect pour ces filtres' : 'Aucun prospect dans la BDD'}
                  </p>
                  <p className="text-xs mt-1">
                    {isFiltered
                      ? 'Modifiez vos filtres ou cliquez sur "Tout effacer" pour voir tous les prospects.'
                      : 'Cliquez sur "Nouveau prospect" pour créer votre premier prospect.'}
                  </p>
                </td>
              </tr>
            ) : (
              sortedList.map((p, i) => {
                const src = firstNonEmpty(p.source, p.source_label, 'manuel').toString().toLowerCase();
                const srcDef = SOURCES.find((s) => src.includes(s.id)) || SOURCES.find((s) => src.includes(s.label.toLowerCase()));
                const cycle = firstNonEmpty(p.cycle, p.cycle_fr, 'Nouveau');
                const cycleBadge = `badge-cycle-${(p.stage_code || 'new').toLowerCase()}`;
                const name = firstNonEmpty(p.contact_name, p.name, `${firstNonEmpty(p.first_name, '')} ${firstNonEmpty(p.last_name, '')}`.trim(), '—');
                const company = firstNonEmpty(p.company, p.company_name, '—');
                const city = firstNonEmpty(p.city, p.ville, '—');
                const offer = firstNonEmpty(p.offer_label, p.offer, p.nextAction, '—');
                const ca = firstNonEmpty(p.ca_potential, p.potential_revenue, p.value, 0);
                const nextAction = firstNonEmpty(p.next_action_date, p.nextActionAt, p.next_action, p.nextAction, '—');
                return (
                  <tr key={p._id || p.id || i} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="font-medium">{name}</td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <Building2 className="w-3 h-3 text-gray-400" />
                        {company}
                      </div>
                    </td>
                    <td><span className={`badge ${srcDef?.badge || 'badge-manuel'}`}>{srcDef?.label || firstNonEmpty(p.source_label, 'Manuel')}</span></td>
                    <td><span className={`badge ${cycleBadge}`} style={{ backgroundColor: getCycleColor(cycle) + '20', color: getCycleColor(cycle) }}>{cycle}</span></td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3 h-3 text-gray-400" />
                        {city}
                      </div>
                    </td>
                    <td>{offer}</td>
                    <td className="font-semibold text-green-600">{fmtMoney(ca, '0 €')}</td>
                    <td><span className="text-xs text-gray-400">{nextAction !== '—' && p.nextActionAt ? fmtDate(p.nextActionAt) : nextAction}</span></td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => openDetail(p)} title="Voir détails">
                        <Eye className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-gray-500">
          Affichage {startIdx}-{endIdx} sur {total} prospects
          {totalUnfiltered > total && <span className="text-gray-400 ml-1">· {totalUnfiltered} total dans la BDD</span>}
        </span>
        <div className="flex gap-1">
          <button
            className="btn btn-outline btn-xs"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >←</button>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = i + 1;
            return (
              <button
                key={p}
                className={`btn btn-xs ${page === p ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPage(p)}
              >{p}</button>
            );
          })}
          {totalPages > 5 && <span className="text-xs text-gray-400 px-1">...</span>}
          {totalPages > 5 && (
            <button
              className={`btn btn-xs ${page === totalPages ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setPage(totalPages)}
            >{totalPages}</button>
          )}
          <button
            className="btn btn-outline btn-xs"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >→</button>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-400">
        Dernière mise à jour : {new Date().toLocaleString('fr-FR')}
        {loading && <span className="ml-2 text-blue-500">· chargement...</span>}
      </div>

      {/* Modal Détail Prospect */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Fiche Prospect">
        {selected && (
          <>
            <div className="modal-section">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div>
                  <div className="label">Source</div>
                  <div className="value">
                    <span className={`badge ${SOURCES.find((s) => s.label === firstNonEmpty(selected.source_label, 'Manuel'))?.badge || 'badge-manuel'}`}>
                      {firstNonEmpty(selected.source_label, selected.source, 'Manuel')}
                    </span>
                  </div>
                </div>
                <div><div className="label">Date d'inscription</div><div className="value">{fmtDate(firstNonEmpty(selected.createdAt, selected.created_at, new Date()))}</div></div>
                <div>
                  <div className="label">Cycle</div>
                  <div className="value">
                    <span className="badge" style={{ backgroundColor: getCycleColor(firstNonEmpty(selected.cycle, 'Nouveau')) + '20', color: getCycleColor(firstNonEmpty(selected.cycle, 'Nouveau')) }}>
                      {firstNonEmpty(selected.cycle, selected.cycle_fr, 'Nouveau')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-section">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">👤 Contact principal</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><div className="label">Nom</div><div className="value">{firstNonEmpty(selected.contact_name, selected.name, `${firstNonEmpty(selected.first_name, '')} ${firstNonEmpty(selected.last_name, '')}`, '—')}</div></div>
                <div><div className="label">Société</div><div className="value">{firstNonEmpty(selected.company, selected.company_name, '—')}</div></div>
                <div><div className="label">Email</div><div className="value">{firstNonEmpty(selected.email, '—')}</div></div>
                <div><div className="label">Téléphone</div><div className="value">{firstNonEmpty(selected.phone, '—')}</div></div>
                <div><div className="label">Ville</div><div className="value">{firstNonEmpty(selected.city, selected.ville, '—')}</div></div>
                <div><div className="label">CA Potentiel</div><div className="value text-green-600 font-bold">{fmtMoney(firstNonEmpty(selected.value, selected.ca_potential, selected.potential_revenue, 0), '0 €')}</div></div>
              </div>
            </div>
            {firstNonEmpty(selected.nextAction, selected.next_action) && (
              <div className="modal-section">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📋 Prochaine action</h3>
                <div className="text-sm text-gray-600 dark:text-gray-300">{firstNonEmpty(selected.nextAction, selected.next_action)}</div>
                {selected.nextActionAt && (
                  <div className="text-xs text-gray-400 mt-1">📅 {fmtDate(selected.nextActionAt)}</div>
                )}
              </div>
            )}
            {selected.notes && (
              <div className="modal-section">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📝 Notes</h3>
                <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{selected.notes}</div>
              </div>
            )}
            <div className="modal-section" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: 0 }}>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => toast('success', 'Modifications enregistrées')}><Save className="w-3 h-3" /> Modifier</button>
                <button className="btn btn-success btn-sm" onClick={() => toast('success', 'Statut mis à jour')}><CheckCircle className="w-3 h-3" /> Changer statut</button>
                <button className="btn btn-outline btn-sm" onClick={() => toast('info', 'Email envoyé')}><Mail className="w-3 h-3" /> Envoyer email</button>
                <button className="btn btn-outline btn-sm" onClick={() => toast('info', 'Rappel planifié')}><Calendar className="w-3 h-3" /> Planifier rappel</button>
                <button className="btn btn-danger btn-sm" onClick={() => toast('success', 'Prospect converti en client')}><UserPlus className="w-3 h-3" /> Convertir en client</button>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Modal Nouveau Prospect */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau prospect" maxWidth={600}>
        <form onSubmit={createProspect}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Source</label>
                <select name="source" className="input mt-1" defaultValue="Formulaire">
                  <option>Formulaire</option><option>Manuel</option><option>Email</option><option>Téléphone</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Statut offre</label>
                <select name="status" className="input mt-1" defaultValue="Avec offre">
                  <option>Avec offre</option><option>Sans offre</option><option>Qualifié</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Nom</label>
                <input name="last_name" className="input mt-1" placeholder="Nom du contact" required />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Prénom</label>
                <input name="first_name" className="input mt-1" placeholder="Prénom du contact" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Société</label>
              <input name="company" className="input mt-1" placeholder="Nom de l'entreprise" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Email</label>
                <input name="email" type="email" className="input mt-1" placeholder="contact@entreprise.com" />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Téléphone</label>
                <input name="phone" className="input mt-1" placeholder="+216 XX XXX XXX" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Ville</label>
                <select name="city" className="input mt-1" defaultValue="Tunis">
                  {DEFAULT_CITIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">CA Potentiel (€)</label>
                <input name="value" type="number" className="input mt-1" placeholder="0" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Notes</label>
              <textarea name="notes" className="input mt-1" rows={2} placeholder="Informations complémentaires..." />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn btn-primary flex-1"><CheckCircle className="w-4 h-4" /> Créer</button>
              <button type="button" className="btn btn-outline flex-1" onClick={() => setCreateOpen(false)}>Annuler</button>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Color helpers for cycle / stage badges
// ---------------------------------------------------------------------------
function getCycleColor(cycle: string): string {
  const map: Record<string, string> = {
    'Nouveau':      '#3b82f6', // blue
    'Contacté':     '#8b5cf6', // purple
    'Démo':         '#ec4899', // pink
    'Devis':        '#f59e0b', // amber
    'Négociation':  '#f97316', // orange
    'Gagné':        '#10b981', // emerald
    'Perdu':        '#6b7280', // gray
  };
  return map[cycle] || '#6b7280';
}

function getStageColor(stage: string): string {
  const map: Record<string, string> = {
    new:           '#3b82f6',
    qualified:     '#8b5cf6',
    proposal:      '#f59e0b',
    negotiation:   '#f97316',
    won:           '#10b981',
    lost:          '#6b7280',
  };
  return map[stage] || '#6b7280';
}
