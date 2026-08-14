import { useEffect, useState } from 'react';
import {
  TrendingUp, Bell, AlertCircle, Clock, RefreshCw, Plus, Search,
  FileSpreadsheet, FileText, RotateCcw, Eye, ArrowUpDown, CreditCard,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { fmtMoney, fmtNum, fmtDate } from '../utils/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUTS = ['Payé', 'En attente', 'En retard', 'Partiel'];
const MODES = ['Virement', 'Chèque', 'Cash'];

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

function normalizePayment(raw: any, idx = 0): any {
  if (!raw || typeof raw !== 'object') return null;

  // Payment reference / number
  const payment_number = pickAny(
    raw.payment_number, raw.paymentNumber, raw.reference, raw.numero, raw.num, raw.code, raw.ref,
  );

  // Order reference (so we can group by order)
  const order_number = pickAny(
    raw.order_number, raw.orderNumber, raw.order_reference, raw.orderReference, raw.order_id, raw.orderId,
  );

  // Client name (could be nested object or flat string)
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

  // IDs
  const client_id = pickAny(raw.client_id, raw.clientId, raw.customer_id, raw.customerId, raw.company_id, raw.companyId);
  const order_id = pickAny(raw.order_id, raw.orderId);

  // Amounts
  const amount = pickMoney(
    raw.amount, raw.total, raw.total_amount, raw.totalAmount, raw.montant, raw.ca, raw.price, raw.value,
  );
  const paid_amount = pickMoney(
    raw.paid_amount, raw.paidAmount, raw.amount_paid, raw.amountPaid, raw.paye, raw.already_paid,
  );
  // If paid_amount is 0 but status is "Payé", assume fully paid
  // Compute remaining = max(0, amount - paid_amount) unless explicitly set
  const explicit_remaining = pickNum(raw.remaining, raw.reste, raw.balance_due, raw.balanceDue, raw.outstanding);
  const remaining = explicit_remaining !== undefined
    ? explicit_remaining
    : Math.max(0, amount - paid_amount);

  // Status (normalize to one of our known values)
  const rawStatus = safeLower(raw.status || raw.statut || raw.etat || raw.state || raw.payment_status);
  let status = 'En attente';
  if (rawStatus.includes('retard') || rawStatus.includes('late') || rawStatus.includes('overdue')) status = 'En retard';
  else if (rawStatus.includes('partiel') || rawStatus.includes('partial')) status = 'Partiel';
  else if (rawStatus.includes('paye') || rawStatus === 'paid' || rawStatus.includes('complet') || rawStatus.includes('completed')) status = 'Payé';
  else if (rawStatus.includes('attente') || rawStatus.includes('pending') || rawStatus.includes('wait')) status = 'En attente';
  else if (rawStatus.includes('impay') || rawStatus.includes('unpaid') || rawStatus.includes('failed')) status = 'En retard';

  // Auto-derive status from paid_amount if status is "En attente" but fully paid
  if (status === 'En attente' && amount > 0 && paid_amount >= amount) status = 'Payé';
  // Or partial if some amount was paid
  if (status === 'En attente' && paid_amount > 0 && paid_amount < amount) status = 'Partiel';

  // Payment mode / method
  const rawMode = safeLower(raw.payment_method || raw.paymentMethod || raw.method || raw.mode || raw.moyen);
  let payment_method = 'Virement';
  if (rawMode.includes('vir')) payment_method = 'Virement';
  else if (rawMode.includes('chèq') || rawMode.includes('cheq')) payment_method = 'Chèque';
  else if (rawMode.includes('cash') || rawMode.includes('espèce') || rawMode.includes('espece')) payment_method = 'Cash';

  // Dates
  const created_at = pickAny(raw.created_at, raw.createdAt, raw.date, raw.payment_date, raw.paymentDate);
  const updated_at = pickAny(raw.updated_at, raw.updatedAt, raw.modified_at);
  const paid_at = pickAny(raw.paid_at, raw.paidAt, raw.payment_date, raw.paymentDate, raw.date_paiement);
  const due_date = pickAny(raw.due_date, raw.dueDate, raw.echeance, raw.date_echeance, raw.deadline);

  // If no due_date, default to 30 days after created_at (common B2B terms)
  const dateRef = created_at || new Date();
  const computedDue = due_date || new Date(new Date(dateRef).getTime() + 30 * 86400000);

  // ID
  const _id = raw._id || raw.id || raw.uuid || `idx-${idx}`;

  return {
    ...raw,
    _id,
    payment_number: safeStr(payment_number),
    order_number: safeStr(order_number),
    order_id: safeStr(order_id),
    client_name: safeStr(client_name),
    client_id: safeStr(client_id),
    amount,
    paid_amount,
    remaining,
    status,
    payment_method,
    created_at,
    updated_at,
    paid_at,
    due_date: computedDue,
    dateRef,
  };
}

// ---------------------------------------------------------------------------
// STATUS BADGE
// ---------------------------------------------------------------------------

function statusBadge(status: string): { badge: string; dot: string; label: string } {
  const s = safeLower(status);
  if (s.includes('retard') || s.includes('late') || s.includes('overdue'))
    return { badge: 'badge-retard', dot: 'status-dot-retard', label: 'En retard' };
  if (s.includes('partiel') || s.includes('partial'))
    return { badge: 'badge-partiel', dot: 'status-dot-partiel', label: 'Partiel' };
  if (s.includes('paye') || s.includes('complet') || s === 'paid')
    return { badge: 'badge-paye', dot: 'status-dot-paye', label: 'Payé' };
  return { badge: 'badge-attente-paiement', dot: 'status-dot-attente', label: 'En attente' };
}

function modeBadge(mode: string): { badge: string; label: string } {
  const s = safeLower(mode);
  if (s.includes('vir')) return { badge: 'badge-virement', label: '🏦 Virement' };
  if (s.includes('chèq') || s.includes('cheq')) return { badge: 'badge-cheque', label: '📄 Chèque' };
  if (s.includes('cash') || s.includes('espèce') || s.includes('espece')) return { badge: 'badge-cash', label: '💵 Cash' };
  return { badge: 'badge-neutral', label: '—' };
}

// ===========================================================================
// COMPONENT
// ===========================================================================

export function Payments() {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [backendStats, setBackendStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [filters, setFilters] = useState({
    client: 'Tous', statut: 'Tous', mode: 'Tous', search: '',
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([
        api.getPayments(1, 200),
        api.getPaymentStats(),
      ]);
      const rawList = Array.isArray(l) ? l : (l?.data || []);
      const normalized = rawList.map(normalizePayment).filter(Boolean);
      setList(normalized);
      setBackendStats(s || {});
      setLastRefresh(new Date());
      if (normalized.length === 0) {
        toast('warning', 'Aucun paiement en base — ajoutez-en ou seed la collection payments.');
      }
    } catch (err) {
      toast('error', 'Impossible de charger les paiements');
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
  // FILTERS — applied locally on the normalized list (NULL-SAFE!)
  // ---------------------------------------------------------------------------
  const filtered = list.filter((p) => {
    const client = safeLower(p.client_name);
    const status = safeLower(p.status);
    const mode = safeLower(p.payment_method);
    const num = safeLower(p.order_number || p.payment_number);
    if (filters.client !== 'Tous' && !client.includes(filters.client.toLowerCase())) return false;
    if (filters.statut !== 'Tous' && !status.includes(filters.statut.toLowerCase())) return false;
    if (filters.mode !== 'Tous' && !mode.includes(filters.mode.toLowerCase())) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!num.includes(q) && !client.includes(q)) return false;
    }
    return true;
  });

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (filters.client !== 'Tous') activeFilters.push({ label: filters.client, clear: () => setF('client', 'Tous') });
  if (filters.statut !== 'Tous') activeFilters.push({ label: filters.statut, clear: () => setF('statut', 'Tous') });
  if (filters.mode !== 'Tous') activeFilters.push({ label: filters.mode, clear: () => setF('mode', 'Tous') });
  if (filters.search) activeFilters.push({ label: `"${filters.search}"`, clear: () => setF('search', '') });

  // ---------------------------------------------------------------------------
  // LOCAL KPI COMPUTATION — derived from the actual list, no fake fallbacks
  // ---------------------------------------------------------------------------
  const localStats = (() => {
    const payes = list.filter((p) => safeLower(p.status).includes('paye')).length;
    const enAttente = list.filter((p) => safeLower(p.status).includes('attente')).length;
    const enRetard = list.filter((p) => safeLower(p.status).includes('retard')).length;
    const partiels = list.filter((p) => safeLower(p.status).includes('partiel')).length;
    const montantPaye = list.reduce((sum, p) => sum + (Number(p.paid_amount) || 0), 0);
    const montantTotal = list.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const montantAttente = list
      .filter((p) => safeLower(p.status).includes('attente'))
      .reduce((sum, p) => sum + (Number(p.remaining) || 0), 0);
    const montantImpayes = list
      .filter((p) => safeLower(p.status).includes('retard'))
      .reduce((sum, p) => sum + (Number(p.remaining) || 0), 0);
    const tauxRecouv = montantTotal > 0 ? Math.round((montantPaye / montantTotal) * 100) : 0;
    // Average delay (days between created_at and paid_at, for paid items)
    const paidDelays = list
      .filter((p) => p.paid_at && p.created_at)
      .map((p) => (new Date(p.paid_at).getTime() - new Date(p.created_at).getTime()) / 86400000)
      .filter((d) => Number.isFinite(d) && d >= 0);
    const delaiMoyen = paidDelays.length > 0
      ? Math.round(paidDelays.reduce((a, b) => a + b, 0) / paidDelays.length)
      : 0;
    return {
      total: list.length,
      payes,
      enAttente,
      enRetard,
      partiels,
      montantPaye,
      montantTotal,
      montantAttente,
      montantImpayes,
      tauxRecouv,
      delaiMoyen,
    };
  })();

  const s = backendStats || {};
  const totalCmd = pickNum(s.total_commandes, s.total_orders, s.total, localStats.total) ?? 0;
  const montantPaye = pickMoney(s.montant_paye, s.paid_amount, s.totalPaid, s.total_paid, localStats.montantPaye);
  const enAttente = pickMoney(s.en_attente, s.pending_amount, s.totalPending, localStats.montantAttente);
  const impayes = pickMoney(s.impayes, s.overdue_amount, s.totalOverdue, localStats.montantImpayes);
  const tauxRecouv = pickNum(s.taux_recouvrement, s.recovery_rate, localStats.tauxRecouv) ?? 0;
  const delaiMoyen = pickNum(s.delai_moyen, s.avg_delay, s.avg_payment_delay, localStats.delaiMoyen) ?? 0;

  const clientNames = Array.from(
    new Set(list.map((p) => safeStr(p.client_name)).filter((n) => n.length > 0))
  ).sort();

  const retardItems = filtered.filter((p) => safeLower(p.status).includes('retard'));
  const upcomingItems = filtered.filter((p) => {
    const due = p.due_date;
    if (!due) return false;
    const dueTime = new Date(due).getTime();
    if (!Number.isFinite(dueTime)) return false;
    const days = (dueTime - Date.now()) / 86400000;
    return days > 0 && days <= 7;
  });

  // ---------------------------------------------------------------------------
  // EXPORT — real CSV / Excel from filtered list
  // ---------------------------------------------------------------------------
  const exportCSV = () => {
    const headers = ['# Commande', 'Client', 'Montant', 'Payé', 'Reste', 'Échéance', 'Statut', 'Mode'];
    const rows = filtered.map((p) => [
      p.order_number || p.payment_number, p.client_name, p.amount, p.paid_amount,
      p.remaining, fmtDate(p.due_date), p.status, p.payment_method,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paiements-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', `${filtered.length} paiements exportés en CSV`);
  };

  const exportExcel = () => {
    const headers = ['# Commande', 'Client', 'Montant', 'Payé', 'Reste', 'Échéance', 'Statut', 'Mode'];
    const rows = filtered.map((p) => [
      p.order_number || p.payment_number, p.client_name, p.amount, p.paid_amount,
      p.remaining, fmtDate(p.due_date), p.status, p.payment_method,
    ]);
    const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((cell) => `<td>${String(cell ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `paiements-${new Date().toISOString().slice(0, 10)}.xls`;
    a.click();
    URL.revokeObjectURL(url);
    toast('success', `${filtered.length} paiements exportés en Excel`);
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      order_number: String(fd.get('order_number') || ''),
      client_name: String(fd.get('client_name') || ''),
      paid_amount: parseFloat(String(fd.get('paid_amount') || '0')) || 0,
      payment_method: String(fd.get('payment_method') || 'Virement'),
      paid_at: String(fd.get('paid_at') || new Date().toISOString().slice(0, 10)),
    };
    if (!payload.order_number.trim()) {
      toast('error', 'Le numéro de commande est obligatoire');
      return;
    }
    try {
      if (api.createPayment) await api.createPayment(payload);
      toast('success', 'Paiement enregistré avec succès');
      setCreateOpen(false);
      fetchAll();
    } catch {
      toast('error', 'Enregistrement impossible');
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Paiements</h1>
          <p className="text-sm text-gray-500">Suivi complet des paiements et échéances</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={fetchAll}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}>
            <Plus className="w-3 h-3" /> Enregistrer un paiement
          </button>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ============= KPIs ============= */}
      <div className="section-title"><TrendingUp className="w-4 h-4" /> Indicateurs de Synthèse</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div className="kpi-card">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Total Paiements</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(totalCmd, '', '0')}</p>
          <p className="text-[10px] text-blue-600">{localStats.payes > 0 ? `${localStats.payes} payés` : '—'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-green-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Montant Payé</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(montantPaye, '0 €')}</p>
          <p className="text-[10px] text-green-600">{localStats.montantTotal > 0 ? `${Math.round((montantPaye / localStats.montantTotal) * 100)}% du total` : '—'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-yellow-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">En Attente</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(enAttente, '0 €')}</p>
          <p className="text-[10px] text-yellow-600">{localStats.enAttente > 0 ? `${localStats.enAttente} paiement(s)` : '—'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-red-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Impayés (&gt;30j)</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(impayes, '0 €')}</p>
          <p className="text-[10px] text-red-600">{localStats.enRetard > 0 ? `${localStats.enRetard} en retard` : '—'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-indigo-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux Recouvrement</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{tauxRecouv}%</p>
          <p className="text-[10px] text-green-600">{tauxRecouv >= 80 ? 'Bon' : tauxRecouv >= 50 ? 'Moyen' : 'Faible'}</p>
        </div>
        <div className="kpi-card border-l-4 border-l-purple-500">
          <p className="text-[10px] text-gray-500 uppercase tracking-wide">Délai Moyen</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(delaiMoyen, '', '0')} j</p>
          <p className="text-[10px] text-blue-600">{delaiMoyen > 0 ? `Moy. paiement` : '—'}</p>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ============= ALERTES ============= */}
      <div className="section-title"><Bell className="w-4 h-4" /> Alertes & Échéances</div>
      <div className="space-y-2 mb-6">
        <div className="alert-card danger flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">🔴 Paiements en retard ({retardItems.length})</p>
            {retardItems.slice(0, 3).map((p, i) => (
              <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
                Commande #{safeStr(p.order_number || p.payment_number)} - {safeStr(p.client_name) || '—'} - {fmtMoney(p.amount)} - Échue le {fmtDate(p.due_date)}
              </p>
            ))}
            {retardItems.length === 0 && <p className="text-xs text-gray-500">Aucun retard actuellement</p>}
            <button className="btn btn-danger btn-xs mt-1" onClick={() => setF('statut', 'En retard')}>Voir tout</button>
          </div>
        </div>
        <div className="alert-card warning flex items-start gap-3">
          <Clock className="w-5 h-5 text-yellow-500 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">🟡 Échéances à venir (J-7)</p>
            {upcomingItems.slice(0, 3).map((p, i) => (
              <p key={i} className="text-xs text-gray-600 dark:text-gray-400">
                Commande #{safeStr(p.order_number || p.payment_number)} - {safeStr(p.client_name) || '—'} - {fmtMoney(p.amount)} - Échéance le {fmtDate(p.due_date)}
              </p>
            ))}
            {upcomingItems.length === 0 && <p className="text-xs text-gray-500">Aucune échéance imminente</p>}
            <button className="btn btn-warning btn-xs mt-1" onClick={() => toast('info', 'Filtrer par échéance à venir')}>Voir tout</button>
          </div>
        </div>
      </div>

      <hr className="section-divider" />

      {/* ============= TABLE ============= */}
      <div className="section-title"><CreditCard className="w-4 h-4" /> Suivi des paiements par commande</div>

      <div className="card p-3 mb-4">
        <div className="filter-group-payments">
          <div>
            <label>Client</label>
            <select value={filters.client} onChange={(e) => setF('client', e.target.value)}>
              <option>Tous</option>
              {clientNames.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label>Statut</label>
            <select value={filters.statut} onChange={(e) => setF('statut', e.target.value)}>
              <option>Tous</option>
              {STATUTS.map((st) => <option key={st}>{st}</option>)}
            </select>
          </div>
          <div>
            <label>Mode de paiement</label>
            <select value={filters.mode} onChange={(e) => setF('mode', e.target.value)}>
              <option>Tous</option>
              {MODES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label>Recherche</label>
            <input
              placeholder="#Commande, client..."
              value={filters.search}
              onChange={(e) => setF('search', e.target.value)}
            />
          </div>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => toast('success', 'Filtres appliqués')}>
              <Search className="w-3 h-3" /> Filtrer
            </button>
            <button className="btn btn-outline btn-sm" onClick={() => setFilters({ client: 'Tous', statut: 'Tous', mode: 'Tous', search: '' })}>
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

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-500">
          <span className="font-semibold text-gray-700 dark:text-gray-300">{filtered.length}</span> paiements affichés
          {backendStats?._source === 'fallback' && (
            <span className="ml-2 text-xs text-amber-500">(stats calculées localement)</span>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={exportCSV}><FileSpreadsheet className="w-3 h-3" /> CSV</button>
          <button className="btn btn-outline btn-sm" onClick={exportExcel}><FileText className="w-3 h-3" /> Excel</button>
        </div>
      </div>

      <div className="payments-table-container">
        <table>
          <thead>
            <tr>
              <th>#Commande <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Client <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Montant <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Payé <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Reste <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Échéance <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Statut <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Mode <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-gray-400 py-8">Aucun paiement pour ces filtres</td></tr>
            ) : (
              paginated.map((p, i) => {
                const st = statusBadge(p.status);
                const md = modeBadge(p.payment_method);
                return (
                  <tr key={p._id || i}>
                    <td className="font-medium">#{safeStr(p.order_number || p.payment_number) || '—'}</td>
                    <td>{safeStr(p.client_name) || '—'}</td>
                    <td className="font-semibold">{fmtMoney(p.amount, '0 €')}</td>
                    <td className="text-green-600">{fmtMoney(p.paid_amount, '0 €')}</td>
                    <td className={p.remaining > 0 ? 'text-red-600' : 'text-gray-400'}>{fmtMoney(p.remaining, '0 €')}</td>
                    <td><span className="text-xs">{fmtDate(p.due_date)}</span></td>
                    <td><span className={`badge ${st.badge}`}><span className={`status-dot ${st.dot}`} />{st.label}</span></td>
                    <td><span className={`badge ${md.badge}`}>{md.label}</span></td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => { setSelected(p); setDetailOpen(true); }}><Eye className="w-3 h-3" /></button>
                      <button className="btn btn-success btn-xs ml-1" onClick={() => { setSelected(p); setCreateOpen(true); }}><Plus className="w-3 h-3" /></button>
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
          Affichage {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} sur {filtered.length} paiements
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
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Détail paiement">
        {selected && (
          <div className="modal-section">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">💳 Informations paiement</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div><div className="label">N° Commande</div><div className="value">#{safeStr(selected.order_number || selected.payment_number) || '—'}</div></div>
              <div><div className="label">Client</div><div className="value">{safeStr(selected.client_name) || '—'}</div></div>
              <div><div className="label">Statut</div><div className="value"><span className={`badge ${statusBadge(selected.status).badge}`}>{statusBadge(selected.status).label}</span></div></div>
              <div><div className="label">Montant</div><div className="value">{fmtMoney(selected.amount, '0 €')}</div></div>
              <div><div className="label">Payé</div><div className="value text-green-600">{fmtMoney(selected.paid_amount, '0 €')}</div></div>
              <div><div className="label">Reste</div><div className="value text-red-600">{fmtMoney(selected.remaining, '0 €')}</div></div>
              <div><div className="label">Échéance</div><div className="value">{fmtDate(selected.due_date)}</div></div>
              <div><div className="label">Mode</div><div className="value"><span className={`badge ${modeBadge(selected.payment_method).badge}`}>{modeBadge(selected.payment_method).label}</span></div></div>
              <div><div className="label">Date paiement</div><div className="value">{selected.paid_at ? fmtDate(selected.paid_at) : '—'}</div></div>
            </div>
          </div>
        )}
      </Modal>

      {/* ============= MODAL CREATE ============= */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Enregistrer un paiement" maxWidth={600}>
        <form onSubmit={handleCreate}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">N° Commande *</label>
              <input
                name="order_number"
                className="input mt-1"
                placeholder="#42"
                defaultValue={selected ? safeStr(selected.order_number) : ''}
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Client</label>
              <input
                name="client_name"
                className="input mt-1"
                placeholder="Nom du client"
                defaultValue={selected ? safeStr(selected.client_name) : ''}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Montant payé</label>
                <input name="paid_amount" type="number" min="0" step="0.01" className="input mt-1" placeholder="0 €" required />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Mode</label>
                <select name="payment_method" className="input mt-1">{MODES.map((m) => <option key={m}>{m}</option>)}</select>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Date</label>
              <input name="paid_at" type="date" className="input mt-1" defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" className="btn btn-primary flex-1">Enregistrer</button>
              <button type="button" className="btn btn-outline flex-1" onClick={() => setCreateOpen(false)}>Annuler</button>
            </div>
          </div>
        </form>
      </Modal>
    </section>
  );
}
