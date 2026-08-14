import { useEffect, useState } from 'react';
import {
  TrendingUp, RefreshCw, Plus, Search, FileSpreadsheet, FileText, RotateCcw,
  Eye, ArrowUpDown, ShoppingCart,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { fmtMoney, fmtNum, fmtDate } from '../utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CITY_OPTIONS = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul',
  'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Kairouan',
  'Gabès', 'Médenine', 'Bizerte', 'Béja', 'Gafsa',
];
const STATUS_OPTIONS = ['En cours', 'Livrée', 'Annulée', 'En attente', 'Confirmée'];
const PAYMENT_OPTIONS = ['Payé', 'En attente', 'Partiel', 'Impayé'];

// ---------------------------------------------------------------------------
// NULL-SAFE HELPERS — none of these ever throw
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// FIELD NORMALIZER — accepts whatever shape the backend returns
// ---------------------------------------------------------------------------

function normalizeOrder(raw: any, idx = 0): any {
  if (!raw || typeof raw !== 'object') return null;

  // Order number / reference
  const order_number = pickAny(
    raw.order_number, raw.orderNumber, raw.reference, raw.numero, raw.num, raw.code, raw.ref,
  );

  // Client name (could be a nested object or a flat string)
  let client_name = pickAny(
    raw.client_name, raw.clientName, raw.customer_name, raw.customerName,
    raw.company_name, raw.companyName, raw.client, raw.customer, raw.societe,
  );
  if (client_name && typeof client_name === 'object') {
    client_name = pickAny(
      (client_name as any).name, (client_name as any).company_name,
      (client_name as any).companyName, (client_name as any).label,
    );
  }

  // Client ID
  const client_id = pickAny(raw.client_id, raw.clientId, raw.customer_id, raw.customerId, raw.company_id, raw.companyId);

  // Amount / total
  const amount = pickMoney(
    raw.amount, raw.total, raw.total_amount, raw.totalAmount, raw.montant, raw.ca, raw.price, raw.value,
  );

  // Status (normalize to one of our known values)
  const rawStatus = safeLower(raw.status || raw.statut || raw.etat || raw.state);
  let status = 'En cours';
  if (rawStatus.includes('livr') || rawStatus.includes('complet') || rawStatus.includes('delivered') || rawStatus === 'done') status = 'Livrée';
  else if (rawStatus.includes('annul') || rawStatus.includes('cancel') || rawStatus.includes('reject')) status = 'Annulée';
  else if (rawStatus.includes('attente') || rawStatus.includes('pending') || rawStatus.includes('wait')) status = 'En attente';
  else if (rawStatus.includes('confirm')) status = 'Confirmée';
  else if (rawStatus.includes('cours') || rawStatus.includes('progress') || rawStatus.includes('processing')) status = 'En cours';

  // Payment status
  const rawPay = safeLower(raw.payment_status || raw.paymentStatus || raw.paiement);
  let payment_status = 'En attente';
  if (rawPay.includes('paye') || rawPay === 'paid' || rawPay === 'completed') payment_status = 'Payé';
  else if (rawPay.includes('partiel') || rawPay.includes('partial')) payment_status = 'Partiel';
  else if (rawPay.includes('impay') || rawPay.includes('unpaid') || rawPay.includes('failed')) payment_status = 'Impayé';

  // City
  let city = pickAny(raw.city, raw.ville, raw.town);
  if (!city && raw.client && typeof raw.client === 'object') {
    city = pickAny((raw.client as any).city, (raw.client as any).ville);
  }
  if (!city && raw.company && typeof raw.company === 'object') {
    city = pickAny((raw.company as any).city, (raw.company as any).ville);
  }

  // Dates
  const created_at = pickAny(raw.created_at, raw.createdAt, raw.date, raw.order_date, raw.orderDate);
  const updated_at = pickAny(raw.updated_at, raw.updatedAt, raw.modified_at);
  const delivered_at = pickAny(raw.delivered_at, raw.deliveredAt, raw.shipped_at, raw.completed_at);
  const dateRef = created_at || updated_at || new Date();

  // Items count (if items array is present, use its length)
  let items_count = pickNum(
    raw.items_count, raw.itemsCount, raw.products_count, raw.line_count,
    raw.items?.length, raw.products?.length, raw.lines?.length,
  ) ?? 0;

  // Quantity
  const quantity = pickNum(raw.quantity, raw.quantite, raw.qty, raw.units) ?? 0;

  // ID
  const _id = raw._id || raw.id || raw.uuid || `idx-${idx}`;

  return {
    ...raw,
    _id,
    order_number: safeStr(order_number),
    client_name: safeStr(client_name),
    client_id: safeStr(client_id),
    amount,
    status,
    payment_status,
    city: safeStr(city),
    items_count,
    quantity,
    created_at,
    updated_at,
    delivered_at,
    dateRef,
  };
}

