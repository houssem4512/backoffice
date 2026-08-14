import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Calendar, CalendarPlus, RefreshCw, Download, Users, Search,
  FileSpreadsheet, FileText, RotateCcw, X, Filter, ChevronDown,
  ChevronRight, Sparkles, MapPin, Languages, Briefcase, Activity,
  Clock, CheckCircle2, AlertCircle, Inbox, SlidersHorizontal,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { fmtNum, firstNonEmpty } from '../utils/format';

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------
const PERIODS = [
  { id: 'today', label: "Aujourd'hui" },
  { id: '7d',    label: '7j'   },
  { id: '30d',   label: '30j'  },
  { id: '90d',   label: '90j'  },
];

interface Filters {
  dateStart: string; dateEnd: string;
  civility: string; ageMin: string; ageMax: string; city: string;
  position: string; expPoste: string; activite: string; expActivite: string;
  operation: string; expOperation: string;
  langue: string; expGlobale: string; testLing: string;
  scoreMin: string; scoreMax: string; livraisons: string;
  source: string; statut: string; lastActivity: string; search: string;
}

// IMPORTANT: default dates are EMPTY — no more hardcoded 01/01/2026 → 12/07/2026
// that was silently filtering out all leads (created 2026-07-31+).
const DEFAULT_FILTERS: Filters = {
  dateStart: '', dateEnd: '',
  civility: 'Tous', ageMin: '', ageMax: '', city: 'Toutes',
  position: 'Tous', expPoste: 'Toutes', activite: 'Toutes', expActivite: 'Toutes',
  operation: 'Toutes', expOperation: 'Toutes',
  langue: 'Toutes', expGlobale: 'Toutes', testLing: 'Tous',
  scoreMin: '', scoreMax: '', livraisons: 'Tous',
  source: 'Toutes', statut: 'Tous', lastActivity: 'Toutes', search: '',
};

const POSTE_OPTIONS     = ['Agent call center', 'Superviseur', 'Team Leader', 'Responsable'];
const ACTIVITE_OPTIONS  = ['Télévente', 'Support client', 'Accueil', 'Fidélisation'];
const OPERATION_OPTIONS = ['Inbound', 'Outbound', 'Mixte'];
const EXP_OPTIONS       = ['0-1 an', '1-3 ans', '3-5 ans', '5+ ans'];
const LAST_ACTIVITY_OPTIONS = ['< 7 jours', '7-30 jours', '30-90 jours', '> 90 jours'];

