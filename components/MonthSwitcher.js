// components/MonthSwitcher.js
import { useMemo } from 'react';

export default function MonthSwitcher({ monthKey, onChange, minKey, maxKey }) {
  const { year, monthIndex } = useMemo(() => {
    const [y, m] = (monthKey || '').split('-').map(Number);
    return { year: y, monthIndex: (m || 1) - 1 };
  }, [monthKey]);

  const label = useMemo(() => {
    const d = new Date(Date.UTC(year, monthIndex, 1));
    return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [year, monthIndex]);

  const toKey = (y, mIdx) => `${y}-${String(mIdx + 1).padStart(2, '0')}`;
  const clamp = (k) => (minKey && k < minKey ? minKey : maxKey && k > maxKey ? maxKey : k);

  const prevKey = useMemo(() => {
    const d = new Date(Date.UTC(year, monthIndex, 1)); d.setUTCMonth(d.getUTCMonth() - 1);
    return clamp(toKey(d.getUTCFullYear(), d.getUTCMonth()));
  }, [year, monthIndex, minKey, maxKey]);

  const nextKey = useMemo(() => {
    const d = new Date(Date.UTC(year, monthIndex, 1)); d.setUTCMonth(d.getUTCMonth() + 1);
    return clamp(toKey(d.getUTCFullYear(), d.getUTCMonth()));
  }, [year, monthIndex, minKey, maxKey]);

  const canPrev = !minKey || prevKey >= minKey;
  const canNext = !maxKey || nextKey <= maxKey;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button aria-label="Previous" onClick={() => canPrev && onChange(prevKey)} disabled={!canPrev}>‹</button>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <button aria-label="Next" onClick={() => canNext && onChange(nextKey)} disabled={!canNext}>›</button>
    </div>
  );
}
