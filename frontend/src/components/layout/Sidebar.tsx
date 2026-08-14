import { LayoutDashboard, Users, TrendingUp, Building2, ShoppingBag, CreditCard, Megaphone, Settings2, GitMerge, Bot, BarChart3, Sliders, FileText, Bell, Moon, Sun } from 'lucide-react';

const links = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'candidates', icon: Users, label: 'Candidats' },
  { id: 'prospects', icon: TrendingUp, label: 'CRM Prospects' },
  { id: 'clients', icon: Building2, label: 'CRM Clients' },
  { id: 'orders', icon: ShoppingBag, label: 'Commandes' },
  { id: 'payments', icon: CreditCard, label: 'Paiements' },
  { id: 'marketing', icon: Megaphone, label: 'Marketing' },
  { id: 'admin', icon: Settings2, label: 'Outils Admin' },
  { id: 'profitability', icon: TrendingUp, label: 'Rentabilité' },
  { id: 'matching', icon: GitMerge, label: 'Matching IA' },
  { id: 'ia-agent', icon: Bot, label: 'Agent IA' },
  { id: 'stats', icon: BarChart3, label: 'Statistiques' },
  { id: 'settings', icon: Sliders, label: 'Paramètres' },
  { id: 'logs', icon: FileText, label: 'Journal' },
];

interface SidebarProps {
  section: string;
  onNavigate: (s: string) => void;
  dark: boolean;
  onToggleDark: () => void;
}

export function Sidebar({ section, onNavigate, dark, onToggleDark }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="flex items-center gap-2 mb-5 px-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white font-bold text-[10px] shadow-lg shadow-indigo-500/20">
          CM
        </div>
        <span className="font-semibold text-xs text-gray-800 dark:text-gray-200 logo-text">
          CallCenter<span className="text-indigo-600">Match</span>
        </span>
      </div>

      <nav className="space-y-0.5">
        {links.map((l) => {
          const Icon = l.icon;
          const active = section === l.id;
          return (
            <button
              key={l.id}
              type="button"
              onClick={() => onNavigate(l.id)}
              className={`sidebar-link ${active ? 'active' : ''}`}
            >
              <Icon className="w-4 h-4" />
              <span>{l.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-5 pt-3 border-t border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2 px-2 text-xs text-gray-500">
          <Bell className="w-4 h-4" />
          <span>
            Notifications <span className="ml-auto bg-red-500 text-white text-[9px] rounded-full px-1.5 py-0.5">3</span>
          </span>
        </div>
        <button
          type="button"
          onClick={onToggleDark}
          className="flex items-center gap-2 px-2 mt-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 cursor-pointer w-full"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          <span>Thème</span>
        </button>
      </div>
    </aside>
  );
}
