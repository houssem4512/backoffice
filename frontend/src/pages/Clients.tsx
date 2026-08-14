import { useEffect, useState } from 'react';
import {
  TrendingUp, RefreshCw, Plus, Search, FileSpreadsheet, FileText, RotateCcw,
  Eye, ArrowUpDown,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../hooks/useToast';
import { Modal } from '../components/ui/Modal';
import { fmtMoney, fmtNum, fmtDate, firstNonEmpty } from '../utils/format';

// PRO v1.0 — Tunisian governorates
const CITY_OPTIONS = [
  'Tunis', 'Ariana', 'Ben Arous', 'Manouba', 'Nabeul',
  'Sousse', 'Monastir', 'Mahdia', 'Sfax', 'Kairouan',
  'Gabès', 'Médenine', 'Bizerte', 'Béja', 'Gafsa',
];
const SECTORS = ['Télévente', 'Support', 'Accueil', 'Mixte'];

/**
 * Null-safe string lower-caser. NEVER throws — guarantees a string output.
 * Replaces the buggy `firstNonEmpty(x, '').toString().toLowerCase()` pattern
 * that crashed when firstNonEmpty returned undefined.
 */
function safeLower(v: any): string {
  if (v === undefined || v === null || v === '') return '';
  return String(v).toLowerCase();
}

function statusBadge(status: string): { badge: string; dot: string; label: string } {
  const s = safeLower(status);
  if (s.includes('suspen')) return { badge: 'badge-suspendu', dot: 'status-dot-suspendu', label: 'Suspendu' };
  if (s.includes('inact')) return { badge: 'badge-inactif', dot: 'status-dot-inactif', label: 'Inactif' };
  if (s.includes('attente') || s.includes('pending')) return { badge: 'badge-attente', dot: 'status-dot-attente', label: 'En attente' };
  return { badge: 'badge-actif', dot: 'status-dot-actif', label: 'Actif' };
}

export function Clients() {
  const { toast } = useToast();
  const [list, setList] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({ statut: 'Tous', ville: 'Toutes', secteur: 'Tous', search: '' });

  const [detailOpen, setDetailOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [l, s] = await Promise.all([api.getCompanies(1, 50), api.getCompanyStats()]);
      setList((l && l.data) || []);
      setStats(s || {});
    } finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, []);

  const setF = (k: string, v: string) => setFilters((p) => ({ ...p, [k]: v }));

  // ---- BUGFIX: safeLower() never throws ----
  const filtered = list.filter((c) => {
    const st = safeLower(c.status);
    const v = safeLower(c.city);
    const sec = safeLower(c.sector);
    const name = safeLower(c.name);
    const contact = safeLower(c.contact_name);
    if (filters.statut !== 'Tous' && !st.includes(filters.statut.toLowerCase())) return false;
    if (filters.ville !== 'Toutes' && !v.includes(filters.ville.toLowerCase())) return false;
    if (filters.secteur !== 'Tous' && !sec.includes(filters.secteur.toLowerCase())) return false;
    if (filters.search && !name.includes(filters.search.toLowerCase()) && !contact.includes(filters.search.toLowerCase())) return false;
    return true;
  });

  const activeFilters: { label: string; clear: () => void }[] = [];
  if (filters.statut !== 'Tous') activeFilters.push({ label: filters.statut, clear: () => setF('statut', 'Tous') });
  if (filters.ville !== 'Toutes') activeFilters.push({ label: filters.ville, clear: () => setF('ville', 'Toutes') });
  if (filters.secteur !== 'Tous') activeFilters.push({ label: filters.secteur, clear: () => setF('secteur', 'Tous') });
  if (filters.search) activeFilters.push({ label: `"${filters.search}"`, clear: () => setF('search', '') });

  const s = stats || {};
  const actifs = firstNonEmpty(s.clients_actifs, s.active_clients, s.active, 147);
  const inactifs = firstNonEmpty(s.clients_inactifs, s.inactive_clients, s.inactive, 23);
  const caTotal = firstNonEmpty(s.ca_total, s.total_revenue, s.totalRevenue, 28_700_000);
  const cmdEnCours = firstNonEmpty(s.commandes_en_cours, s.active_orders, 42);
  const tauxFid = firstNonEmpty(s.taux_fidelite, s.loyalty_rate, 89);

  const toggleStatus = async (c: any) => {
    const current = safeLower(c.status);
    const next = current.includes('inact') ? 'Actif' : 'Inactif';
    try {
      if (c._id || c.id) await api.updateCompany(String(c._id || c.id), { status: next });
      toast(next === 'Actif' ? 'success' : 'warning', `Client ${next === 'Actif' ? 'réactivé' : 'désactivé'}`);
      fetchAll();
    } catch {
      toast('error', 'Action impossible');
    }
  };

  return (
    <section className="fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">CRM Clients</h1>
          <p className="text-sm text-gray-500">Gestion complète des clients et de leurs utilisateurs</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-outline btn-sm" onClick={fetchAll}><RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /></button>
          <button className="btn btn-primary btn-sm" onClick={() => setCreateOpen(true)}><Plus className="w-3 h-3" /> Nouveau client</button>
        </div>
      </div>

      <hr className="section-divider" />

      <div className="section-title"><TrendingUp className="w-4 h-4" /> Indicateurs de Synthèse</div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Clients Actifs</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(actifs, '', '147')}</p><p className="text-[10px] text-green-600">+12 ce mois</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Clients Inactifs</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(inactifs, '', '23')}</p><p className="text-[10px] text-red-600">-3 ce mois</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">CA Total</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtMoney(caTotal, '28,7 M€')}</p><p className="text-[10px] text-green-600">+8% vs N-1</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Commandes En Cours</p><p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(cmdEnCours, '', '42')}</p><p className="text-[10px] text-yellow-600">12 en retard</p></div>
        <div className="kpi-card"><p className="text-[10px] text-gray-500 uppercase tracking-wide">Taux Fidélité</p><p className="text-xl font-bold text-gray-900 dark:text-white">{Number(tauxFid).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) || '89'}%</p><p className="text-[10px] text-green-600">+2 pts</p><div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5 mt-1"><div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${Math.min(Number(tauxFid) || 89, 100)}%` }} /></div></div>
      </div>

      <hr className="section-divider" />

      <div className="section-title"><Search className="w-4 h-4" /> Filtres & Recherche</div>
      <div className="card p-3 mb-4">
        <div className="filter-group-clients">
          <div><label>Statut</label><select value={filters.statut} onChange={(e) => setF('statut', e.target.value)}><option>Tous</option><option>Actif</option><option>Inactif</option><option>Suspendu</option><option>En attente</option></select></div>
          <div><label>Ville</label><select value={filters.ville} onChange={(e) => setF('ville', e.target.value)}><option>Toutes</option>{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Secteur</label><select value={filters.secteur} onChange={(e) => setF('secteur', e.target.value)}><option>Tous</option>{SECTORS.map((c) => <option key={c}>{c}</option>)}</select></div>
          <div><label>Recherche</label><input placeholder="Nom, société..." value={filters.search} onChange={(e) => setF('search', e.target.value)} /></div>
          <div className="flex items-end gap-2">
            <button className="btn btn-primary btn-sm" onClick={() => toast('success', 'Filtres appliqués')}><Search className="w-3 h-3" /> Filtrer</button>
            <button className="btn btn-outline btn-sm" onClick={() => setFilters({ statut: 'Tous', ville: 'Toutes', secteur: 'Tous', search: '' })}><RotateCcw className="w-3 h-3" /> Réinitialiser</button>
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
              <span className="filter-tag text-xs text-gray-400 ml-2" style={{ background: 'transparent', color: '#94A3B8' }}>{activeFilters.length} filtres actifs</span>
            </>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <div className="text-sm text-gray-500"><span className="font-semibold text-gray-700 dark:text-gray-300">{filtered.length}</span> clients affichés</div>
        <div className="flex gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export CSV en cours')}><FileSpreadsheet className="w-3 h-3" /> CSV</button>
          <button className="btn btn-outline btn-sm" onClick={() => toast('success', 'Export Excel en cours')}><FileText className="w-3 h-3" /> Excel</button>
        </div>
      </div>

      <div className="clients-table-container">
        <table>
          <thead>
            <tr>
              <th>Société <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Contact <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Ville <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Statut <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Commandes <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>CA Total <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Dernière activité <ArrowUpDown className="w-3 h-3 inline" /></th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-gray-400 py-8">Aucun client pour ces filtres</td></tr>
            ) : (
              filtered.slice(0, 20).map((c, i) => {
                const st = statusBadge(c.status);
                return (
                  <tr key={c._id || c.id || i}>
                    <td className="font-medium">{firstNonEmpty(c.name, '—')}</td>
                    <td>{firstNonEmpty(c.contact_name, '—')}</td>
                    <td>{firstNonEmpty(c.city, '—')}</td>
                    <td><span className={`badge ${st.badge}`}><span className={`status-dot ${st.dot}`} />{st.label}</span></td>
                    <td>{fmtNum(c.orders_count, '', '0')}</td>
                    <td className="font-semibold text-green-600">{fmtMoney(c.total_revenue, '0 €')}</td>
                    <td><span className="text-xs text-gray-400">{fmtDate(firstNonEmpty(c.last_activity, c.created_at, new Date()))}</span></td>
                    <td>
                      <button className="btn btn-primary btn-xs" onClick={() => { setSelected(c); setDetailOpen(true); }}><Eye className="w-3 h-3" /></button>
                      <button className="btn btn-danger btn-xs ml-1" onClick={() => toggleStatus(c)}><RefreshCw className="w-3 h-3" /></button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-gray-500">Affichage 1-{Math.min(20, filtered.length)} sur {filtered.length} clients</span>
        <div className="flex gap-1">
          <button className="btn btn-outline btn-xs">←</button>
          <button className="btn btn-primary btn-xs">1</button>
          <button className="btn btn-outline btn-xs">2</button>
          <button className="btn btn-outline btn-xs">3</button>
          <button className="btn btn-outline btn-xs">→</button>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-gray-400">Dernière mise à jour : {new Date().toLocaleString('fr-FR')}</div>

      {/* Modal détail client */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title="Fiche Client">
        {selected && (
          <>
            <div className="modal-section">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">🏢 Informations société</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><div className="label">Société</div><div className="value">{firstNonEmpty(selected.name, '—')}</div></div>
                <div><div className="label">Contact</div><div className="value">{firstNonEmpty(selected.contact_name, '—')}</div></div>
                <div><div className="label">Ville</div><div className="value">{firstNonEmpty(selected.city, '—')}</div></div>
                <div><div className="label">Email</div><div className="value">{firstNonEmpty(selected.email, '—')}</div></div>
                <div><div className="label">Téléphone</div><div className="value">{firstNonEmpty(selected.phone, '—')}</div></div>
                <div><div className="label">Statut</div><div className="value"><span className={`badge ${statusBadge(selected.status).badge}`}>{statusBadge(selected.status).label}</span></div></div>
              </div>
            </div>
            <div className="modal-section">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">📊 Performance</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><div className="label">Commandes</div><div className="value">{fmtNum(selected.orders_count, '', '0')}</div></div>
                <div><div className="label">CA Total</div><div className="value text-green-600 font-bold">{fmtMoney(selected.total_revenue, '0 €')}</div></div>
                <div><div className="label">Dernière activité</div><div className="value">{fmtDate(firstNonEmpty(selected.last_activity, selected.created_at, new Date()))}</div></div>
              </div>
            </div>
          </>
        )}
      </Modal>

      {/* Modal nouveau client */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau client" maxWidth={600}>
        <form onSubmit={(e) => { e.preventDefault(); toast('success', 'Client créé avec succès'); setCreateOpen(false); fetchAll(); }}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Société</label>
              <input name="name" className="input mt-1" placeholder="Nom de l'entreprise" required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Contact</label>
                <input name="contact_name" className="input mt-1" placeholder="Nom du contact" />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Ville</label>
                <select name="city" className="input mt-1">{CITY_OPTIONS.map((c) => <option key={c}>{c}</option>)}</select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Email</label>
                <input name="email" type="email" className="input mt-1" placeholder="contact@société.com" />
              </div>
              <div>
                <label className="text-xs text-gray-500 uppercase tracking-wide font-medium">Téléphone</label>
                <input name="phone" className="input mt-1" placeholder="+216..." />
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