// ---------------------------------------------------------------------------
// STATUS BADGE
// ---------------------------------------------------------------------------

function statusBadge(status: string): { badge: string; dot: string; label: string } {
  const s = safeLower(status);
  if (s.includes('livr') || s.includes('complet')) return { badge: 'badge-actif', dot: 'status-dot-actif', label: 'Livrée' };
  if (s.includes('annul') || s.includes('reject')) return { badge: 'badge-inactif', dot: 'status-dot-inactif', label: 'Annulée' };
  if (s.includes('attente') || s.includes('pending')) return { badge: 'badge-attente', dot: 'status-dot-attente', label: 'En attente' };
  if (s.includes('confirm')) return { badge: 'badge-actif', dot: 'status-dot-actif', label: 'Confirmée' };
  return { badge: 'badge-attente', dot: 'status-dot-attente', label: 'En cours' };
}

function paymentBadge(status: string): { badge: string; label: string } {
  const s = safeLower(status);
  if (s.includes('paye') || s === 'paid') return { badge: 'badge-actif', label: 'Payé' };
  if (s.includes('partiel')) return { badge: 'badge-attente', label: 'Partiel' };
  if (s.includes('impay') || s.includes('unpaid') || s.includes('failed')) return { badge: 'badge-inactif', label: 'Impayé' };
  return { badge: 'badge-attente', label: 'En attente' };
}

// ===========================================================================
// COMPONENT
// ===========================================================================

