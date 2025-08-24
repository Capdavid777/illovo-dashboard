// components/Dashboard.js
import React, { useMemo, useState } from 'react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts';
import {
  TrendingUp, TrendingDown, Calendar, Users, DollarSign,
  Target, Home, Activity
} from 'lucide-react';

/**
 * Normalize whatever /api/overview returns into the shape the dashboard needs.
 * Works with multiple possible key names so small API differences don’t break the UI.
 */
function normalizeOverview(raw = {}) {
  const get = (keys, fallback) => {
    for (const k of keys) {
      const v = raw?.[k];
      if (v !== undefined && v !== null) return v;
    }
    return fallback;
  };

  const num = (v, d = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  };

  // Top-level metrics (with aliases)
  const revenueToDate = num(get(['revenueToDate', 'revenue_to_date', 'revenueTD', 'revenue'], 0));
  const targetToDate  = num(get(['targetToDate', 'target_to_date', 'targetTD', 'target'], 0));
  const averageRoomRate = num(get(['avgRoomRate', 'averageRoomRate', 'arr', 'average_room_rate'], 0));
  const providedOcc = get(['occupancyRate', 'occupancy_to_date', 'occupancy'], undefined);

  // Daily series (with aliases)
  const dailyRaw = get(['daily', 'dailySeries', 'items', 'rows'], []) || [];
  const dailyData = dailyRaw.map((d, i) => ({
    day: d.day ?? (d.date ? String(d.date).slice(-2) : i + 1),
    target:   num(d.target ?? d.targetRevenue ?? d.target_revenue, 0),
    revenue:  num(d.revenue, 0),
    occupancy:num(d.occupancy ?? d.occ, 0),
    rate:     num(d.rate ?? d.arr ?? d.averageRate, 0),
    met:      d.met ?? undefined,
  }));

  // If occupancy isn’t provided, compute a simple average from daily points.
  let occupancyRate = num(providedOcc, NaN);
  if (!Number.isFinite(occupancyRate)) {
    const vals = dailyData.map(d => d.occupancy).filter(n => Number.isFinite(n));
    occupancyRate = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
  }

  const targetVariance = targetToDate - revenueToDate;
  const lastUpdated = get(['lastUpdated', 'updatedAt', 'last_updated'], null);

  // Optional room-type & historical series if your API provides them
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

const currency = (n) => `R${Number(n || 0).toLocaleString()}`;
const pct = (n) => `${Math.round(Number(n || 0))}%`;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const Dashboard = ({ overview }) => {
  const [selectedView, setSelectedView] = useState('overview');

  const {
    revenueToDate,
    targetToDate,
    averageRoomRate,
    occupancyRate,
    targetVariance,
    dailyData,
    lastUpdated,
    roomTypes,
    history,
  } = useMemo(() => normalizeOverview(overview), [overview]);

  // Fallback datasets for sections your API may not provide yet
  const fallbackRoomTypeData = [
    { type: 'Queen', rooms: 26, available: 806, sold: 247, revenue: 212699, rate: 861, occupancy: 31 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 129, revenue: 106721, rate: 827, occupancy: 42 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 258, revenue: 279158, rate: 1082, occupancy: 52 },
    { type: '2 Bed', rooms: 7, available: 217, sold: 129, revenue: 176339, rate: 1367, occupancy: 59 }
  ];
  const roomTypeData = roomTypes && Array.isArray(roomTypes) && roomTypes.length ? roomTypes : fallbackRoomTypeData;

  const fallbackYearlyData = [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];
  const yearlyData = history && Array.isArray(history) && history.length ? history : fallbackYearlyData;

  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'];

  // Derived UI helpers
  const revenueProgressPct   = targetToDate > 0 ? Math.round(100 * clamp01(revenueToDate / targetToDate)) : 0;
  const occupancyTargetPct   = 62; // update if your API returns a target occupancy
  const occupancyProgressPct = Math.round(100 * clamp01(occupancyRate / occupancyTargetPct));

  const MetricCard = ({ title, value, subtitle, icon: Icon, trend, color = 'blue' }) => {
    const colorClasses = {
      blue:   'bg-blue-50 border-blue-200 text-blue-800',
      red:    'bg-red-50 border-red-200 text-red-800',
      green:  'bg-green-50 border-green-200 text-green-800',
      yellow: 'bg-yellow-50 border-yellow-200 text-yellow-800'
    };
    return (
      <div className={`p-6 rounded-lg border-2 ${colorClasses[color]} bg-white shadow-lg hover:shadow-xl transition-shadow`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-600">{title}</p>
            <p className="text-2xl font-bold text-gray-900">{value}</p>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <div className={`p-3 rounded-full ${colorClasses[color]}`}>
            <Icon className="w-6 h-6" />
          </div>
        </div>
        {typeof trend === 'number' && (
          <div className="mt-4 flex items-center">
            {trend > 0 ? (
              <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500 mr-1" />
            )}
            <span className={`text-sm ${trend > 0 ? 'text-green-500' : 'text-red-500'}`}>
              {Math.abs(trend)}%
            </span>
          </div>
        )}
      </div>
    );
  };

  const OverviewView = () => (
    <div className="space-y-8">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Revenue to Date"
          value={currency(revenueToDate)}
          subtitle={targetToDate ? `vs ${currency(targetToDate)} target` : undefined}
          icon={DollarSign}
          color="blue"
        />
        <MetricCard
          title="Occupancy Rate"
          value={pct(occupancyRate)}
          subtitle={`vs ${pct(occupancyTargetPct)} target`}
          icon={Users}
          color={occupancyRate >= occupancyTargetPct ? 'green' : 'red'}
        />
        <MetricCard
          title="Average Room Rate"
          value={currency(averageRoomRate)}
          subtitle="vs breakeven"
          icon={Home}
          color={averageRoomRate >= 1237 ? 'green' : 'yellow'}
        />
        <MetricCard
          title="Target Variance"
          value={currency(Math.abs(targetVariance))}
          subtitle={targetVariance >= 0 ? 'Target – Revenue' : 'Revenue – Target'}
          icon={Target}
          color={targetVariance >= 0 ? 'red' : 'green'}
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
          {dailyData && dailyData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData}>
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
            <div className="h-full flex items-center justify-center text-gray-500">
              No daily data yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const RoomTypesView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {roomTypeData.map((room, index) => (
          <MetricCard
            key={room.type || index}
            title={room.type}
            value={`${room.occupancy}%`}
            subtitle={`R${room.rate} avg rate`}
            icon={Home}
            color={index % 2 === 0 ? 'blue' : 'green'}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
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
                  {roomTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => [`${currency(value)}`, 'Revenue']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Room Type Performance</h3>
          <div className="space-y-4">
            {roomTypeData.map((room, index) => (
              <div key={room.type || index} className="border-l-4 pl-4" style={{ borderColor: colors[index % colors.length] }}>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{room.type}</span>
                  <span className="text-sm text-gray-500">{room.sold}/{room.available}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Revenue: {currency(room.revenue)} | Rate: {currency(room.rate)}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div
                    className="h-2 rounded-full"
                    style={{
                      width: `${room.occupancy}%`,
                      backgroundColor: colors[index % colors.length]
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

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
                <Tooltip formatter={(value) => [`${value}%`, 'Occupancy']} />
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
              {yearlyData.map((year, i) => (
                <tr key={year.year || i}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{year.year}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{year.roomsSold}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{year.occupancy}%</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(year.revenue)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{currency(year.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

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
                  {lastUpdated
                    ? new Date(lastUpdated).toLocaleDateString()
                    : new Date().toLocaleDateString()}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex space-x-1">
          {[
            { id: 'overview', name: 'Overview', icon: Activity },
            { id: 'rooms', name: 'Room Types', icon: Home },
            { id: 'historical', name: 'Historical', icon: Calendar }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedView(tab.id)}
              className={`flex items-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedView === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
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
