import { Component, useEffect, useState, ReactNode } from 'react';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { AiAssistant } from './components/ai/AiAssistant';
import { ToastProvider } from './hooks/useToast';
import { api } from './api/client';

import { Dashboard } from './pages/Dashboard';
import { Candidates } from './pages/Candidates';
import { Prospects } from './pages/Prospects';
import { Clients } from './pages/Clients';
import { Orders } from './pages/Orders';
import { Payments } from './pages/Payments';
import { Marketing } from './pages/Marketing';
import { AdminTools } from './pages/AdminTools';
import {
  Profitability, MatchingIA, AgentIA, Statistics, Settings, Journal,
} from './pages/Placeholders';
import { Login } from './pages/Login';

interface PageMeta { id: string; title: string; subtitle: string; }
const PAGES: Record<string, PageMeta> = {
  dashboard:   { id: 'dashboard',   title: 'Cockpit Décisionnel', subtitle: 'Vue executive' },
  candidates:  { id: 'candidates',  title: 'Candidats',           subtitle: 'Data Center · BDD candidats' },
  prospects:   { id: 'prospects',   title: 'CRM Prospects',       subtitle: 'Pipeline commercial' },
  clients:     { id: 'clients',     title: 'CRM Clients',         subtitle: 'Gestion des clients' },
  orders:      { id: 'orders',      title: 'Commandes',           subtitle: 'Suivi des commandes' },
  payments:    { id: 'payments',    title: 'Paiements',           subtitle: 'Suivi des paiements' },
  marketing:   { id: 'marketing',   title: 'Marketing',           subtitle: 'Cockpit multicanal' },
  admin:       { id: 'admin',       title: 'Outils Admin',        subtitle: 'Pricing · Matching · Import' },
  profitability:{ id: 'profitability', title: 'Rentabilité',      subtitle: 'Analyses financières' },
  matching:    { id: 'matching',    title: 'Matching IA',          subtitle: 'Algorithmes de matching' },
  'ia-agent':  { id: 'ia-agent',    title: 'Agent IA',            subtitle: 'Assistant intelligent' },
  stats:       { id: 'stats',       title: 'Statistiques',         subtitle: 'Rapports consolidés' },
  settings:    { id: 'settings',    title: 'Paramètres',          subtitle: 'Configuration' },
  logs:        { id: 'logs',        title: 'Journal',              subtitle: "Journal d'activité" },
};

const PAGE_COMPONENTS: Record<string, React.FC> = {
  dashboard: Dashboard, candidates: Candidates, prospects: Prospects, clients: Clients,
  orders: Orders, payments: Payments, marketing: Marketing, admin: AdminTools,
  profitability: Profitability, matching: MatchingIA, 'ia-agent': AgentIA,
  stats: Statistics, settings: Settings, logs: Journal,
};

/* ---------------- Error Boundary (per page) ---------------- */
class PageErrorBoundary extends Component<{ children: ReactNode; section: string }, { hasError: boolean; message: string }> {
  state = { hasError: false, message: '' };
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: (err && (err.message || String(err))) || 'Erreur inconnue' };
  }
  componentDidCatch(err: any, info: any) {
    // eslint-disable-next-line no-console
    console.error('[PageErrorBoundary]', this.props.section, err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h2 className="text-xl font-bold text-red-600 mb-2">⚠️ Page en erreur</h2>
          <p className="text-sm text-gray-500 mb-4">{this.state.message}</p>
          <button
            className="btn btn-primary"
            onClick={() => this.setState({ hasError: false, message: '' })}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---------------- App Shell ---------------- */
function Shell() {
  const [section, setSection] = useState('dashboard');
  const [dark, setDark] = useState<boolean>(() => {
    try { return localStorage.getItem('ccm_dark') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('ccm_dark', String(dark)); } catch {}
  }, [dark]);

  const meta = PAGES[section] || PAGES.dashboard;
  const Page = PAGE_COMPONENTS[section] || Dashboard;

  return (
    <div className="app-layout">
      <Sidebar section={section} onNavigate={setSection} dark={dark} onToggleDark={() => setDark((v) => !v)} />
      <main className="main-content">
        <Header
          dark={dark}
          onToggleDark={() => setDark((v) => !v)}
          onLogout={() => {
            api.clearToken();
            window.location.reload();
          }}
          title={meta.title}
          subtitle={meta.subtitle}
        />
        <PageErrorBoundary key={section} section={section}>
          <Page />
        </PageErrorBoundary>
      </main>
      <AiAssistant />
    </div>
  );
}

/* ---------------- Auth Gate ---------------- */
export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => api.hasToken());

  // Try to silently validate the token; if invalid, force login.
  useEffect(() => {
    if (!api.hasToken()) return;
    (async () => {
      try { await api.getMe(); }
      catch {
        api.clearToken();
        setAuthed(false);
      }
    })();
  }, []);

  if (!authed) {
    return (
      <ToastProvider>
        <Login onLogin={() => setAuthed(true)} />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
