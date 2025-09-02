// lib/useMonthKey.js
import { useRouter } from 'next/router';

/**
 * Read the active month from the URL (?month=YYYY-MM).
 * Falls back to current UTC month if missing/invalid.
 */
export function useMonthKey() {
  const { query } = useRouter();
  const q = typeof query?.month === 'string' ? query.month : '';
  if (/^\d{4}-\d{2}$/.test(q)) return q;

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Also provide a default export so either import style works:
//   import { useMonthKey } from '../../lib/useMonthKey'
//   import useMonthKey from '../../lib/useMonthKey'
export default useMonthKey;
