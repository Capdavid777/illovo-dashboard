// components/MonthSwitcher.js
import { useMemo } from 'react';

// monthKey: 'YYYY-MM'
// onChange: (newKey) => void
// minKey / maxKey: (optional) 'YYYY-MM' clamp bounds
export default function MonthSwitcher({ monthKey, onChange, minKey, maxKey }) {
  const { year, monthIndex } = useMemo(() => {
    const [y, m] = (monthKey || '').split('-').map(Number);
    return { year: y, monthIndex: (m || 1) - 1 };
  }, [monthKey]);

  const label = useMemo(() => {
    const m = new Date(Date.UTC(year, monthIndex, 1));
    return m.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }, [year, monthIndex]);

  const clamp = (key) => {
    if (minKey && key < minKey) return minKey;
    if (maxKey && key > maxKey) return maxKey;
    return key;
  };

  const toKey = (y, mIdx) => {
    const mm = String(mIdx + 1).padStart(2, '0');
    return `${y}-${mm}`;
  };

  const prevKey = useMemo(() => {
    const d = new Date(Date.UTC(year, monthIndex, 1));
    d.setUTCMonth(d.getUTCMonth() - 1);
    return clamp(toKey(d.getUTCFullYear(), d.getUTCMonth()));
  }, [year, monthIndex, minKey, maxKey]);

  const nextKey = useMemo(() => {
    const d = new Date(Date.UTC(year, monthIndex, 1));
    d.setUTCMonth(d.getUTCMonth() + 1);
    return clamp(toKey(d.getUTCFullYear(), d.getUTCMonth()));
  }, [year, monthIndex, minKey, maxKey]);

  const canGoPrev = !minKey || prevKey >= minKey;
  const canGoNext = !maxKey || nextKey <= maxKey;

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        aria-label="Previous month"
        onClick={() => canGoPrev && onChange(prevKey)}
        disabled={!canGoPrev}
      >
        ‹
      </button>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <button
        aria-label="Next month"
        onClick={() => canGoNext && onChange(nextKey)}
        disabled={!canGoNext}
      >
        ›
      </button>
    </div>
  );
}
