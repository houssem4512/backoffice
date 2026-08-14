import { useEffect, useState } from 'react';
import { Search, Bell, Moon, Sun, LogOut } from 'lucide-react';
import { api } from '../../api/client';

interface HeaderProps {
  dark: boolean;
  onToggleDark: () => void;
  onLogout: () => void;
  title?: string;
  subtitle?: string;
}

export function Header({ dark, onToggleDark, onLogout, title, subtitle }: HeaderProps) {
  const [user, setUser] = useState<any>(null);
  const [now, setNow] = useState<string>('');

  useEffect(() => {
    (async () => {
      if (!api.hasToken()) return;
      try {
        const u = await api.getMe();
        if (u) setUser(u);
      } catch {
        /* ignored */
      }
    })();
  }, []);

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setNow(
        d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) +
          ' · ' +
          d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      );
    };
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  const displayName =
    (user && (user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim())) || 'Admin';
  const role = (user && (user.role_name || user.role)) || 'Administrateur';

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div className="flex items-center gap-3">
        {title && (
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">{title}</h2>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <Search className="w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Recherche..."
            className="text-xs bg-transparent border-none focus:outline-none w-40 text-gray-700 dark:text-gray-200"
          />
        </div>

        <span className="hidden lg:inline text-xs text-gray-400">{now}</span>

        <button
          type="button"
          onClick={onToggleDark}
          className="w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          title="Basculer le thème"
        >
          {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          type="button"
          className="relative w-9 h-9 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full text-[8px] flex items-center justify-center text-white">3</span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white text-[10px] font-bold">
            {(displayName || 'A').slice(0, 1).toUpperCase()}
          </div>
          <div className="hidden sm:block leading-tight">
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{displayName}</p>
            <p className="text-[10px] text-gray-400">{role}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="w-9 h-9 rounded-full border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 flex items-center justify-center text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40"
          title="Déconnexion"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
