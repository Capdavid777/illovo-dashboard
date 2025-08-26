// components/Dashboard.js
import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import { Activity, Calendar, DollarSign, Home, Target, Users } from 'lucide-react';

/* ------------------------------ helpers ------------------------------ */

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Normalize 0–1 fractions (0.57) to percents (57). Leave real percents intact.
const asPercent = (v, d = 0) => {
  const n = num(v, d);
  if (!Number.isFinite(n)) return d;
  return n <= 1.5 ? n * 100 : n;
};

const currency = (n) => `R${num(n).toLocaleString()}`;
const pct = (n) => `${Math.round(num(n))}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Normalize whatever /api/overview returns into what the UI needs. */
function normalizeOverview(raw = {}) {
  const get = (keys, fallback) => {
    for (const k of keys) {
      if (raw?.[k] !== undefined && raw?.[k] !== null) return raw[k];
    }
    return fallback;
  };

  const revenueToDate   = num(get(['revenueToDate', 'revenue_to_date', 'revenue'], 0));
  const targetToDate    = num(get(['targetToDate', 'target_to_date', 'target'], 0));
  const averageRoomRate = num(get(['averageRoomRate', 'avgRoomRate', 'arr'], 0));

  // occupancy can be fraction or percent already
  let occupancyRate = get(['occupancyRate', 'occupancy_to_date', 'occupancy'], undefined);
  occupancyRate = occupancyRate === undefined ? NaN : asPercent(occupancyRate);

  // daily series (with aliases)
  const dailyRaw = get(['dailySeries', 'daily', 'items', 'rows'], []) || [];
  const dailyData = dailyRaw.map((d, i) => {
    const dateStr = d.date ?? d.day;
    const day =
      d.day ??
      (d.date ? new Date(d.date).getUTCDate() : i + 1);

    return {
      day,
      date: d.date,
      target: num(d.target ?? d.targetRevenue ?? d.target_revenue, 0),
      revenue: num(d.revenue, 0),
      occupancy: asPercent(d.occupancy ?? d.occ ?? d.occupancyRate ?? d.occRate, 0),
      rate: num(d.rate ?? d.arr ?? d.averageRate, 0),
      met: d.met ?? undefined,
    };
  });

  // If occupancy wasn’t provided, compute avg from daily points
  if (!Number.isFinite(occupancyRate)) {
    const vals = dailyData.map((d) => d.occupancy).filter((n) => Number.isFinite(n));
    occupancyRate = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }

  const targetVariance = targetToDate - revenueToDate;
  const lastUpdated = get(['lastUpdated', 'updatedAt', 'last_updated'], null);

  // Optional room-type & historical series (if your API includes them)
  const roomTypes = get(['roomTypes', 'roomTypesData'], null);
  const history   = get(['history', 'yearlyData'], null);

  return {
    revenueToDate,
    targetToDate,
    averageRoomRate,
    occupancyRate,
    targetVariance,
    dailyData,
    lastUpdated,
    roomTypes,
    history,
  };
}

/* ------------------------------ component ------------------------------ */

const Dashboard = ({ overview }) => {
  const [selectedView, setSelectedView] = useState('overview');
  const [roomTypesState, setRoomTypesState] = useState(null);

  // Normalize the SSR overview payload
  const ov = useMemo(() => normalizeOverview(overview), [overview]);

  // If overview didn’t include roomTypes, fetch them on the client as a fallback
  useEffect(() => {
    let abort = false;
    async function loadRoomTypes() {
      if (ov.roomTypes && Array.isArray(ov.roomTypes)) {
        setRoomTypesState(ov.roomTypes);
        return;
      }
      try {
        const r = await fetch('/api/room-types', { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (!abort) {
          const list = Array.isArray(j?.items) ? j.items : j;
          setRoomTypesState(list || null);
        }
      } catch {
        // ignore – UI shows fallbacks
      }
    }
    loadRoomTypes();
    return () => { abort = true; };
  }, [ov.roomTypes]);

  /* ------------------------------ data ------------------------------ */

  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'];

  const fallbackRoomTypeData = [
    { type: 'Queen', rooms: 26, available: 806, sold: 247, revenue: 212699, rate: 861, occupancy: 31 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 129, revenue: 106721, rate: 827, occupancy: 42 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 258, revenue: 279158, rate: 1082, occupancy: 52 },
    { type: '2 Bed', rooms: 7, available: 217, sold: 129, revenue: 176339, rate: 1367, occupancy: 59 }
  ];

  // ---------- derive + sort for Room Types ----------
  const baseRoomTypeData = useMemo(() => {
    const source = (roomTypesState && roomTypesState.length)
      ? roomTypesState
      : (ov.roomTypes || fallbackRoomTypeData);

    return (source ?? []).map(r => {
      const available = num(r.available ?? r.rooms ?? r.capacity, 0);
      const sold      = num(r.sold ?? r.booked ?? r.nights, 0);
      const revenue   = num(r.revenue, 0);

      // Prefer explicit rate; if missing, derive ADR safely
      const adr = Number.isFinite(num(r.rate))
        ? num(r.rate)
        : (sold ? Math.round(revenue / sold) : 0);

      // Prefer provided occupancy; else compute from sold/available
      const occRaw = (r.occupancy ?? r.occ ?? r.occupancyRate);
      const occ = Number.isFinite(num(occRaw))
        ? asPercent(occRaw, 0)
        : (available ? (sold / available) * 100 : 0);

      const revpar = available ? revenue / available : 0;

      return {
        ...r,
        available,
        sold,
        revenue,
        rate: adr,           // keep `rate` for existing UI labels
        adr,                 // also expose `adr`
        occupancy: Math.round(occ * 10) / 10,
        revpar,
      };
    });
  }, [roomTypesState, ov.roomTypes]);
  // ---------- end derive ----------

  // Sort state for the table
  const [sortBy, setSortBy] = useState('revenue'); // default sort by revenue
  const [sortDir, setSortDir] = useState('desc');

  const toggleSort = (key) => {
    if (key === sortBy) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(key);
      setSortDir(key === 'type' ? 'asc' : 'desc'); // sensible defaults
    }
  };

  const sortedRoomTypes = useMemo(() => {
    const list = [...baseRoomTypeData];
    list.sort((a, b) => {
      if (sortBy === 'type') {
        const av = (a.type || '').toString().toLowerCase();
        const bv = (b.type || '').toString().toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      const av = num(a[sortBy]);
      const bv = num(b[sortBy]);
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [baseRoomTypeData, sortBy, sortDir]);

  const colorsMap = useMemo(() => {
    // pin a color to each type for consistency across cards & table
    const m = new Map();
    sortedRoomTypes.forEach((r, i) => m.set(r.type, colors[i % colors.length]));
    return m;
  }, [sortedRoomTypes]);

  const roomTypeData = sortedRoomTypes; // use sorted data everywhere below

  const fallbackYearlyData = [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];
  const yearlyData = Array.isArray(ov.history) && ov.history.length ? ov.history : fallbackYearlyData;

  const revenueProgressPct   = ov.targetToDate > 0 ? Math.round(100 * clamp01(ov.revenueToDate / ov.targetToDate)) : 0;
  const occupancyTargetPct   = 62; // adjust if your API provides a target
  const occupancyProgressPct = Math.round(100 * clamp01(ov.occupancyRate / occupancyTargetPct));

  /* ------------------------------ UI bits ------------------------------ */

  const MetricCard = ({ title, value, subtitle, icon: Icon, color = 'blue' }) => {
    const colorClasses = {
      blue: 'bg-blue-50 border-blue-200 text-blue-800',
      red: 'bg-red-50 border-red-200 text-red-800',
      green: 'bg-green-50 border-green-200 text-green-800',
      yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800',
    };
    return (
      <div className={`p-6 rounded-lg border-2 ${colorClasses[color]} bg-white shadow-lg`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            {!!subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-full ${colorClasses[color]}`}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
      </div>
    );
  };

  const OverviewView = () => (
    <div className="space-y-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Revenue to Date"
          value={currency(ov.revenueToDate)}
          subtitle={ov.targetToDate ? `vs ${currency(ov.targetToDate)} target` : undefined}
          icon={DollarSign}
          color="blue"
        />
        <MetricCard
          title="Occupancy Rate"
          value={pct(ov.occupancyRate)}
          subtitle={`vs ${pct(occupancyTargetPct)} target`}
          icon={Users}
          color={ov.occupancyRate >= occupancyTargetPct ? 'green' : 'red'}
        />
        <MetricCard
          title="Average Room Rate"
          value={currency(ov.averageRoomRate)}
          subtitle="vs breakeven"
          icon={Home}
          color={ov.averageRoomRate >= 1237 ? 'green' : 'yellow'}
        />
        <MetricCard
          title="Target Variance"
          value={currency(Math.abs(ov.targetVariance))}
          subtitle={ov.targetVariance >= 0 ? 'Target – Revenue' : 'Revenue – Target'}
          icon={Target}
          color={ov.targetVariance >= 0 ? 'red' : 'green'}
        />
      </div>

      {/* Progress Bars */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Progress to Breakeven</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Revenue Progress</span>
              <span className="text-sm text-gray-500">{revenueProgressPct}% of target</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-blue-600 h-3 rounded-full" style={{ width: `${revenueProgressPct}%` }} />
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Occupancy Progress</span>
              <span className="text-sm text-gray-500">{occupancyProgressPct}% of target</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-green-600 h-3 rounded-full" style={{ width: `${occupancyProgressPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Daily Revenue Chart */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Daily Revenue vs Target</h3>
        <div className="h-80">
          {ov.dailyData?.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ov.dailyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip formatter={(value) => [`${currency(value)}`, '']} />
                <Legend />
                <Bar dataKey="target" fill="#E5E7EB" name="Daily Target" />
                <Bar dataKey="revenue" fill="#3B82F6" name="Actual Revenue" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-500">No daily data yet.</div>
          )}
        </div>
      </div>
    </div>
  );

  const RoomTypesView = () => {
    const SortIcon = ({ col }) => (
      <span className="ml-1 text-gray-400">
        {sortBy !== col ? '↕' : sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );

    const Th = ({ label, col, right }) => (
      <th className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider ${right ? 'text-right' : 'text-left'} text-gray-600`}>
        <button onClick={() => toggleSort(col)} className="inline-flex items-center hover:text-gray-900">
          {label}
          <SortIcon col={col} />
        </button>
      </th>
    );

    return (
      <div className="space-y-8">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {roomTypeData.map((room, index) => (
            <MetricCard
              key={room.type || index}
              title={room.type}
              value={`${Math.round(room.occupancy)}%`}
              subtitle={`${currency(room.rate)} avg rate`}
              icon={Home}
              color={index % 2 === 0 ? 'blue' : 'green'}
            />
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Revenue Share Pie */}
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Room Type Revenue</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={roomTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ type, percent }) => `${type} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="revenue"
                  >
                    {roomTypeData.map((r, i) => (
                      <Cell key={`cell-${i}`} fill={colorsMap.get(r.type) || colors[i % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Bar-ish progress list */}
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h3 className="text-lg font-semibold mb-4">Room Type Performance</h3>
            <div className="space-y-4">
              {roomTypeData.map((room, i) => (
                <div key={room.type || i} className="border-l-4 pl-4" style={{ borderColor: colorsMap.get(room.type) || colors[i % colors.length] }}>
                  <div className="flex justify-between items-center">
                    <span className="font-medium">{room.type}</span>
                    <span className="text-sm text-gray-500">
                      {num(room.sold, 0)}/{num(room.available, 0)}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">
                    Revenue: {currency(room.revenue)} | ADR: {currency(room.rate)} | RevPAR: {currency(room.revpar)}
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.max(0, Math.min(100, num(room.occupancy)))}%`,
                        backgroundColor: colorsMap.get(room.type) || colors[i % colors.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* NEW: Sortable details table */}
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Room Type Details</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <Th label="Type" col="type" />
                  <Th label="Available" col="available" right />
                  <Th label="Sold" col="sold" right />
                  <Th label="Occ %" col="occupancy" right />
                  <Th label="ADR" col="rate" right />
                  <Th label="RevPAR" col="revpar" right />
                  <Th label="Revenue" col="revenue" right />
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {roomTypeData.map((r, i) => (
                  <tr key={r.type || i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: colorsMap.get(r.type) || colors[i % colors.length] }}
                        />
                        <span className="font-medium text-gray-900">{r.type}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.available)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{num(r.sold)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{pct(r.occupancy)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{currency(r.rate)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{currency(r.revpar)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">{currency(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const HistoricalView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Annual Revenue Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Occupancy Trend</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={yearlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis />
                <Tooltip formatter={(value) => [`${Math.round(num(value))}%`, 'Occupancy']} />
                <Line type="monotone" dataKey="occupancy" stroke="#10B981" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Year-over-Year Comparison</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Year</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Rooms Sold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Occupancy</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Revenue</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Avg Rate</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {yearlyData.map((y, i) => (
                <tr key={y.year || i}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{y.year}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{num(y.roomsSold)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pct(asPercent(y.occupancy))}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(y.revenue)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(y.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  /* ------------------------------ layout ------------------------------ */

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Reserved Suites Illovo</h1>
              <p className="text-sm text-gray-500">Revenue Dashboard</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="text-sm font-medium">
                  {ov.lastUpdated ? new Date(ov.lastUpdated).toLocaleDateString() : new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-1">
          {[
            { id: 'overview', name: 'Overview', icon: Activity },
            { id: 'rooms', name: 'Room Types', icon: Home },
            { id: 'historical', name: 'Historical', icon: Calendar },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedView(tab.id)}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedView === tab.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <tab.icon className="w-4 h-4 mr-2" />
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
        {selectedView === 'overview' && <OverviewView />}
        {selectedView === 'rooms' && <RoomTypesView />}
        {selectedView === 'historical' && <HistoricalView />}
      </div>
    </div>
  );
};

export default Dashboard;