// Quick presets — one-click filters
const PRESETS = [
  {
    id: 'today', label: "Aujourd'hui", icon: Calendar,
    apply: (): Partial<Filters> => {
      const d = new Date();
      return { dateStart: d.toISOString().split('T')[0], dateEnd: '', lastActivity: 'Toutes' };
    },
  },
  {
    id: '7j', label: '7 derniers jours', icon: Clock,
    apply: (): Partial<Filters> => {
      const d = new Date(); d.setDate(d.getDate() - 7);
      return { dateStart: d.toISOString().split('T')[0], dateEnd: '', lastActivity: 'Toutes' };
    },
  },
  {
    id: '30j', label: '30 derniers jours', icon: Activity,
    apply: (): Partial<Filters> => {
      const d = new Date(); d.setDate(d.getDate() - 30);
      return { dateStart: d.toISOString().split('T')[0], dateEnd: '', lastActivity: 'Toutes' };
    },
  },
  {
    id: 'tunis', label: 'Tunis seulement', icon: MapPin,
    apply: (): Partial<Filters> => ({ city: 'Tunis' }),
  },
  {
    id: 'actifs', label: 'Profils actifs', icon: CheckCircle2,
    apply: (): Partial<Filters> => ({ statut: 'Disponible' }),
  },
  {
    id: 'livres', label: 'Candidats livrés', icon: Briefcase,
    apply: (): Partial<Filters> => ({ statut: 'Livré' }),
  },
  {
    id: 'francophones', label: 'Francophones', icon: Languages,
    apply: (): Partial<Filters> => ({ langue: 'Français' }),
  },
  {
    id: 'reset', label: 'Tout réinitialiser', icon: RotateCcw,
    apply: (): Filters => ({ ...DEFAULT_FILTERS }),
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function Candidates() {
  const { toast } = useToast();
  const [period, setPeriod] = useState('today');
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [stats, setStats] = useState<any>({});
  const [list, setList] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [totalUnfiltered, setTotalUnfiltered] = useState(0);
  const [excludedCount, setExcludedCount] = useState(0);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [filterOptions, setFilterOptions] = useState<any>(null);
  const [advancedOpen, setAdvancedOpen] = useState(true);

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
      if (Object.keys(next).length > 0) {
        setFilters((p) => ({ ...p, ...next }));
      }
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
  // Fetch filter options once on mount
  // -------------------------------------------------------------------------
  useEffect(() => {
    api.getCandidatesFilterOptions().then((opts) => {
      if (opts?.success !== false) setFilterOptions(opts);
    });
  }, []);

  // -------------------------------------------------------------------------
  // Fetch stats + candidates list
  // -------------------------------------------------------------------------
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([
        api.getCandidatesStats(),
        api.getCandidates(1, 50, filters as any),
      ]);
      setStats(s || {});
      setList((l && l.data) || []);
      setTotal((l && l.total) || 0);
      setTotalUnfiltered((l && l.totalUnfiltered) || (l && l.total) || 0);
      setExcludedCount((l && l.excludedCount) || 0);
      setDiagnostics((l && l.diagnostics) || null);
    } catch (e) {
      console.error('[fetchAll]', e);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Debounced auto-fetch on filter change
  useEffect(() => {
    const t = setTimeout(() => { fetchAll(); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  const setF = (k: keyof Filters, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  const applyPreset = (preset: typeof PRESETS[number]) => {
    const patch = preset.apply();
    if (preset.id === 'reset') {
      setFilters({ ...DEFAULT_FILTERS });
    } else {
      setFilters((p) => ({ ...p, ...patch }));
    }
    toast('success', `Preset appliqué: ${preset.label}`);
  };

  // Compute active filter chips with one-click removal
  const activeFilters = useMemo(() => {
    const active: { key: keyof Filters; label: string; clear: () => void }[] = [];
    if (filters.search)
      active.push({ key: 'search', label: `Recherche: "${filters.search}"`, clear: () => setF('search', '') });
    if (filters.langue && filters.langue !== 'Toutes')
      active.push({ key: 'langue', label: `Langue: ${filters.langue}`, clear: () => setF('langue', 'Toutes') });
    if (filters.city && filters.city !== 'Toutes')
      active.push({ key: 'city', label: `Ville: ${filters.city}`, clear: () => setF('city', 'Toutes') });
    if (filters.activite && filters.activite !== 'Toutes')
      active.push({ key: 'activite', label: `Activité: ${filters.activite}`, clear: () => setF('activite', 'Toutes') });
    if (filters.position && filters.position !== 'Tous')
      active.push({ key: 'position', label: `Poste: ${filters.position}`, clear: () => setF('position', 'Tous') });
    if (filters.statut && filters.statut !== 'Tous')
      active.push({ key: 'statut', label: `Statut: ${filters.statut}`, clear: () => setF('statut', 'Tous') });
    if (filters.source && filters.source !== 'Toutes')
      active.push({ key: 'source', label: `Source: ${filters.source}`, clear: () => setF('source', 'Toutes') });
    if (filters.expGlobale && filters.expGlobale !== 'Toutes')
      active.push({ key: 'expGlobale', label: `Exp. globale: ${filters.expGlobale}`, clear: () => setF('expGlobale', 'Toutes') });
    if (filters.civility && filters.civility !== 'Tous')
      active.push({ key: 'civility', label: `Civilité: ${filters.civility}`, clear: () => setF('civility', 'Tous') });
    if (filters.ageMin || filters.ageMax)
      active.push({
        key: 'ageMin',
        label: `Âge: ${filters.ageMin || '0'} - ${filters.ageMax || '99'}`,
        clear: () => { setF('ageMin', ''); setF('ageMax', ''); },
      });
    if (filters.scoreMin || filters.scoreMax)
      active.push({
        key: 'scoreMin',
        label: `Score: ${filters.scoreMin || '0'} - ${filters.scoreMax || '100'}`,
        clear: () => { setF('scoreMin', ''); setF('scoreMax', ''); },
      });
    if (filters.livraisons && filters.livraisons !== 'Tous')
      active.push({ key: 'livraisons', label: `Livraisons: ${filters.livraisons}`, clear: () => setF('livraisons', 'Tous') });
    if (filters.lastActivity && filters.lastActivity !== 'Toutes')
      active.push({ key: 'lastActivity', label: `Activité: ${filters.lastActivity}`, clear: () => setF('lastActivity', 'Toutes') });
    if (filters.dateStart || filters.dateEnd) {
      const label = `Date: ${filters.dateStart || '...'} → ${filters.dateEnd || '...'}`;
      active.push({ key: 'dateStart', label, clear: () => { setF('dateStart', ''); setF('dateEnd', ''); } });
    }
    return active;
  }, [filters]);

  const activeCount = activeFilters.length;
  const isFiltered = activeCount > 0;
  const showEmptyWarning = !loading && total === 0 && isFiltered;

  // Dynamic dropdown options from /candidates/filters
  const cityOptions      = filterOptions?.cities   || [];
  const languageOptions  = filterOptions?.languages || [];
  const statusOptions    = (filterOptions?.statuses || []).map((s: any) => s.label);
  const sourceOptions    = (filterOptions?.sources  || []).map((s: any) => s.label);
  const ageRange         = filterOptions?.age_range  || { min: 18, max: 65 };
  const scoreRange       = filterOptions?.score_range || { min: 0, max: 100 };

  // Stat extraction
  const s = stats || {};
  const totalLeads       = firstNonEmpty(s.total_leads, s.total, totalUnfiltered, 0);
  const inscritsForm     = firstNonEmpty(s.inscrits_formulaire, s.form_source, 0);
  const importesFb       = firstNonEmpty(s.importes_facebook, s.fb_import, 0);
  const desinscrits      = firstNonEmpty(s.desinscrits, s.unsubscribed, 0);
  const locked           = firstNonEmpty(s.locked, s.profils_locked, 0);
  const suppr            = firstNonEmpty(s.suppr, s.deleted, s.profils_supprimes, 0);
  const jamaisLivr       = firstNonEmpty(s.jamais_livres, s.never_delivered, 0);
  const tauxLivr         = firstNonEmpty(s.taux_livraison, s.delivery_rate, 0);

  const entretienTel     = firstNonEmpty(s.entretien_telephonique, s.phone_interview, 0);
  const entretienPhy     = firstNonEmpty(s.entretien_physique, s.physical_interview, 0);
  const formationJ1      = firstNonEmpty(s.formation_j1, 0);
  const integresJ7       = firstNonEmpty(s.integres_j7, 0);

  // -------------------------------------------------------------------------
  return (
    <section className="fade-in">
      {/* HEADER */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Candidats</h1>
          <p className="text-sm text-gray-500">Data Center · Gestion de la BDD candidats</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="period-selector flex items-center gap-1 bg-gray-100 dark:bg-gray-800 p-0.5 rounded-full border border-gray-200 dark:border-gray-700">
            <button className={`btn btn-sm ${period === 'today' ? 'btn-primary active' : 'btn-outline'}`} onClick={() => setPeriod('today')}>
              <Calendar className="w-3 h-3" /> Aujourd'hui
            </button>
            {PERIODS.slice(1).map((p) => (
              <button key={p.id} className={`btn btn-sm ${period === p.id ? 'btn-primary active' : 'btn-outline'}`} onClick={() => setPeriod(p.id)}>
                {p.label}
              </button>
            ))}
            <button className={`btn btn-sm ${customOpen ? 'btn-primary active' : 'btn-outline'}`} onClick={() => setCustomOpen((v) => !v)}>
              <CalendarPlus className="w-3 h-3" /> Perso
            </button>
          </div>
          <div className={`date-picker-container ${customOpen ? 'active' : ''}`}>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="text-xs text-gray-400">→</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
            <button className="btn btn-primary btn-xs" onClick={() => {
              setFilters((p) => ({ ...p, dateStart: customStart, dateEnd: customEnd }));
              toast('info', 'Période personnalisée appliquée');
            }}>Appliquer</button>
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

      {/* KPIs */}
      <div className="section-title"><Users className="w-4 h-4" /> Panorama Candidats</div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Leads BDD</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(totalLeads, '', '0')}</p>
          <p className="text-[10px] text-blue-600">{fmtNum(s.total_leads_this_month || 0)} ce mois</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Inscrits (Formulaire)</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(inscritsForm, '', '0')}</p>
          <p className="text-[10px] text-green-600">{s.percentages?.inscrits_formulaire || 0}% du total</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Importés (Facebook)</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(importesFb, '', '0')}</p>
          <p className="text-[10px] text-orange-500">{s.percentages?.importes_facebook || 0}% du total</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Désinscrits</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(desinscrits, '', '0')}</p>
          <p className="text-[10px] text-red-500">{s.percentages?.desinscrits || 0}% du total</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Profils Locked</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(locked, '', '0')}</p><p className="text-[10px] text-yellow-600">{s.percentages?.profils_locked || 0}% du total</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Profils Supprimés</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(suppr, '', '0')}</p><p className="text-[10px] text-gray-500">{s.percentages?.profils_supprimes || 0}% du total</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Jamais livrés</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(jamaisLivr, '', '0')}</p><p className="text-[10px] text-orange-500">{s.percentages?.jamais_livres || 0}% du total</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux de livraison</p><p className="text-xl font-bold text-gray-900 dark:text-white">{Number(tauxLivr).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) || '0'}%</p><p className="text-[10px] text-green-600">{fmtNum(s.livres || 0)} livrés</p></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="kpi-card border-l-4 border-l-blue-500"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Entretien Téléphonique</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(entretienTel, '', '0')}</p><p className="text-[10px] text-blue-600">{s.percentages?.entretien_telephonique || 0}% du total</p></div>
        <div className="kpi-card border-l-4 border-l-indigo-500"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Entretien Physique</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(entretienPhy, '', '0')}</p><p className="text-[10px] text-indigo-600">{s.percentages?.entretien_physique || 0}% du total</p></div>
        <div className="kpi-card border-l-4 border-l-emerald-500"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Formation J+1</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(formationJ1, '', '0')}</p><p className="text-[10px] text-emerald-600">{s.percentages?.formation_j1 || 0}% du total</p></div>
        <div className="kpi-card border-l-4 border-l-green-500"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Intégrés J+7</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(integresJ7, '', '0')}</p><p className="text-[10px] text-green-600">{s.percentages?.integres_j7 || 0}% du total</p></div>
      </div>

      <hr className="section-divider" />

      {/* Data Explorer */}
      <div className="section-title flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" /> Data Explorer · Filtres avancés
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

      {/* Presets */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {PRESETS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => applyPreset(p)}
              className={`btn btn-sm ${p.id === 'reset' ? 'btn-outline' : 'btn-outline'} hover:btn-primary`}
              title={p.label}
            >
              <Icon className="w-3 h-3" /> {p.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      {advancedOpen && (
        <div className="card p-3 mb-4">
          {/* Row 1: Search + quick filters */}
          <div className="filter-group mb-3">
            <div className="md:col-span-2">
              <label>Recherche rapide</label>
              <div className="relative">
                <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Nom, email, téléphone, ID public..."
                  value={filters.search}
                  onChange={(e) => setF('search', e.target.value)}
                  style={{ paddingLeft: '1.5rem' }}
                  className="w-full"
                />
              </div>
            </div>
            <div><label>Date d'inscription</label><input type="date" value={filters.dateStart} onChange={(e) => setF('dateStart', e.target.value)} /></div>
            <div><label>Date de fin</label><input type="date" value={filters.dateEnd} onChange={(e) => setF('dateEnd', e.target.value)} /></div>
            <div><label>Civilité</label><select value={filters.civility} onChange={(e) => setF('civility', e.target.value)}><option>Tous</option><option>Homme</option><option>Femme</option></select></div>
            <div><label>Âge min ({ageRange.min}-{ageRange.max})</label><input type="number" min={ageRange.min} max={ageRange.max} placeholder={String(ageRange.min)} value={filters.ageMin} onChange={(e) => setF('ageMin', e.target.value)} /></div>
            <div><label>Âge max ({ageRange.min}-{ageRange.max})</label><input type="number" min={ageRange.min} max={ageRange.max} placeholder={String(ageRange.max)} value={filters.ageMax} onChange={(e) => setF('ageMax', e.target.value)} /></div>
            <div>
              <label>Ville</label>
              <select value={filters.city} onChange={(e) => setF('city', e.target.value)}>
                <option>Toutes</option>
                {cityOptions.length > 0
                  ? cityOptions.map((c: any) => <option key={c.id} value={c.label}>{c.label} ({c.count})</option>)
                  : Object.values({
                      1:'Tunis',2:'Ariana',3:'Ben Arous',4:'Manouba',5:'Nabeul',6:'Zaghouan',
                      7:'Bizerte',8:'Béja',9:'Jendouba',10:'Le Kef',11:'Sousse',12:'Monastir',
                      13:'Mahdia',14:'Sfax',15:'Kairouan',16:'Kasserine',17:'Sidi Bouzid',
                      18:'Gabès',19:'Médenine',20:'Tataouine',21:'Gafsa',22:'Tozeur',23:'Kebili',24:'Siliana',
                    }).map((name) => <option key={name} value={name as string}>{name as string}</option>)}
              </select>
            </div>
          </div>

          {/* Row 2 */}
          <div className="filter-group">
            <div><label>Poste recherché</label><select value={filters.position} onChange={(e) => setF('position', e.target.value)}><option>Tous</option>{POSTE_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Expérience poste</label><select value={filters.expPoste} onChange={(e) => setF('expPoste', e.target.value)}><option>Toutes</option>{EXP_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Activité recherchée</label><select value={filters.activite} onChange={(e) => setF('activite', e.target.value)}><option>Toutes</option>{ACTIVITE_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Expérience activité</label><select value={filters.expActivite} onChange={(e) => setF('expActivite', e.target.value)}><option>Toutes</option>{EXP_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Opération recherchée</label><select value={filters.operation} onChange={(e) => setF('operation', e.target.value)}><option>Toutes</option>{OPERATION_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Expérience opération</label><select value={filters.expOperation} onChange={(e) => setF('expOperation', e.target.value)}><option>Toutes</option>{EXP_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
          </div>

          {/* Row 3 */}
          <div className="filter-group mt-3">
            <div>
              <label>Langue</label>
              <select value={filters.langue} onChange={(e) => setF('langue', e.target.value)}>
                <option>Toutes</option>
                {languageOptions.length > 0
                  ? languageOptions.map((l: any) => <option key={l.code} value={l.label}>{l.label} ({l.count})</option>)
                  : ['Français','Anglais','Allemand','Espagnol','Italien','Arabe'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label>Expérience globale</label><select value={filters.expGlobale} onChange={(e) => setF('expGlobale', e.target.value)}><option>Toutes</option>{EXP_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label>Test linguistique</label><select value={filters.testLing} onChange={(e) => setF('testLing', e.target.value)}><option>Tous</option><option>Oui</option><option>Non</option></select></div>
            <div><label>Score min ({scoreRange.min}-{scoreRange.max})</label><input type="number" min={scoreRange.min} max={scoreRange.max} placeholder={String(scoreRange.min)} value={filters.scoreMin} onChange={(e) => setF('scoreMin', e.target.value)} /></div>
            <div><label>Score max ({scoreRange.min}-{scoreRange.max})</label><input type="number" min={scoreRange.min} max={scoreRange.max} placeholder={String(scoreRange.max)} value={filters.scoreMax} onChange={(e) => setF('scoreMax', e.target.value)} /></div>
            <div><label>Nb livraisons</label><select value={filters.livraisons} onChange={(e) => setF('livraisons', e.target.value)}><option>Tous</option><option value="0">0 (Jamais)</option><option value="1">1</option><option value="2">2</option><option value="3+">3+</option></select></div>
          </div>

          {/* Row 4 */}
          <div className="filter-group mt-3">
            <div>
              <label>Source d'inscription</label>
              <select value={filters.source} onChange={(e) => setF('source', e.target.value)}>
                <option>Toutes</option>
                {sourceOptions.length > 0
                  ? sourceOptions.map((s: any) => <option key={s} value={s}>{s}</option>)
                  : ['Formulaire site','Import Facebook'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label>Statut candidat</label>
              <select value={filters.statut} onChange={(e) => setF('statut', e.target.value)}>
                <option>Tous</option>
                {statusOptions.length > 0
                  ? statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)
                  : ['Disponible','En process','Livré','Indisponible','Désinscrit'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label>Dernière activité</label><select value={filters.lastActivity} onChange={(e) => setF('lastActivity', e.target.value)}><option>Toutes</option>{LAST_ACTIVITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div className="flex items-end gap-2">
              <button className="btn btn-primary btn-sm" onClick={() => { fetchAll(); toast('success', 'Filtres appliqués'); }}>
                <Search className="w-3 h-3" /> Appliquer
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { setFilters({ ...DEFAULT_FILTERS }); toast('info', 'Filtres réinitialisés'); }}>
                <RotateCcw className="w-3 h-3" /> Réinitialiser
              </button>
            </div>
          </div>

          {/* Active filter chips */}
          <div className="mt-3 flex flex-wrap gap-1.5 items-center">
            {activeCount === 0 ? (
              <span className="text-xs text-gray-400 ml-2 flex items-center gap-1">
                <SlidersHorizontal className="w-3 h-3" /> Aucun filtre actif — affichage de tous les candidats
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
                  onClick={() => { setFilters({ ...DEFAULT_FILTERS }); toast('info', 'Tous les filtres effacés'); }}
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
                0 candidat trouvé sur {totalUnfiltered} dans la BDD
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Vos filtres sont trop restrictifs. {excludedCount > 0 && `${excludedCount} candidat(s) exclu(s) par les filtres actuels.`}
              </p>
              <ul className="text-xs text-amber-700 dark:text-amber-300 mt-2 list-disc list-inside space-y-0.5">
                {diagnostics?.dateStart && diagnostics?.dateEnd && (
                  <li>Période du <strong>{diagnostics.dateStart}</strong> au <strong>{diagnostics.dateEnd}</strong> — vérifiez que vos leads ont été créés dans cette plage (par ex. 2026-07-31 onwards).</li>
                )}
                {diagnostics?.dateStart && !diagnostics?.dateEnd && (
                  <li>Date de début <strong>{diagnostics.dateStart}</strong> — certains leads peuvent être antérieurs.</li>
                )}
                {diagnostics?.excludedByAge && (
                  <li>Filtre âge actif ({diagnostics.ageMin || 0} - {diagnostics.ageMax || 99}) — les leads sans date de naissance sont <strong>inclus</strong> par défaut, mais vous pouvez activer le mode strict.</li>
                )}
                {diagnostics?.city && (
                  <li>Ville filtrée sur <strong>{diagnostics.city}</strong> — si 0 résultat, vérifiez que des leads ont cette ville.</li>
                )}
              </ul>
              <div className="flex gap-2 mt-3">
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => { setFilters({ ...DEFAULT_FILTERS }); toast('info', 'Filtres effacés'); }}
                >
                  <RotateCcw className="w-3 h-3" /> Effacer tous les filtres
                </button>
                {diagnostics?.dateStart && (
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      setFilters((p) => ({ ...p, dateStart: '', dateEnd: '' }));
                      toast('info', 'Période effacée');
                    }}
                  >
                    <Calendar className="w-3 h-3" /> Effacer la période
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Results summary */}
      <div className="result-summary-card">
        <div className="result-total">
          <span className="number">{fmtNum(total, '', '0')}</span>
          <span className="sub">
            candidats trouvés sur <strong>{fmtNum(totalUnfiltered || totalLeads, '', '0')}</strong> dans la BDD
            {excludedCount > 0 && (
              <span className="text-amber-500 ml-1">· {excludedCount} exclu(s) par filtres</span>
            )}
          </span>
        </div>
        <div className="criteria-grid">
          <div className="criteria-item"><div className="label">🔍 Langue</div><div className="value">{filters.langue}</div></div>
          <div className="criteria-item"><div className="label">💼 Poste</div><div className="value">{filters.position}</div></div>
          <div className="criteria-item"><div className="label">📅 Exp. globale</div><div className="value">{filters.expGlobale}</div></div>
          <div className="criteria-item"><div className="label">📋 Activité</div><div className="value">{filters.activite}</div></div>
          <div className="criteria-item"><div className="label">📊 Exp. activité</div><div className="value">{filters.expActivite}</div></div>
          <div className="criteria-item"><div className="label">🔄 Opération</div><div className="value">{filters.operation}</div></div>
          <div className="criteria-item"><div className="label">📊 Exp. opération</div><div className="value">{filters.expOperation}</div></div>
          <div className="criteria-item"><div className="label">📍 Ville</div><div className="value">{filters.city}</div></div>
          <div className="criteria-item"><div className="label">🏷️ Statut</div><div className="value">{filters.statut}</div></div>
          <div className="criteria-item"><div className="label">📅 Période</div><div className="value">{filters.dateStart || filters.dateEnd ? `${filters.dateStart || '...'} → ${filters.dateEnd || '...'}` : 'Toutes dates'}</div></div>
        </div>
        <div className="result-actions">
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export CSV en cours')}><FileSpreadsheet className="w-3 h-3" /> CSV</button>
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export Excel en cours')}><FileText className="w-3 h-3" /> Excel</button>
          <button className="btn btn-primary btn-sm" onClick={() => toast('info', 'Export BDD complète en cours')}><Download className="w-3 h-3" /> Exporter tout</button>
          <span className="text-xs text-gray-400 ml-auto">Dernière mise à jour : {new Date().toLocaleString('fr-FR')}</span>
        </div>
      </div>

      {/* Results table */}
      {list.length > 0 ? (
        <div className="prospect-table-container mt-4">
          <table>
            <thead>
              <tr>
                <th>ID</th><th>Nom</th><th>Email</th><th>Ville</th><th>Âge</th><th>Statut</th><th>Inscription</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 50).map((c, i) => {
                const name = `${firstNonEmpty(c.first_name, '')} ${firstNonEmpty(c.last_name, '')}`.trim() || '—';
                const email = firstNonEmpty(c.email, '—');
                const city  = firstNonEmpty(c.city_name, c.city, '—');
                const statut = firstNonEmpty(c.status_name, c.statut, c.account_status, '—');
                const date = firstNonEmpty(c.created_at, '');
                const pid  = firstNonEmpty(c.public_id, c._id, `#${i + 1}`);
                const age  = c.age != null ? `${c.age} ans` : '—';
                return (
                  <tr key={c._id || c.id || i}>
                    <td className="font-mono text-xs text-gray-500">{String(pid).substring(0, 14)}</td>
                    <td className="font-medium">{name}</td>
                    <td>{email}</td>
                    <td>{city}</td>
                    <td><span className="text-xs text-gray-600 dark:text-gray-300">{age}</span></td>
                    <td><span className="badge badge-info">{String(statut)}</span></td>
                    <td><span className="text-xs text-gray-400">{date ? new Date(date).toLocaleDateString('fr-FR') : '—'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : !loading ? (
        <div className="card p-8 mt-4 text-center text-gray-400">
          <Inbox className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p className="font-medium">Aucun candidat à afficher</p>
          <p className="text-xs mt-1">
            {isFiltered
              ? 'Modifiez vos filtres ou cliquez sur "Tout effacer" pour voir tous les candidats.'
              : 'Aucun candidat dans la base de données.'}
          </p>
        </div>
      ) : null}

      <div className="mt-6 text-center text-xs text-gray-400">
        Période : <span>{PERIODS.find((p) => p.id === period)?.label || period}</span>
        {loading && <span className="ml-2 text-blue-500">· chargement...</span>}
      </div>
    </section>
  );
}