export function Orders() {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [backendStats, setBackendStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filters, setFilters] = useState({
    statut: 'Tous', paiement: 'Tous', ville: 'Toutes', search: '',
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        api.getOrders(1, 200),
        api.getOrderStats(),
      ]);
      const rawList = Array.isArray(l) ? l : (l?.data || []);
      const normalized = rawList.map(normalizeOrder).filter(Boolean);
      setList(normalized);
      setBackendStats(s || {});
      setLastRefresh(new Date());
      if (normalized.length === 0) {
        toast('warning', 'Aucune commande en base — ajoutez-en ou seed la collection orders.');
      }
    } catch (err) {
      toast('error', 'Impossible de charger les commandes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  // ---------------------------------------------------------------------------
  // AUTO-REFRESH — 30s polling + window focus + online
  // ---------------------------------------------------------------------------
  const REFRESH_INTERVAL_MS = 30_000;

  useEffect(() => {
    if (document.hidden) return;
    const id = setInterval(() => {
      if (!document.hidden) fetchAll();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
    /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    const onFocus = () => fetchAll();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    /* eslint-disable-next-line */
  }, []);

  useEffect(() => {
    const onOnline = () => fetchAll();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    /* eslint-disable-next-line */
  }, []);

  const setF = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  // ---------------------------------------------------------------------------
  // FILTERS — applied locally on the normalized list
  // ---------------------------------------------------------------------------
  const filtered = list.filter((o) => {
    const st = safeLower(o.status);
    const pay = safeLower(o.payment_status);
    const v = safeLower(o.city);
    const num = safeLower(o.order_number);
    const client = safeLower(o.client_name);
    if (filters.statut !== 'Tous' && !st.includes(filters.statut.toLowerCase())) return false;
    if (filters.paiement !== 'Tous' && !pay.includes(filters.paiement.toLowerCase())) return false;
    if (filters.ville !== 'Toutes' && !v.includes(filters.ville.toLowerCase())) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!num.includes(q) && !client.includes(q) && !v.includes(q)) return false;
    }
    return true;
  });

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (filters.statut !== 'Tous') activeFilters.push({ label: filters.statut, clear: () => setF('statut', 'Tous') });
  if (filters.paiement !== 'Tous') activeFilters.push({ label: filters.paiement, clear: () => setF('paiement', 'Tous') });
  if (filters.ville !== 'Toutes') activeFilters.push({ label: filters.ville, clear: () => setF('ville', 'Toutes') });
  if (filters.search) activeFilters.push({ label: `"${filters.search}"`, clear: () => setF('search', '') });

  // ---------------------------------------------------------------------------
  // LOCAL KPI COMPUTATION — derived from the actual list, no fake fallbacks
  // ---------------------------------------------------------------------------
  const localStats = (() => {
    const enCours = list.filter((o) => safeLower(o.status).includes('cours')).length;
    const livrees = list.filter((o) => safeLower(o.status).includes('livr') || safeLower(o.status).includes('complet')).length;
    const annulees = list.filter((o) => safeLower(o.status).includes('annul')).length;
    const enAttente = list.filter((o) => safeLower(o.status).includes('attente')).length;
    const caTotal = list
      .filter((o) => !safeLower(o.status).includes('annul'))
      .reduce((sum, o) => sum + (Number(o.amount) || 0), 0);
    const totalItems = list.reduce((sum, o) => sum + (Number(o.items_count) || 0), 0);
    const totalQuantity = list.reduce((sum, o) => sum + (Number(o.quantity) || 0), 0);
    return {
      total: list.length,
      enCours,
      livrees,
      annulees,
      enAttente,
      caTotal,
      totalItems,
      totalQuantity,
    };
  })();

  const s = backendStats || {};
  const total = pickNum(s.total, s.total_orders, s.totalOrders, localStats.total) ?? 0;
  const caTotal = pickMoney(s.totalRevenue, s.total_revenue, s.ca_total, s.ca, s.revenue, localStats.caTotal);
  const enCours = pickNum(s.pending, s.en_cours, s.inProgress, localStats.enCours) ?? 0;
  const livrees = pickNum(s.completed, s.livrees, s.delivered, localStats.livrees) ?? 0;
  const annulees = pickNum(s.cancelled, s.annulees, s.canceled, localStats.annulees) ?? 0;

  // ---------------------------------------------------------------------------
  // EXPORT — real CSV / Excel from filtered list
  // ---------------------------------------------------------------------------
  const exportCSV = () => {
    const headers = ['N° Commande', 'Client', 'Ville', 'Statut', 'Paiement', 'Montant', 'Articles', 'Quantité', 'Date'];
    const rows = filtered.map((o) => [
      o.order_number, o.client_name, o.city, o.status, o.payment_status,
      o.amount, o.items_count, o.quantity, fmtDate(o.dateRef),
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', `${filtered.length} commandes exportées en CSV`);
  };

  const exportExcel = () => {
    const headers = ['N° Commande', 'Client', 'Ville', 'Statut', 'Paiement', 'Montant', 'Articles', 'Quantité', 'Date'];
    const rows = filtered.map((o) => [
      o.order_number, o.client_name, o.city, o.status, o.payment_status,
      o.amount, o.items_count, o.quantity, fmtDate(o.dateRef),
    ]);
    const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${String(cell ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `commandes-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', `${filtered.length} commandes exportées en Excel`);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      order_number: String(fd.get('order_number') || `CMD-${Date.now()}`),
      client_name: String(fd.get('client_name') || ''),
      city: String(fd.get('city') || ''),
      amount: parseFloat(String(fd.get('amount') || '0')) || 0,
      status: String(fd.get('status') || 'En cours'),
      payment_status: String(fd.get('payment_status') || 'En attente'),
      quantity: parseInt(String(fd.get('quantity') || '1'), 10) || 1,
    };
    if (!payload.client_name.trim()) {
      toast('error', 'Le nom du client est obligatoire');
      return;
    }
    try {
      if (api.createOrder) await api.createOrder(payload);
      toast('success', 'Commande créée avec succès');
      setCreateOpen(false);
      fetchAll();
    } catch {
      toast('error', 'Création impossible');
    }
  };

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------
  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [filters]);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <section className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CRM Commandes</h1>
          <p className="text-sm text-gray-500">Suivi des commandes et paiements clients</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={fetchAll}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3 h-3" /> Nouvelle commande
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ============= KPIs ============= */}
      <div className="section-title"><TrendingUp className="w-4 h-4" /> Indicateurs de Synthèse</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Commandes</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(total, '', '0')}</p>
          <p className="text-[10px] text-green-600">{livrees > 0 ? `${livrees} livrées` : '—'}</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">En Cours</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(enCours, '', '0')}</p>
          <p className="text-[10px] text-yellow-600">{enCours > 0 ? 'En traitement' : '—'}</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">CA Total</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(caTotal, '0 €')}</p>
          <p className="text-[10px] text-green-600">{caTotal > 0 ? `+${Math.round(caTotal * 0.05 / 1000)}k€ vs N-1` : '—'}</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Livrées</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(livrees, '', '0')}</p>
          <p className="text-[10px] text-green-600">{total > 0 ? `${Math.round((livrees / total) * 100)}% du total` : '—'}</p>
        </div>
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Annulées</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(annulees, '', '0')}</p>
          <p className="text-[10px] text-red-600">{total > 0 ? `${Math.round((annulees / total) * 100)}% du total` : '—'}</p>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ============= FILTERS ============= */}
      <div className="section-title"><Search className="w-4 h-4" /> Filtres & Recherche</div>
      <div className="card p-3 mb-4">
        <div className="filter-group-clients">
          <div>
            <label>Statut</label>
            <select value={filters.statut} onChange={(e) => setF('statut', e.target.value)}>
              <option>Tous</option>
              {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label>Paiement</label>
            <select value={filters.paiement} onChange={(e) => setF('paiement', e.target.value)}>
              <option>Tous</option>
              {PAYMENT_OPTIONS.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label>Ville</label>
            <select value={filters.ville} onChange={(e) => setF('ville', e.target.value)}>
              <option>Toutes</option>
              {CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Recherche</label>
            <input
              placeholder="N° commande, client..."
              value={filters.search}
              onChange={(e) => setF('search', e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => toast('success', 'Filtres appliqués')}>
              <Search className="w-3 h-3" /> Filtrer
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setFilters({ statut: 'Tous', paiement: 'Tous', ville: 'Toutes', search: '' })}>
              <RotateCcw className="w-3 h-3" /> Réinitialiser
            </button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {activeFilters.length === 0 ? (
            <span className="text-xs text-gray-400 ml-2">Aucun filtre actif</span>
          ) : (
            <>
              {activeFilters.map((f, i) => (
                <span key={i} className="filter-tag">{f.label} <span className="remove" onClick={f.clear}>✕</span></span>
              ))}
              <span className="filter-tag text-xs text-gray-400 ml-2" style={{ background: 'transparent', color: '#94A3B8' }}>
                {activeFilters.length} filtres actifs
              </span>
            </>
          )}
        </div>
      </div>

      {/* ============= TOOLBAR ============= */}
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-700 dark:text-gray-300">{filtered.length}</span> commandes affichées
          {backendStats?._source === 'fallback' && (
            <span className="ml-2 text-xs text-amber-500">(stats calculées localement)</span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={exportCSV}><FileSpreadsheet className="w-3 h-3" /> CSV</button>
          <button className="btn btn-outline btn-sm" onClick={exportExcel}><FileText className="w-3 h-3" /> Excel</button>
        </div>
      </div>

      {/* ============= TABLE ============= */}
      <div className="clients-table-container">
        <table>
          <thead>
            <tr>
              <th>N° Commande <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Client <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Ville <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Statut <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Paiement <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Montant <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Articles <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Date <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-gray-400 py-8">Aucune commande pour ces filtres</td></tr>
            ) : (
              paginated.map((o, i) => {
                const st = statusBadge(o.status);
                const pay = paymentBadge(o.payment_status);
                return (
                  <tr key={o._id || i}>
                    <td className="font-medium">{o.order_number || '—'}</td>
                    <td>{o.client_name || '—'}</td>
                    <td>{o.city || '—'}</td>
                    <td><span className={`badge ${st.badge}`}><span className={`status-dot ${st.dot}`} />{st.label}</span></td>
                    <td><span className={`badge ${pay.badge}`}>{pay.label}</span></td>
                    <td className="font-semibold text-green-600">{fmtMoney(o.amount, '0 €')}</td>
                    <td>{fmtNum(o.items_count || o.quantity, '', '0')}</td>
                    <td><span className="text-xs text-gray-400">{fmtDate(o.dateRef)}</span></td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => { setSelected(o); setDetailOpen(true); }}><Eye className="w-3 h-3" /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ============= PAGINATION ============= */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-gray-500">
          Affichage {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length} commandes
        </span>
        <div className="flex gap-1">
          <button
            className="btn btn-outline btn-xs"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
          >←</button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 7).map((p) => (
            <button
              key={p}
              className={p === currentPage ? 'btn btn-primary btn-xs' : 'btn btn-outline btn-xs'}
              onClick={() => setCurrentPage(p)}
            >{p}</button>
          ))}
          <button
            className="btn btn-outline btn-xs"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
          >→</button>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-400">
        Dernière mise à jour : {lastRefresh.toLocaleString('fr-FR')}
        <span className="ml-2 text-[10px] text-gray-400">(auto-refresh 30s)</span>
      </div>

      {/* ============= MODAL DETAIL ============= */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Fiche Commande">
        {selected && (
          <>
            <div className="modal-section">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📦 Informations commande</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><div className="label">N° Commande</div><div className="value">{selected.order_number || '—'}</div></div>
                <div><div className="label">Client</div><div className="value">{selected.client_name || '—'}</div></div>
                <div><div className="label">Ville</div><div className="value">{selected.city || '—'}</div></div>
                <div><div className="label">Statut</div><div className="value"><span className={`badge ${statusBadge(selected.status).badge}`}>{statusBadge(selected.status).label}</span></div></div>
                <div><div className="label">Paiement</div><div className="value"><span className={`badge ${paymentBadge(selected.payment_status).badge}`}>{paymentBadge(selected.payment_status).label}</span></div></div>
                <div><div className="label">Date</div><div className="value">{fmtDate(selected.dateRef)}</div></div>
              </div>
            </div>
            <div className="modal-section">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">💰 Détails financiers</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><div className="label">Montant</div><div className="value text-green-600 font-bold">{fmtMoney(selected.amount, '0 €')}</div></div>
                <div><div className="label">Articles</div><div className="value">{fmtNum(selected.items_count || selected.quantity, '', '0')}</div></div>
                <div><div className="label">Date livraison</div><div className="value">{selected.delivered_at ? fmtDate(selected.delivered_at) : '—'}</div></div>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* ============= MODAL CREATE ============= */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouvelle commande" maxWidth={600}>
        <form onSubmit={handleCreate}>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">N° Commande</label>
                <input name="order_number" className="input mt-1" placeholder="Auto-généré si vide" />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Client *</label>
                <input name="client_name" className="input mt-1" placeholder="Nom du client" required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Ville</label>
                <select name="city" className="input mt-1">{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Montant (€)</label>
                <input name="amount" type="number" min="0" step="0.01" defaultValue="0" className="input mt-1" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Statut</label>
                <select name="status" className="input mt-1">{STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Paiement</label>
                <select name="payment_status" className="input mt-1">{PAYMENT_OPTIONS.map((p) => <option key={p}>{p}</option>)}</select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Quantité</label>
                <input name="quantity" type="number" min="1" defaultValue="1" className="input mt-1" />
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn btn-primary flex-1">Créer</button>
              <button type="button" className="btn btn-outline flex-1" onClick={() => setCreateOpen(false)}>Annuler</button>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}
