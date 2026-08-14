import { useState } from 'react';
import { LogIn, AlertCircle } from 'lucide-react';
import { api } from '../api/client';

interface LoginProps {
  onLogin: () => void;
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('admin@ccm.ai');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      // Demo bypass — works without a real database user
      const demoRes = await fetch('/api/bo/auth/demo-login', { method: 'POST' });
      const demoJson = await demoRes.json();
      if (demoJson?.token) {
        api.setToken(demoJson.token);
        onLogin();
        return;
      }
      // Fallback: try real login
      const res = await api.login(email, password);
      if (res?.token) {
        api.setToken(res.token);
        onLogin();
      } else {
        setError('Réponse invalide du serveur');
      }
    } catch (err: any) {
      setError(err?.message || 'Échec de connexion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-500/30">CM</div>
          <div>
            <h1 className="text-lg font-bold text-gray-900">CallCenterMatch</h1>
            <p className="text-xs text-gray-500">BackOffice · Connexion</p>
          </div>
        </div>

        {error && (
          <div className="mb-3 p-2.5 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        <label className="block mb-3">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-1"
            placeholder="admin@ccm.ai"
          />
        </label>

        <label className="block mb-4">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Mot de passe</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mt-1"
            placeholder="••••••••"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="btn btn-primary w-full justify-center"
        >
          <LogIn className="w-4 h-4" /> {loading ? 'Connexion...' : 'Se connecter'}
        </button>

        <p className="text-[10px] text-gray-400 text-center mt-4">
          V1.1.0 · Données chiffrées · Compatible dark mode
        </p>
      </form>
    </div>
  );
}
