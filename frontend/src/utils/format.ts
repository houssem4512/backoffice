/**
 * Small formatting helpers – all null-safe, never throw.
 */

export function fmtNum(n: any, suffix = '', fallback = '0'): string {
  if (n === null || n === undefined || n === '') return fallback + suffix;
  const num = Number(n);
  if (!isFinite(num) || isNaN(num)) return fallback + suffix;
  return num.toLocaleString('fr-FR') + suffix;
}

export function fmtMoney(n: any, fallback = '0 €'): string {
  if (n === null || n === undefined || n === '') return fallback;
  const num = Number(n);
  if (!isFinite(num) || isNaN(num)) return fallback;
  if (Math.abs(num) >= 1_000_000) return (num / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M€';
  if (Math.abs(num) >= 1_000) return Math.round(num / 1000) + ' k€';
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' €';
}

export function fmtPct(n: any, fallback = '0%'): string {
  if (n === null || n === undefined || n === '') return fallback;
  const num = Number(n);
  if (!isFinite(num) || isNaN(num)) return fallback;
  return num.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + '%';
}

export function fmtDate(d: any, fallback = '—'): string {
  if (!d) return fallback;
  try {
    const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
    if (!(date instanceof Date) || isNaN(date.getTime())) return fallback;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return fallback;
  }
}

export function fmtDateTime(d: any, fallback = '—'): string {
  if (!d) return fallback;
  try {
    const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
    if (!(date instanceof Date) || isNaN(date.getTime())) return fallback;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch {
    return fallback;
  }
}

/** Pull a count from objects that may use any of: count, total, value, y */
export function normCount(o: any, fallback = 0): number {
  if (!o) return fallback;
  for (const k of ['count', 'total', 'value', 'y', 'amount', 'quantity']) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== '') {
      const n = Number(v);
      if (isFinite(n) && !isNaN(n)) return n;
    }
  }
  return fallback;
}

export function pick<T = any>(o: any, keys: string[], fallback: T | undefined = undefined): T {
  if (!o || typeof o !== 'object') return fallback as T;
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k] as T;
  }
  return fallback as T;
}

export function str(o: any, fallback = '—'): string {
  if (o === null || o === undefined || o === '') return fallback;
  return String(o);
}

export function firstNonEmpty(...vals: any[]): any {
  for (const v of vals) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}
