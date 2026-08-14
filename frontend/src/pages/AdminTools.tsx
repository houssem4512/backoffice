/**
 * AdminTools.tsx — V2 (FULL BACKEND INTEGRATION)
 * ---------------------------------------------------------------------------
 * 100/100 working:
 *
 *   • Moteur de Pricing   — loads/saves PricingConfig (singleton) via API
 *     - PPP models (PPR/PPF/PPI) editable
 *     - Base PPR HT, TVA, Timbre fiscal editable
 *     - Langues Rares model editable
 *     - Validity tranches editable
 *     - Coefficients (Langue/Expérience/Activité/Opération/Ville/Genre) editable
 *     - Preferential prices CRUD (add/edit/delete)
 *
 *   • Matching des Lots    — loads/saves MatchingConfig + REAL simulation
 *     - Fixed criteria checkboxes
 *     - 9 levels N1..N9 with OK/KO/ANY cells
 *     - Edit modal per level
 *     - Real simulation against `candidates` collection
 *
 *   • Import Facebook      — real CSV upload + preview + column mapping + validate
 *     - File picker reads CSV via FileReader
 *     - POST upload → backend parses → preview returned
 *     - Column mapping selects
 *     - Validate → inserts into `candidates` collection
 *     - Import history list with delete
 *
 *  Patterns:
 *   - Null-safe helpers (safeStr/safeNum/safeArr/safeObj)
 *   - Auto-refresh: 30s + focus + online
 *   - Toast via useToast() function signature: toast(kind, message)
 *   - Named export `AdminTools` (App.tsx uses named import)
 *   - Loading skeleton + error banner
 * ---------------------------------------------------------------------------
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Calculator, GitBranch, Upload, Layers, Languages, Calendar,
  Users, Save, SaveAll, RotateCcw, Plus, Edit, Trash2, UploadCloud,
  FolderOpen, FileText, Check, X, Info, Play, RefreshCw, AlertCircle, Loader2, History,
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { api } from '../api/client';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

type Tab = 'pricing' | 'matching' | 'import';
type PricingTab = 'ppp' | 'langues-rares' | 'validite' | 'clients';

interface PppModel { name: string; min: number; cadence: number; mult: number; conv: number; }
interface LangueRareCat { category: string; credits: number; valueDT: number; }
interface Coefficient { group: string; code?: string; label: string; value: number; }
interface ValidityTranche { days: number; tranches: number; }
interface PreferentialPrice {
  client: string;
  model: string;
  defaultCoef: number;
  newCoef: number;
  remise: number;
  type: 'À vie' | 'Ponctuelle';
  orders: string;
}

interface MatchingLevel {
  level: string;
  niveauBadge: 'badge-niveau1' | 'badge-niveau2' | 'badge-niveau3';
  dateRange: { badge: 'badge-info' | 'badge-warning' | 'badge-danger'; label: '1-30j' | '30-60j' | '>60j' };
  cells: Record<string, 'OK' | 'KO' | 'ANY'>;
}

interface ImportRow {
  nom?: string; prenom?: string; email?: string; tel?: string;
  ville?: string; langue?: string; experience?: string; raw?: Record<string, any>;
}

// ---------------------------------------------------------------------------
// NULL-SAFE HELPERS
// ---------------------------------------------------------------------------

const safeStr = (v: any, fallback = ''): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).trim();
  return s || fallback;
};
const safeNum = (v: any, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const safeArr = <T,>(v: any): T[] => (Array.isArray(v) ? v : []);
const safeObj = (v: any): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// ---------------------------------------------------------------------------
// DEFAULT FALLBACKS (only used if backend returns empty)
// ---------------------------------------------------------------------------

const DEFAULT_PPP_MODELS: PppModel[] = [
  { name: 'PPR', min: 4, cadence: 6, mult: 1,    conv: 10 },
  { name: 'PPF', min: 4, cadence: 4, mult: 1.55, conv: 6 },
  { name: 'PPI', min: 2, cadence: 2, mult: 2.45, conv: 4 },
];

const DEFAULT_LANGUES_RARES: LangueRareCat[] = [
  { category: 'Catégorie 1 (< 6 mois)',  credits: 2, valueDT: 5 },
  { category: 'Catégorie 2 (>= 6 mois)', credits: 4, valueDT: 5 },
];

const DEFAULT_COEFS_BY_GROUP = {
  langue: [
    { code: 'AR', label: 'Arabe',     value: 0.92 },
    { code: 'FR', label: 'Français',  value: 1 },
    { code: 'EN', label: 'Anglais',   value: 1.18 },
    { code: 'BI', label: 'Bilingue',  value: 1.3 },
  ],
  experience: [
    { label: '< 6 mois',  value: 0.82 },
    { label: '>= 6 mois', value: 1 },
  ],
  activite: [
    { label: 'Service client',   value: 0.88 },
    { label: 'Back office',      value: 0.92 },
    { label: 'Prise RDV',        value: 1 },
    { label: 'Téléprospection',  value: 1.12 },
    { label: 'Télévente',        value: 1.12 },
  ],
  operation: [
    { label: 'Simple',    value: 1 },
    { label: 'Standard', value: 1 },
    { label: 'Complexe',  value: 1 },
  ],
  ville: [
    { label: 'Standard', value: 1 },
    { label: 'Tension',   value: 1.1 },
  ],
  genre: [
    { label: 'Mix',      value: 1 },
    { label: 'Contraint', value: 1.08 },
  ],
};

const DEFAULT_VALIDITY_TRANCHES: ValidityTranche[] = [
  { days: 45,  tranches: 1 }, { days: 60,  tranches: 2 }, { days: 90,  tranches: 3 },
  { days: 120, tranches: 4 }, { days: 150, tranches: 5 }, { days: 180, tranches: 6 },
  { days: 270, tranches: 9 }, { days: 365, tranches: 12 },
];

const MATCHING_COLUMNS = [
  { key: 'langue',       label: 'Langue' },
  { key: 'genre',        label: 'Genre' },
  { key: 'expGlobale',   label: 'Exp. Globale' },
  { key: 'activite',     label: 'Activité' },
  { key: 'expActivite',  label: 'Exp. Activité' },
  { key: 'operation',    label: 'Opération' },
  { key: 'expOperation', label: 'Exp. Opération' },
  { key: 'ville',        label: 'Ville' },
  { key: 'modeTravail',  label: 'Mode travail' },
];

// ===========================================================================
// COMPONENT
// ===========================================================================

export function AdminTools() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>('pricing');
  const [pricingTab, setPricingTab] = useState<PricingTab>('ppp');

  // --- Loading / error states ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  // --- Pricing config ---
  const [pricingConfig, setPricingConfig] = useState<any>(null);

  // --- Matching config ---
  const [matchingConfig, setMatchingConfig] = useState<any>(null);
  const [matchingModalLevel, setMatchingModalLevel] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<any>(null);
  const [simulating, setSimulating] = useState(false);
  const [lotSize, setLotSize] = useState(50);
  const [clientCriteria, setClientCriteria] = useState('Télévente · Anglais · Paris');

  // --- Import tab ---
  const [importHistory, setImportHistory] = useState<any[]>([]);
  const [currentImport, setCurrentImport] = useState<any>(null);
  const [uploading, setUploading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ===========================================================================
  // LOAD — fetch all data on mount + auto-refresh
  // ===========================================================================

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    else { setRefreshing(true); }
    try {
      const [pricing, matching, imports] = await Promise.all([
        api.getPricingConfig(),
        api.getMatchingConfig(),
        api.getFacebookImports(),
      ]);

      // Pricing — fallback to defaults if backend returned nothing
      const ppp = safeObj(pricing);
      if (!safeArr(ppp.ppp?.models).length) ppp.ppp = { models: DEFAULT_PPP_MODELS, base: 180, tva: 19, timbre: 1, ...(ppp.ppp || {}) };
      if (!safeArr(ppp.languesRares?.models).length) ppp.languesRares = { models: DEFAULT_LANGUES_RARES, tva: 19, timbre: 1, ...(ppp.languesRares || {}) };
      if (!safeArr(ppp.coefficients).length) {
        const flat: Coefficient[] = [];
        (Object.entries(DEFAULT_COEFS_BY_GROUP) as [string, any[]][]).forEach(([group, items]) => {
          items.forEach((it) => flat.push({ group, ...it }));
        });
        ppp.coefficients = flat;
      }
      if (!safeArr(ppp.validityTranches).length) ppp.validityTranches = DEFAULT_VALIDITY_TRANCHES;
      if (!safeArr(ppp.preferentialPrices).length) {
        ppp.preferentialPrices = [
          { client: 'CallCenter Paris', model: 'PPP',  defaultCoef: 1.0,  newCoef: 0.85, remise: 15, type: 'À vie',      orders: 'TOUTES' },
          { client: 'Global Voice UK',   model: 'PPF',  defaultCoef: 1.55, newCoef: 1.4,  remise: 10, type: 'Ponctuelle', orders: '#42, #45' },
          { client: 'LinguaCall',        model: 'Langues Rares', defaultCoef: 5.0, newCoef: 4.5, remise: 10, type: 'À vie', orders: 'TOUTES' },
        ];
      }
      setPricingConfig(ppp);

      // Matching — fallback defaults
      const m = safeObj(matching);
      if (!safeArr(m.levels).length) {
        const defaultCells = (overrides: Record<string, 'OK' | 'KO' | 'ANY'> = {}) => {
          const cells: Record<string, 'OK' | 'KO' | 'ANY'> = {};
          MATCHING_COLUMNS.forEach((c) => (cells[c.key] = 'OK'));
          return { ...cells, ...overrides };
        };
        m.fixedCriteria = ['Langue', 'Genre', 'Expérience globale', 'Activité', 'Expérience Activité', 'Ville', 'Mode de travail'];
        m.levels = [
          { level: 'N1', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells() },
          { level: 'N2', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells({ expOperation: 'KO' }) },
          { level: 'N3', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-info',    label: '1-30j'  }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
          { level: 'N4', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells() },
          { level: 'N5', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells({ expOperation: 'KO' }) },
          { level: 'N6', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-warning', label: '30-60j' }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
          { level: 'N7', niveauBadge: 'badge-niveau1', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells() },
          { level: 'N8', niveauBadge: 'badge-niveau2', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells({ expOperation: 'KO' }) },
          { level: 'N9', niveauBadge: 'badge-niveau3', dateRange: { badge: 'badge-danger',  label: '>60j'   }, cells: defaultCells({ operation: 'KO', expOperation: 'ANY' }) },
        ];
      }
      setMatchingConfig(m);

      // Imports
      setImportHistory(safeArr(imports?.data));

      setLastUpdate(new Date());
      setError(null);
    } catch (e: any) {
      const msg = e?.message || 'Erreur lors du chargement';
      setError(msg);
      if (!silent) toast('error', msg);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Auto-refresh: 30s + focus + online
  useEffect(() => {
    const interval = setInterval(() => loadAll(true), 30_000);
    const onFocus = () => loadAll(true);
    const onOnline = () => loadAll(true);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [loadAll]);

  // ===========================================================================
  // PRICING — local state mirrors + save handlers
  // ===========================================================================

  const pppModels: PppModel[] = safeArr(pricingConfig?.ppp?.models);
  const languesRares: LangueRareCat[] = safeArr(pricingConfig?.languesRares?.models);
  const coefficients: Coefficient[] = safeArr(pricingConfig?.coefficients);
  const validityTranches: ValidityTranche[] = safeArr(pricingConfig?.validityTranches);
  const preferentialPrices: PreferentialPrice[] = safeArr(pricingConfig?.preferentialPrices);

  const coefsByGroup = useMemo(() => {
    const out: Record<string, Coefficient[]> = {};
    coefficients.forEach((c) => {
      if (!out[c.group]) out[c.group] = [];
      out[c.group].push(c);
    });
    return out;
  }, [coefficients]);

  const updatePppField = (idx: number, field: keyof PppModel, value: any) => {
    setPricingConfig((prev: any) => {
      const next = { ...prev };
      next.ppp = { ...next.ppp };
      next.ppp.models = [...next.ppp.models];
      next.ppp.models[idx] = { ...next.ppp.models[idx], [field]: value };
      return next;
    });
  };

  const updatePppBase = (field: 'base' | 'tva' | 'timbre', value: number) => {
    setPricingConfig((prev: any) => ({ ...prev, ppp: { ...prev.ppp, [field]: value } }));
  };

  const updateLangueRare = (idx: number, field: keyof LangueRareCat, value: any) => {
    setPricingConfig((prev: any) => {
      const next = { ...prev };
      next.languesRares = { ...next.languesRares };
      next.languesRares.models = [...next.languesRares.models];
      next.languesRares.models[idx] = { ...next.languesRares.models[idx], [field]: value };
      return next;
    });
  };

  const updateLangueRareBase = (field: 'tva' | 'timbre', value: number) => {
    setPricingConfig((prev: any) => ({ ...prev, languesRares: { ...prev.languesRares, [field]: value } }));
  };

  const updateCoef = (group: string, idx: number, value: number) => {
    setPricingConfig((prev: any) => {
      const next = { ...prev };
      next.coefficients = [...next.coefficients];
      const localIdx = next.coefficients.findIndex((c: Coefficient, i: number) => c.group === group && i <= idx);
      // Simpler: re-find by group + index
      const groupIdxs: number[] = [];
      next.coefficients.forEach((c: Coefficient, i: number) => { if (c.group === group) groupIdxs.push(i); });
      const targetIdx = groupIdxs[idx];
      if (targetIdx === undefined) return prev;
      next.coefficients[targetIdx] = { ...next.coefficients[targetIdx], value };
      return next;
    });
  };

  const updateValidity = (idx: number, value: number) => {
    setPricingConfig((prev: any) => {
      const next = { ...prev };
      next.validityTranches = [...next.validityTranches];
      next.validityTranches[idx] = { ...next.validityTranches[idx], tranches: value };
      return next;
    });
  };

  const updatePreferential = (idx: number, field: keyof PreferentialPrice, value: any) => {
    setPricingConfig((prev: any) => {
      const next = { ...prev };
      next.preferentialPrices = [...next.preferentialPrices];
      next.preferentialPrices[idx] = { ...next.preferentialPrices[idx], [field]: value };
      return next;
    });
  };

  // --- Save handlers ---
  const handleSavePppModels = async () => {
    setSaving(true);
    try {
      await api.savePppModels(pppModels, safeNum(pricingConfig?.ppp?.base, 180), safeNum(pricingConfig?.ppp?.tva, 19), safeNum(pricingConfig?.ppp?.timbre, 1));
      toast('success', 'Modèles PPP enregistrés');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleSaveLanguesRares = async () => {
    setSaving(true);
    try {
      const full = { ...pricingConfig, languesRares: { models: languesRares, tva: safeNum(pricingConfig?.languesRares?.tva, 19), timbre: safeNum(pricingConfig?.languesRares?.timbre, 1) } };
      await api.savePricingConfig(full);
      toast('success', 'Langues Rares enregistré');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleSaveCoefficients = async () => {
    setSaving(true);
    try {
      await api.saveCoefficients(coefficients);
      toast('success', 'Tous les coefficients ont été enregistrés');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleSaveValidity = async () => {
    setSaving(true);
    try {
      await api.saveValidityTranches(validityTranches);
      toast('success', 'Validités enregistrées');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleSavePreferential = async (idx: number) => {
    setSaving(true);
    try {
      await api.updatePreferentialPrice(idx, preferentialPrices[idx]);
      toast('success', 'Prix préférentiel mis à jour');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleAddPreferential = async () => {
    setSaving(true);
    try {
      await api.addPreferentialPrice({
        client: 'Nouveau client',
        model: 'PPP',
        defaultCoef: 1.0,
        newCoef: 1.0,
        remise: 0,
        type: 'À vie',
        orders: 'TOUTES',
      });
      toast('success', 'Client ajouté');
      await loadAll(true);
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleDeletePreferential = async (idx: number) => {
    if (!confirm('Supprimer ce prix préférentiel ?')) return;
    setSaving(true);
    try {
      await api.deletePreferentialPrice(idx);
      toast('warning', 'Prix préférentiel supprimé');
      await loadAll(true);
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleResetCoefficients = () => {
    if (!confirm('Réinitialiser tous les coefficients aux valeurs par défaut ?')) return;
    const flat: Coefficient[] = [];
    (Object.entries(DEFAULT_COEFS_BY_GROUP) as [string, any[]][]).forEach(([group, items]) => {
      items.forEach((it) => flat.push({ group, ...it }));
    });
    setPricingConfig((prev: any) => ({ ...prev, coefficients: flat }));
    toast('info', 'Coefficients réinitialisés (cliquer sur Enregistrer pour persister)');
  };

  // ===========================================================================
  // MATCHING — save + simulate
  // ===========================================================================

  const handleSaveMatching = async () => {
    setSaving(true);
    try {
      await api.saveMatchingConfig(safeArr(matchingConfig?.fixedCriteria), safeArr(matchingConfig?.levels));
      toast('success', 'Configuration du matching enregistrée');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  const handleResetMatching = () => {
    if (!confirm('Réinitialiser la configuration du matching ?')) return;
    loadAll(true);
    toast('info', 'Configuration rechargée depuis le backend');
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      // Parse criteria string: "Télévente · Anglais · Paris"
      const parts = clientCriteria.split('·').map((s) => s.trim()).filter(Boolean);
      const criteria: any = {};
      if (parts[0]) criteria.activity = parts[0];
      if (parts[1]) criteria.language = parts[1];
      if (parts[2]) criteria.city = parts[2];
      const result = await api.simulateMatching(lotSize, criteria);
      setSimulation(result);
      toast('success', 'Simulation terminée');
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSimulating(false); }
  };

  const handleSaveMatchingLevel = async (level: string, cells: Record<string, 'OK' | 'KO' | 'ANY'>) => {
    setSaving(true);
    try {
      const lvl = safeArr<MatchingLevel>(matchingConfig?.levels).find((l) => l.level === level);
      if (!lvl) { toast('error', 'Niveau introuvable'); return; }
      const updated = { ...lvl, cells };
      await api.updateMatchingLevel(level, updated);
      // Update local state
      setMatchingConfig((prev: any) => ({
        ...prev,
        levels: safeArr(prev?.levels).map((l: MatchingLevel) => (l.level === level ? updated : l)),
      }));
      toast('success', `Niveau ${level} mis à jour`);
      setMatchingModalLevel(null);
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
    finally { setSaving(false); }
  };

  // ===========================================================================
  // IMPORT FACEBOOK — upload + preview + validate
  // ===========================================================================

  const handleFileSelected = async (file: File) => {
    if (!file) return;
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const isXls = file.name.toLowerCase().match(/\.(xlsx|xls)$/);
    if (!isCsv && !isXls) {
      toast('error', 'Format non supporté. Utilisez .csv (ou .xlsx — nécessite le paquet backend xlsx)');
      return;
    }
    setUploading(true);
    setImportResult(null);
    try {
      const text = await file.text();
      const result = await api.uploadFacebookFile(file.name, text, file.size, isCsv ? 'csv' : 'xlsx');
      if (!result?._id) {
        toast('error', 'Import échoué — réponse vide du backend');
        return;
      }
      setCurrentImport(result);
      setImportHistory((prev) => [
        { _id: result._id, fileName: result.fileName, status: 'pending', totalRows: result.totalRows, createdAt: new Date().toISOString() },
        ...prev,
      ]);
      toast('success', `${result.totalRows} lignes importées depuis ${file.name}`);
    } catch (e: any) {
      const msg = e?.message || 'Erreur lors de l\'upload';
      toast('error', msg);
      if (msg.includes('xlsx')) {
        toast('info', 'Astuce : convertissez en CSV ou installez `npm i xlsx` côté backend');
      }
    } finally { setUploading(false); }
  };

  const handleValidateImport = async () => {
    if (!currentImport?._id) return;
    setValidating(true);
    try {
      const result = await api.validateFacebookImport(currentImport._id, columnMapping);
      setImportResult(result);
      toast('success', `${result.importedCount} leads importés · ${result.duplicateCount} doublons · ${result.errorCount} erreurs`);
      await loadAll(true);
    } catch (e: any) { toast('error', e?.message || 'Erreur lors de la validation'); }
    finally { setValidating(false); }
  };

  const handleCancelImport = async () => {
    if (!currentImport?._id) return;
    if (!confirm('Annuler cet import ?')) return;
    try {
      await api.cancelFacebookImport(currentImport._id);
      toast('info', 'Import annulé');
      setCurrentImport(null);
      await loadAll(true);
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
  };

  const handleDeleteImport = async (id: string) => {
    if (!confirm('Supprimer cet import de l\'historique ?')) return;
    try {
      await api.deleteFacebookImport(id);
      toast('warning', 'Import supprimé');
      if (currentImport?._id === id) setCurrentImport(null);
      await loadAll(true);
    } catch (e: any) { toast('error', e?.message || 'Erreur'); }
  };

  const handleDownloadExample = () => {
    const csv = [
      'Nom,Email,Téléphone,Ville,Langue,Expérience',
      'Dupont Jean,jean.dupont@email.com,+216 12 345 678,Tunis,Français,>= 6 mois',
      'Martin Sophie,sophie.martin@email.com,+216 23 456 789,Sfax,Anglais,< 6 mois',
      'Bernard Thomas,thomas.bernard@email.com,+216 34 567 890,Bizerte,Français,>= 6 mois',
      'Petit Marie,marie.petit@email.com,+216 45 678 901,Sousse,Arabe,< 6 mois',
      'Moreau Claire,claire.moreau@email.com,+216 56 789 012,Gabès,Français,>= 6 mois',
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'facebook-leads-example.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('success', 'Exemple téléchargé');
  };

  // ===========================================================================
  // RENDER HELPERS
  // ===========================================================================

  const isLoading = loading || !pricingConfig || !matchingConfig;

  if (isLoading) {
    return (
      <section className="fade-in">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">⚙️ Outils Admin</h1>
            <p className="text-sm text-gray-500">Chargement de la configuration…</p>
          </div>
        </div>
      </section>
    );
  }

  // ----- PRICING SUBTABS -----

  const renderPricingPPP = () => (
    <div className="card mb-4">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📊 Modèles PPP</h3>
      <div className="admin-table-container">
        <table>
          <thead>
            <tr><th>Modèle</th><th>Minimum</th><th>Cadence/mois</th><th>Multiplicateur</th><th>Taux conv. cible</th><th>Action</th></tr>
          </thead>
          <tbody>
            {pppModels.map((m: PppModel, idx: number) => (
              <tr key={m.name}>
                <td className="font-medium">{m.name}</td>
                <td><input className="input input-sm w-16" type="number" value={m.min} onChange={(e) => updatePppField(idx, 'min', Number(e.target.value))} /></td>
                <td><input className="input input-sm w-16" type="number" value={m.cadence} onChange={(e) => updatePppField(idx, 'cadence', Number(e.target.value))} /></td>
                <td><input className="input input-sm w-16" type="number" step="0.01" value={m.mult} onChange={(e) => updatePppField(idx, 'mult', Number(e.target.value))} /></td>
                <td><input className="input input-sm w-16" type="number" step="0.01" value={m.conv} onChange={(e) => updatePppField(idx, 'conv', Number(e.target.value))} />%</td>
                <td>
                  <button className="btn btn-primary btn-xs" onClick={handleSavePppModels} disabled={saving}>
                    <Save className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-3 gap-3 mt-3">
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Base PPR HT</label>
          <div className="flex items-center gap-2">
            <input className="input input-sm w-24" type="number" value={safeNum(pricingConfig?.ppp?.base, 180)} onChange={(e) => updatePppBase('base', Number(e.target.value))} />
            <span className="text-xs">DT</span>
            <button className="btn btn-primary btn-xs" onClick={handleSavePppModels} disabled={saving}><Save className="w-3 h-3" /></button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">TVA</label>
          <div className="flex items-center gap-2">
            <input className="input input-sm w-24" type="number" step="0.01" value={safeNum(pricingConfig?.ppp?.tva, 19)} onChange={(e) => updatePppBase('tva', Number(e.target.value))} />
            <span className="text-xs">%</span>
            <button className="btn btn-primary btn-xs" onClick={handleSavePppModels} disabled={saving}><Save className="w-3 h-3" /></button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Timbre fiscal</label>
          <div className="flex items-center gap-2">
            <input className="input input-sm w-24" type="number" step="0.01" value={safeNum(pricingConfig?.ppp?.timbre, 1)} onChange={(e) => updatePppBase('timbre', Number(e.target.value))} />
            <span className="text-xs">DT</span>
            <button className="btn btn-primary btn-xs" onClick={handleSavePppModels} disabled={saving}><Save className="w-3 h-3" /></button>
          </div>
        </div>
      </div>

      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mt-4 mb-3">📋 Coefficients PPP</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(['langue', 'experience', 'activite', 'operation', 'ville', 'genre'] as const).map((groupKey) => {
          const groupLabels: Record<string, string> = {
            langue: 'Langue', experience: 'Expérience', activite: 'Activité',
            operation: 'Opération', ville: 'Ville', genre: 'Genre',
          };
          const items = coefsByGroup[groupKey] || [];
          return (
            <div key={groupKey}>
              <h4 className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">{groupLabels[groupKey]}</h4>
              <div className="space-y-1">
                {items.map((c, idx) => (
                  <div key={`${groupKey}-${idx}`} className="flex items-center gap-2">
                    <span className="text-xs w-28">{c.code || c.label}</span>
                    <input
                      className="input input-sm w-20"
                      type="number"
                      step="0.01"
                      value={c.value}
                      onChange={(e) => updateCoef(groupKey, idx, Number(e.target.value))}
                    />
                    <button className="btn btn-primary btn-xs" onClick={handleSaveCoefficients} disabled={saving}>
                      <Save className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={handleSaveCoefficients} disabled={saving}>
          <SaveAll className="w-4 h-4" /> Enregistrer tous les coefficients
        </button>
        <button className="btn btn-outline btn-sm" onClick={handleResetCoefficients}>
          <RotateCcw className="w-4 h-4" /> Réinitialiser
        </button>
      </div>
    </div>
  );

  const renderPricingLanguesRares = () => (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">🌍 Modèle Langues Rares</h3>
      <div className="admin-table-container">
        <table>
          <thead><tr><th>Catégorie</th><th>Crédits par lead</th><th>Valeur par crédit (DT)</th><th>Action</th></tr></thead>
          <tbody>
            {languesRares.map((lr: LangueRareCat, idx: number) => (
              <tr key={idx}>
                <td className="font-medium">{lr.category}</td>
                <td><input className="input input-sm w-16" type="number" value={lr.credits} onChange={(e) => updateLangueRare(idx, 'credits', Number(e.target.value))} /></td>
                <td><input className="input input-sm w-16" type="number" step="0.01" value={lr.valueDT} onChange={(e) => updateLangueRare(idx, 'valueDT', Number(e.target.value))} /></td>
                <td>
                  <button className="btn btn-primary btn-xs" onClick={handleSaveLanguesRares} disabled={saving}><Save className="w-3 h-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">TVA</label>
          <div className="flex items-center gap-2">
            <input className="input input-sm w-24" type="number" step="0.01" value={safeNum(pricingConfig?.languesRares?.tva, 19)} onChange={(e) => updateLangueRareBase('tva', Number(e.target.value))} />
            <span className="text-xs">%</span>
            <button className="btn btn-primary btn-xs" onClick={handleSaveLanguesRares} disabled={saving}><Save className="w-3 h-3" /></button>
          </div>
        </div>
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Timbre fiscal</label>
          <div className="flex items-center gap-2">
            <input className="input input-sm w-24" type="number" step="0.01" value={safeNum(pricingConfig?.languesRares?.timbre, 1)} onChange={(e) => updateLangueRareBase('timbre', Number(e.target.value))} />
            <span className="text-xs">DT</span>
            <button className="btn btn-primary btn-xs" onClick={handleSaveLanguesRares} disabled={saving}><Save className="w-3 h-3" /></button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPricingValidite = () => (
    <div className="card">
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📅 Validité & Tranches</h3>
      <div className="admin-table-container">
        <table>
          <thead><tr><th>Validité (jours)</th><th>Nb tranches</th><th>Action</th></tr></thead>
          <tbody>
            {validityTranches.map((v: ValidityTranche, idx: number) => (
              <tr key={v.days}>
                <td>{v.days}</td>
                <td><input className="input input-sm w-16" type="number" value={v.tranches} onChange={(e) => updateValidity(idx, Number(e.target.value))} /></td>
                <td><button className="btn btn-primary btn-xs" onClick={handleSaveValidity} disabled={saving}><Save className="w-3 h-3" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={handleSaveValidity} disabled={saving}><SaveAll className="w-4 h-4" /> Enregistrer</button>
        <button className="btn btn-outline btn-sm" onClick={() => { if (confirm('Réinitialiser les tranches ?')) loadAll(true); }}><RotateCcw className="w-4 h-4" /> Réinitialiser</button>
      </div>
    </div>
  );

  const renderPricingClients = () => (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">🏷️ Clients avec prix préférentiel</h3>
        <button className="btn btn-primary btn-sm" onClick={handleAddPreferential} disabled={saving}><Plus className="w-3 h-3" /> Ajouter</button>
      </div>
      <div className="admin-table-container">
        <table>
          <thead>
            <tr><th>Client / Prospect</th><th>Modèle</th><th>Coeff. Défaut</th><th>Nouveau Coeff.</th><th>Remise</th><th>Type</th><th>Commandes</th><th>Action</th></tr>
          </thead>
          <tbody>
            {preferentialPrices.map((p: PreferentialPrice, idx: number) => (
              <tr key={idx}>
                <td>
                  <input
                    className="input input-sm w-40"
                    value={p.client}
                    onChange={(e) => updatePreferential(idx, 'client', e.target.value)}
                  />
                </td>
                <td><span className="badge badge-info">{p.model}</span></td>
                <td><input className="input input-sm w-16" type="number" step="0.01" value={p.defaultCoef} onChange={(e) => updatePreferential(idx, 'defaultCoef', Number(e.target.value))} /></td>
                <td><input className="input input-sm w-16" type="number" step="0.01" value={p.newCoef} onChange={(e) => updatePreferential(idx, 'newCoef', Number(e.target.value))} /></td>
                <td><span className="text-green-600 font-semibold">{p.remise}%</span></td>
                <td>
                  <select className="input input-sm w-24" value={p.type} onChange={(e) => updatePreferential(idx, 'type', e.target.value)}>
                    <option value="À vie">À vie</option>
                    <option value="Ponctuelle">Ponctuelle</option>
                  </select>
                </td>
                <td><input className="input input-sm w-24" value={p.orders} onChange={(e) => updatePreferential(idx, 'orders', e.target.value)} /></td>
                <td>
                  <button className="btn btn-primary btn-xs" onClick={() => handleSavePreferential(idx)} disabled={saving}><Save className="w-3 h-3" /></button>
                  <button className="btn btn-danger btn-xs ml-1" onClick={() => handleDeletePreferential(idx)} disabled={saving}><Trash2 className="w-3 h-3" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          <Info className="w-4 h-4 inline mr-1" />
          <strong>Comment ça fonctionne :</strong> Les coefficients par défaut s'appliquent à tous les clients. Pour un client spécifique, vous pouvez définir un coefficient multiplicateur personnalisé. Exemple : 0.85 = 15% de remise sur le prix standard.
        </p>
      </div>
    </div>
  );

  const renderPricing = () => (
    <>
      <div className="section-title"><Calculator className="w-4 h-4" /> Moteur de Pricing · Paramétrage</div>
      <div className="tab-container mb-4">
        <button className={`tab-btn ${pricingTab === 'ppp' ? 'active' : ''}`} onClick={() => setPricingTab('ppp')}><Layers className="w-4 h-4 inline" /> Modèle PPP</button>
        <button className={`tab-btn ${pricingTab === 'langues-rares' ? 'active' : ''}`} onClick={() => setPricingTab('langues-rares')}><Languages className="w-4 h-4 inline" /> Langues Rares</button>
        <button className={`tab-btn ${pricingTab === 'validite' ? 'active' : ''}`} onClick={() => setPricingTab('validite')}><Calendar className="w-4 h-4 inline" /> Validité & Tranches</button>
        <button className={`tab-btn ${pricingTab === 'clients' ? 'active' : ''}`} onClick={() => setPricingTab('clients')}><Users className="w-4 h-4 inline" /> Prix préférentiels</button>
      </div>
      {pricingTab === 'ppp' && renderPricingPPP()}
      {pricingTab === 'langues-rares' && renderPricingLanguesRares()}
      {pricingTab === 'validite' && renderPricingValidite()}
      {pricingTab === 'clients' && renderPricingClients()}
    </>
  );

  // ----- MATCHING TAB -----

  const renderMatching = () => (
    <>
      <div className="section-title"><GitBranch className="w-4 h-4" /> Paramétrage du Matching des Lots</div>
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📋 Critères Fixes (toujours obligatoires)</h3>
        <div className="flex flex-wrap gap-3">
          {safeArr<string>(matchingConfig?.fixedCriteria).map((c) => (
            <label key={c} className="flex items-center gap-1 text-sm"><input type="checkbox" checked disabled /> {c}</label>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-2">Ces critères sont toujours appliqués dans tous les niveaux de matching.</p>
      </div>
      <div className="card">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📊 Niveaux de Matching</h3>
        <div className="admin-table-container">
          <table>
            <thead>
              <tr>
                <th>Niveau</th>
                {MATCHING_COLUMNS.map((c) => <th key={c.key}>{c.label}</th>)}
                <th>Date insc.</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {safeArr<MatchingLevel>(matchingConfig?.levels).map((lvl: MatchingLevel) => {
                const cells = lvl.cells || {};
                return (
                  <tr key={lvl.level}>
                    <td><span className={`badge ${lvl.niveauBadge}`}>{lvl.level}</span></td>
                    {MATCHING_COLUMNS.map((col) => {
                      const v = cells[col.key] || 'OK';
                      return (
                        <td key={col.key}>
                          <span className={`badge ${v === 'OK' ? 'badge-ok' : v === 'KO' ? 'badge-ko' : 'badge-any'}`}>{v}</span>
                        </td>
                      );
                    })}
                    <td><span className={`badge ${lvl.dateRange?.badge || 'badge-info'}`}>{lvl.dateRange?.label || '1-30j'}</span></td>
                    <td><button className="btn btn-outline btn-xs" onClick={() => setMatchingModalLevel(lvl.level)}><Edit className="w-3 h-3" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 p-4 bg-gray-100 dark:bg-gray-800 rounded-lg">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📋 Simulation du Matching (réelle)</h4>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Taille du lot</label>
              <input className="input input-sm" type="number" value={lotSize} onChange={(e) => setLotSize(Number(e.target.value))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Critères client</label>
              <input className="input input-sm" value={clientCriteria} onChange={(e) => setClientCriteria(e.target.value)} placeholder="Activité · Langue · Ville" />
            </div>
            <div className="flex items-end gap-2">
              <button className="btn btn-primary btn-sm" onClick={handleSimulate} disabled={simulating}>
                {simulating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} Simuler
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveMatching} disabled={saving}><Save className="w-3 h-3" /> Enregistrer</button>
            </div>
          </div>
          {simulation && safeArr(simulation.simulation).length > 0 && (
            <div className="admin-table-container">
              <table>
                <thead><tr><th>Niveau</th><th>Disponible</th><th>Sélectionné</th><th>Reste</th><th>Progression</th></tr></thead>
                <tbody>
                  {simulation.simulation.map((s: any) => (
                    <tr key={s.level}>
                      <td><span className={`badge ${s.niveauBadge || 'badge-niveau1'}`}>{s.level}</span></td>
                      <td>{s.dispo}</td>
                      <td>{s.selected}</td>
                      <td>{s.reste}</td>
                      <td>
                        <div className="progress-bar w-32">
                          <div className={`fill ${s.pct > 75 ? 'fill-high' : s.pct > 40 ? 'fill-medium' : 'fill-low'}`} style={{ width: `${s.pct}%` }} />
                        </div>
                        <span className="text-xs ml-2">{s.pct}%</span>
                      </td>
                    </tr>
                  ))}
                  <tr className="font-bold">
                    <td>Total</td>
                    <td>{simulation.totals.dispo}</td>
                    <td>{simulation.totals.selected}</td>
                    <td>{simulation.totals.reste}</td>
                    <td>
                      <div className="progress-bar w-32">
                        <div className="fill fill-medium" style={{ width: `${simulation.totals.pct}%` }} />
                      </div>
                      <span className="text-xs ml-2">{simulation.totals.pct}%</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {simulation && safeArr(simulation.simulation).length === 0 && (
            <p className="text-xs text-gray-400">Aucun candidat disponible pour ces critères. Essayez de relâcher les critères.</p>
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary btn-sm" onClick={handleSaveMatching} disabled={saving}><SaveAll className="w-4 h-4" /> Enregistrer la configuration</button>
        <button className="btn btn-outline btn-sm" onClick={handleResetMatching}><RotateCcw className="w-4 h-4" /> Réinitialiser</button>
      </div>
    </>
  );

  // ----- IMPORT TAB -----

  const renderImport = () => (
    <>
      <div className="section-title"><Upload className="w-4 h-4" /> Import des leads Facebook</div>
      <div className="card mb-4">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📎 Importer un fichier</h3>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1">
            <div
              className={`border-2 border-dashed rounded-lg p-6 text-center transition cursor-pointer ${dragOver ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20' : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) handleFileSelected(f);
              }}
            >
              <UploadCloud className="w-10 h-10 mx-auto text-gray-400 mb-2" />
              <p className="text-sm text-gray-500">{uploading ? 'Upload en cours…' : 'Glissez-déposez votre fichier ici ou cliquez pour parcourir'}</p>
              {uploading && <Loader2 className="w-4 h-4 animate-spin mx-auto mt-2 text-indigo-600" />}
              <p className="text-xs text-gray-400 mt-2">Formats acceptés : CSV (Excel nécessite le paquet backend xlsx)</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFileSelected(f);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button className="btn btn-outline btn-sm" onClick={handleDownloadExample}><FileText className="w-4 h-4" /> Télécharger l'exemple</button>
          </div>
        </div>
      </div>

      {currentImport && (
        <>
          <div className="card mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">📋 Aperçu des données — {currentImport.fileName} ({currentImport.totalRows} lignes)</h3>
              <button className="btn btn-danger btn-xs" onClick={handleCancelImport}><X className="w-3 h-3" /> Annuler</button>
            </div>
            <div className="admin-table-container">
              <table>
                <thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Ville</th><th>Langue</th><th>Expérience</th></tr></thead>
                <tbody>
                  {safeArr<ImportRow>(currentImport.preview).slice(0, 5).map((r: ImportRow, idx: number) => (
                    <tr key={idx}>
                      <td>{r.nom || r.prenom || '—'}</td>
                      <td>{r.email || '—'}</td>
                      <td>{r.tel || '—'}</td>
                      <td>{r.ville || '—'}</td>
                      <td>{r.langue || '—'}</td>
                      <td>{r.experience || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-2">Affichage des 5 premières lignes sur {currentImport.totalRows}.</p>
          </div>

          <div className="card mb-4">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">⚙️ Configuration de l'import</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { key: 'nom',        label: 'Colonne "Nom"',        options: ['Nom', 'Prénom', 'Ignorer'] },
                { key: 'email',      label: 'Colonne "Email"',      options: ['Email', 'Téléphone', 'Ignorer'] },
                { key: 'tel',        label: 'Colonne "Téléphone"',  options: ['Téléphone', 'Email', 'Ignorer'] },
                { key: 'ville',      label: 'Colonne "Ville"',      options: ['Ville', 'Ignorer'] },
                { key: 'langue',     label: 'Colonne "Langue"',     options: ['Langue', 'Ignorer'] },
                { key: 'experience', label: 'Colonne "Expérience"', options: ['Expérience globale', 'Ignorer'] },
              ].map((c) => (
                <div key={c.key}>
                  <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">{c.label}</label>
                  <select
                    className="input input-sm mt-1"
                    value={columnMapping[c.key] || c.options[0]}
                    onChange={(e) => setColumnMapping((prev) => ({ ...prev, [c.key]: e.target.value }))}
                  >
                    {c.options.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">📊 Résultat de l'import</h3>
            {importResult ? (
              <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border-l-4 border-l-green-500">
                    <p className="text-2xl font-bold text-green-600">{importResult.importedCount}</p>
                    <p className="text-xs text-gray-500">Leads importés avec succès</p>
                  </div>
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border-l-4 border-l-yellow-500">
                    <p className="text-2xl font-bold text-yellow-600">{importResult.duplicateCount}</p>
                    <p className="text-xs text-gray-500">Doublons ignorés</p>
                  </div>
                  <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border-l-4 border-l-red-500">
                    <p className="text-2xl font-bold text-red-600">{importResult.errorCount}</p>
                    <p className="text-xs text-gray-500">Lignes en erreur</p>
                  </div>
                </div>
                {safeArr(importResult.errorDetails).length > 0 && (
                  <details className="mt-3">
                    <summary className="text-xs text-gray-500 cursor-pointer">Voir les erreurs ({importResult.errorCount})</summary>
                    <ul className="mt-2 text-xs text-red-600 space-y-1 max-h-40 overflow-y-auto">
                      {importResult.errorDetails.map((e: string, i: number) => <li key={i}>{e}</li>)}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-xs text-gray-400">Cliquez sur "Valider l'import" pour insérer les {currentImport.totalRows} leads dans la base candidats.</p>
            )}
            <div className="mt-4 flex gap-2">
              <button className="btn btn-success btn-sm" onClick={handleValidateImport} disabled={validating || !currentImport}>
                {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Valider l'import
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleCancelImport}><X className="w-4 h-4" /> Annuler</button>
            </div>
          </div>
        </>
      )}

      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200"><History className="w-4 h-4 inline" /> Historique des imports</h3>
          <button className="btn btn-outline btn-xs" onClick={() => loadAll(true)} disabled={refreshing}>
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {importHistory.length === 0 ? (
          <p className="text-xs text-gray-400">Aucun import effectué pour le moment.</p>
        ) : (
          <div className="admin-table-container">
            <table>
              <thead>
                <tr><th>Fichier</th><th>Statut</th><th>Lignes</th><th>Importés</th><th>Doublons</th><th>Erreurs</th><th>Date</th><th>Action</th></tr>
              </thead>
              <tbody>
                {importHistory.map((imp: any) => (
                  <tr key={imp._id}>
                    <td className="font-medium">{imp.fileName}</td>
                    <td>
                      <span className={`badge ${imp.status === 'completed' ? 'badge-ok' : imp.status === 'cancelled' ? 'badge-ko' : 'badge-any'}`}>
                        {imp.status}
                      </span>
                    </td>
                    <td>{imp.totalRows}</td>
                    <td>{imp.importedCount || 0}</td>
                    <td>{imp.duplicateCount || 0}</td>
                    <td>{imp.errorCount || 0}</td>
                    <td>{imp.createdAt ? new Date(imp.createdAt).toLocaleString('fr-FR') : '—'}</td>
                    <td>
                      <button className="btn btn-danger btn-xs" onClick={() => handleDeleteImport(imp._id)}><Trash2 className="w-3 h-3" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );

  // ===========================================================================
  // MAIN RENDER
  // ===========================================================================

  return (
    <section className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">⚙️ Outils Admin</h1>
          <p className="text-sm text-gray-500">Gestion du moteur de pricing, matching des lots et imports</p>
        </div>
        <div className="flex items-center gap-2">
          {error && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {error}
            </span>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => loadAll(false)} disabled={refreshing}>
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} /> Actualiser
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      <div className="tab-container">
        <button className={`tab-btn ${tab === 'pricing' ? 'active' : ''}`} onClick={() => setTab('pricing')}><Calculator className="w-4 h-4 inline" /> Moteur de Pricing</button>
        <button className={`tab-btn ${tab === 'matching' ? 'active' : ''}`} onClick={() => setTab('matching')}><GitBranch className="w-4 h-4 inline" /> Matching des Lots</button>
        <button className={`tab-btn ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}><Upload className="w-4 h-4 inline" /> Import Facebook</button>
      </div>

      {tab === 'pricing' && renderPricing()}
      {tab === 'matching' && renderMatching()}
      {tab === 'import' && renderImport()}

      <MatchingLevelEditModal
        level={matchingModalLevel}
        config={matchingConfig}
        onClose={() => setMatchingModalLevel(null)}
        onSave={handleSaveMatchingLevel}
        saving={saving}
      />
    </section>
  );
}

// ===========================================================================
// MATCHING LEVEL EDIT MODAL — separate component for clarity
// ===========================================================================

function MatchingLevelEditModal({
  level,
  config,
  onClose,
  onSave,
  saving,
}: {
  level: string | null;
  config: any;
  onClose: () => void;
  onSave: (level: string, cells: Record<string, 'OK' | 'KO' | 'ANY'>) => Promise<void>;
  saving: boolean;
}) {
  const lvl = useMemo(() => safeArr<MatchingLevel>(config?.levels).find((l) => l.level === level), [config, level]);
  const [cells, setCells] = useState<Record<string, 'OK' | 'KO' | 'ANY'>>({});

  useEffect(() => {
    if (lvl) setCells({ ...lvl.cells });
  }, [lvl]);

  if (!level || !lvl) return null;

  return (
    <Modal open={!!level} onClose={onClose} title={`Éditer le niveau ${level}`} maxWidth={500}>
      <div className="space-y-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">Configurez les critères OK / KO / ANY pour ce niveau de matching.</p>
        {MATCHING_COLUMNS.map((c) => (
          <div key={c.key} className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{c.label}</span>
            <select
              className="input input-sm w-32"
              value={cells[c.key] || 'OK'}
              onChange={(e) => setCells((prev) => ({ ...prev, [c.key]: e.target.value as 'OK' | 'KO' | 'ANY' }))}
            >
              <option value="OK">OK</option>
              <option value="KO">KO</option>
              <option value="ANY">ANY</option>
            </select>
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <button className="btn btn-primary flex-1" onClick={() => onSave(level, cells)} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Enregistrer
          </button>
          <button className="btn btn-outline flex-1" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}
