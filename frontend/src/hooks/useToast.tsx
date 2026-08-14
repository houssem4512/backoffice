import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface Toast { id: number; kind: ToastKind; message: string; }

interface ToastCtx {
  toast: (kind: ToastKind, message: string) => void;
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
  warning: (m: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, kind, message }]);
    setTimeout(() => remove(id), 3500);
  }, [remove]);

  const value: ToastCtx = {
    toast,
    success: (m) => toast('success', m),
    error: (m) => toast('error', m),
    info: (m) => toast('info', m),
    warning: (m) => toast('warning', m),
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => remove(t.id)}>
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback – no provider. Use safe no-ops so pages never crash.
    const noop = () => {};
    return { toast: noop, success: noop, error: noop, info: noop, warning: noop } as any;
  }
  return ctx;
}
