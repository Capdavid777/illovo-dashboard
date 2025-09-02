// lib/useMonthKey.ts
import { useRouter } from 'next/router';

export function useMonthKey() {
  const { query } = useRouter();
  const q = typeof query?.month === 'string' ? query.month : '';
  // Validate YYYY-MM; if missing, fall back to current UTC month
  if (/^\d{4}-\d{2}$/.test(q)) return q;
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
