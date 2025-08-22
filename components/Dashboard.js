// components/Dashboard.js
import React, { useState } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { TrendingUp, TrendingDown, Calendar, Users, DollarSign, Target, Home, Activity } from 'lucide-react';

const Dashboard = () => {
  const [selectedView, setSelectedView] = useState('overview');

  // [Include all the dashboard component code from the previous artifact here]
  // Key metrics from the report
  const keyMetrics = {
    roomCost: 767,
    breakevenRoomRate: 1237,
    currentRoomRate: 1042,
    occupancyToDate: 46,
    targetOccupancy: 62,
    revenueToDate: 593854,
    breakevenRevenue: 1403169,
    varianceBehind: -356679,
    totalRooms: 59,
    roomsSold: 569,
    averageRoomRate: 1042
  };

  // Daily performance data
  const dailyData = [
    { day: 1, target: 45264, revenue: 29304, occupancy: 47, rate: 1047, met: false },
    { day: 2, target: 45264, revenue: 45045, occupancy: 75, rate: 1024, met: false },
    { day: 3, target: 45264, revenue: 26599, occupancy: 44, rate: 1023, met: false },
    { day: 4, target: 45264, revenue: 19847, occupancy: 32, rate: 1045, met: false },
    { day: 5, target: 45264, revenue: 23434, occupancy: 39, rate: 1019, met: false },
    { day: 6, target: 45264, revenue: 24675, occupancy: 41, rate: 1028, met: false },
    { day: 7, target: 45264, revenue: 26622, occupancy: 42, rate: 1065, met: false },
    { day: 8, target: 45264, revenue: 51237, occupancy: 81, rate: 1067, met: true },
    { day: 9, target: 45264, revenue: 64580, occupancy: 97, rate: 1133, met: true },
    { day: 10, target: 45264, revenue: 24925, occupancy: 39, rate: 1084, met: false },
    { day: 11, target: 45264, revenue: 22173, occupancy: 36, rate: 1056, met: false },
    { day: 12, target: 45264, revenue: 21229, occupancy: 36, rate: 1011, met: false },
    { day: 13, target: 45264, revenue: 26417, occupancy: 42, rate: 1057, met: false },
    { day: 14, target: 45264, revenue: 31669, occupancy: 53, rate: 1022, met: false },
    { day: 15, target: 45264, revenue: 25298, occupancy: 44, rate: 973, met: false },
    { day: 16, target: 45264, revenue: 40182, occupancy: 71, rate: 957, met: false },
    { day: 17, target: 45264, revenue: 19955, occupancy: 32, rate: 1050, met: false },
    { day: 18, target: 45264, revenue: 15982, occupancy: 27, rate: 999, met: false },
    { day: 19, target: 45264, revenue: 16869, occupancy: 27, rate: 1054, met: false },
    { day: 20, target: 45264, revenue: 17483, occupancy: 27, rate: 1093, met: false },
    { day: 21, target: 45264, revenue: 20328, occupancy: 32, rate: 1070, met: false }
  ];

  // Room type data
  const roomTypeData = [
    { type: 'Queen', rooms: 26, available: 806, sold: 247, revenue: 212699, rate: 861, occupancy: 31 },
    { type: 'Deluxe Studio', rooms: 10, available: 310, sold: 129, revenue: 106721, rate: 827, occupancy: 42 },
    { type: '1 Bed', rooms: 16, available: 496, sold: 258, revenue: 279158, rate: 1082, occupancy: 52 },
    { type: '2 Bed', rooms: 7, available: 217, sold: 129, revenue: 176339, rate: 1367, occupancy: 59 }
  ];

  // Historical data
  const yearlyData = [
    { year: '2022', roomsSold: 474, occupancy: 26, revenue: 573668, rate: 1210 },
    { year: '2023', roomsSold: 1115, occupancy: 61, revenue: 1881374, rate: 1687 },
    { year: '2024', roomsSold: 759, occupancy: 45, revenue: 701738, rate: 925 },
    { year: '2025', roomsSold: 569, occupancy: 46, revenue: 593854, rate: 1042 }
  ];

  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B'];

  const MetricCard = ({ title, value, subtitle, icon: Icon, trend, color = 'blue' }) => {
    const colorClasses = {
      blue: 'bg-blue-50 border-blue-200 text-blue-800',
      red: 'bg-red-50 border-red-200 text-red-800',
      green: 'bg-green-50 border-green-200 text-green-800',
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
        {trend && (
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
          value={`R${keyMetrics.revenueToDate.toLocaleString()}`}
          subtitle="vs R1,403,169 target"
          icon={DollarSign}
          color="blue"
        />
        <MetricCard
          title="Occupancy Rate"
          value={`${keyMetrics.occupancyToDate}%`}
          subtitle="vs 62% target"
          icon={Users}
          color={keyMetrics.occupancyToDate >= 62 ? 'green' : 'red'}
        />
        <MetricCard
          title="Average Room Rate"
          value={`R${keyMetrics.currentRoomRate}`}
          subtitle="vs R1,237 breakeven"
          icon={Home}
          color={keyMetrics.currentRoomRate >= 1237 ? 'green' : 'yellow'}
        />
        <MetricCard
          title="Target Variance"
          value={`R${Math.abs(keyMetrics.varianceBehind).toLocaleString()}`}
          subtitle="Behind target"
          icon={Target}
          color="red"
        />
      </div>

      {/* Progress Bars */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Progress to Breakeven</h3>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Revenue Progress</span>
              <span className="text-sm text-gray-500">42% of target</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-blue-600 h-3 rounded-full" style={{ width: '42%' }}></div>
            </div>
          </div>
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Occupancy Progress</span>
              <span className="text-sm text-gray-500">74% of target</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className="bg-green-600 h-3 rounded-full" style={{ width: '74%' }}></div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Revenue Chart */}
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h3 className="text-lg font-semibold mb-4">Daily Revenue vs Target</h3>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="day" />
              <YAxis />
              <Tooltip formatter={(value) => [`R${value.toLocaleString()}`, '']} />
              <Legend />
              <Bar dataKey="target" fill="#E5E7EB" name="Daily Target" />
              <Bar dataKey="revenue" fill="#3B82F6" name="Actual Revenue" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );

  const RoomTypesView = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {roomTypeData.map((room, index) => (
          <MetricCard
            key={room.type}
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
                <Tooltip formatter={(value) => [`R${value.toLocaleString()}`, 'Revenue']} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h3 className="text-lg font-semibold mb-4">Room Type Performance</h3>
          <div className="space-y-4">
            {roomTypeData.map((room, index) => (
              <div key={room.type} className="border-l-4 pl-4" style={{ borderColor: colors[index] }}>
                <div className="flex justify-between items-center">
                  <span className="font-medium">{room.type}</span>
                  <span className="text-sm text-gray-500">{room.sold}/{room.available}</span>
                </div>
                <div className="text-sm text-gray-600">
                  Revenue: R{room.revenue.toLocaleString()} | Rate: R{room.rate}
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                  <div 
                    className="h-2 rounded-full" 
                    style={{ 
                      width: `${room.occupancy}%`, 
                      backgroundColor: colors[index] 
                    }}
                  ></div>
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
                <Tooltip formatter={(value) => [`R${value.toLocaleString()}`, 'Revenue']} />
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
              {yearlyData.map((year) => (
                <tr key={year.year}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{year.year}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{year.roomsSold}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{year.occupancy}%</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">R{year.revenue.toLocaleString()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">R{year.rate}</td>
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
              <p className="text-sm text-gray-500">Revenue Dashboard - August 2025</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <p className="text-sm text-gray-500">Last Updated</p>
                <p className="text-sm font-medium">21 Aug 2025</p>
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