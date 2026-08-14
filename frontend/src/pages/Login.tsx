import { useState } from 'react';
import { LogIn, AlertCircle, Zap } from 'lucide-react';
import { api } from '../api/client';

interface LoginProps {
  onLogin: () => void;
}

/**
 * Login page
 * -----------------------------------------------------------------------------
 * V2 fix:
 *   - Was calling `fetch("/api/bo/auth/demo-login")` with a RELATIVE URL.
 *     On Render, this resolved against the frontend origin
 *     (https://ccm-backoffice-fe.onrender.com/api/bo/auth/demo-login),
 *     which hit the SPA fallback and returned index.html (200 OK) →
 *     `.json()` failed → "Unexpected token '<'" error.
 *   - Now uses `api.demoLogin()` which goes through `api.request()` and the
 *     hardcoded BASE = 'https://backoffice-mpa8.onrender.com/api/bo'.
 *
 * Behavior:
 *   - "Se connecter" (submit): tries `demoLogin()` first; if that fails,
 *     falls back to `api.login(email, password)` with the entered creds.
 *   - "Démo rapide" button: shortcut that only calls `demoLogin()`.
 */
export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('admin@ccm.ai');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDemoLogin = async () => {
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const res = await api.demoLogin();
      if (res?.token) {
        api.setToken(res.token);
        onLogin();
        return;
      }
      setError('Réponse invalide du serveur (pas de token)');
    } catch (err: any) {
      setError(err?.message || 'Échec de la démo');
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      // 1) Try demo-login first (backdoor that bypasses DB validation)
      try {
        const demo = await api.demoLogin();
        if (demo?.token) {
          api.setToken(demo.token);
          onLogin();
          return;
        }
      } catch {
        // Demo-login failed — fall through to real login
      }

      // 2) Fall back to real login with entered credentials
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
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-indigo-500/30">
            CM
          </div>
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
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Email
          </span>
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
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Mot de passe
          </span>
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

        <button
          type="button"
          onClick={handleDemoLogin}
          disabled={loading}
          className="btn btn-secondary w-full justify-center mt-2"
          style={{
            background: 'transparent',
            border: '1px dashed #6366f1',
            color: '#6366f1',
          }}
        >
          <Zap className="w-4 h-4" /> Démo rapide (sans mot de passe)
        </button>

        <p className="text-[10px] text-gray-400 text-center mt-4">
          V1.1.0 · Données chiffrées · Compatible dark mode
        </p>
      </form>
    </div>
  );
}

export default Login;

