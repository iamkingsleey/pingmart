/**
 * @file pages/Analytics.tsx
 * @description Sales analytics page. All data computed client-side from order history.
 * Charts: daily revenue (7 days), orders by status (pie), order type split.
 */
import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import { BarChart2, TrendingUp, ShoppingBag, Zap } from 'lucide-react';
import { useAllOrders } from '../hooks/useOrders';
import { formatNairaShort, formatNaira } from '../utils/currency';
import type { Order, OrderStatus } from '../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dayLabel(date: Date): string {
  return date.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' });
}

function getLast7Days(): { date: Date; label: string }[] {
  const days: { date: Date; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    days.push({ date: d, label: dayLabel(d) });
  }
  return days;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT:   'Pending Payment',
  PAYMENT_CONFIRMED: 'Payment Confirmed',
  CONFIRMED:         'Confirmed',
  PREPARING:         'Preparing',
  READY:             'Ready',
  DELIVERED:         'Delivered',
  DIGITAL_SENT:      'Sent Digitally',
  CANCELLED:         'Cancelled',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  PENDING_PAYMENT:   '#FBBF24',
  PAYMENT_CONFIRMED: '#60A5FA',
  CONFIRMED:         '#818CF8',
  PREPARING:         '#C084FC',
  READY:             '#25D366',
  DELIVERED:         '#34D399',
  DIGITAL_SENT:      '#2DD4BF',
  CANCELLED:         '#F87171',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}

function SummaryCard({ icon, label, value, accent }: SummaryCardProps) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div>
        <p className="text-xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
      </div>
    </div>
  );
}

// ─── Custom tooltip for revenue chart ────────────────────────────────────────

function RevenueTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium text-gray-700">{label}</p>
      <p className="text-brand font-bold">{formatNaira((payload[0]?.value ?? 0) * 100)}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: orders = [], isLoading } = useAllOrders();

  const {
    dailyRevenue,
    statusBreakdown,
    summaryStats,
    typeData,
  } = useMemo(() => {
    // Only count non-cancelled, non-pending for revenue
    const paidOrders = orders.filter(
      (o) => o.status !== 'CANCELLED' && o.status !== 'PENDING_PAYMENT',
    );

    // Daily revenue (last 7 days)
    const days = getLast7Days();
    const dailyRevenue = days.map(({ date, label }) => {
      const dayOrders = paidOrders.filter((o) => isSameDay(new Date(o.createdAt), date));
      const revenueNaira = dayOrders.reduce((s, o) => s + o.totalAmount, 0) / 100;
      return { label, revenue: revenueNaira, count: dayOrders.length };
    });

    // Status breakdown
    const statusMap: Partial<Record<OrderStatus, number>> = {};
    orders.forEach((o) => {
      statusMap[o.status] = (statusMap[o.status] ?? 0) + 1;
    });
    const statusBreakdown = (Object.entries(statusMap) as [OrderStatus, number][])
      .map(([status, count]) => ({
        name: STATUS_LABELS[status],
        value: count,
        color: STATUS_COLORS[status],
      }))
      .sort((a, b) => b.value - a.value);

    // Physical vs Digital
    const physicalCount = orders.filter((o) => o.orderType === 'PHYSICAL').length;
    const digitalCount = orders.filter((o) => o.orderType === 'DIGITAL').length;
    const typeData = [
      { name: 'Physical', count: physicalCount, fill: '#F97316' },
      { name: 'Digital', count: digitalCount, fill: '#8B5CF6' },
    ];

    // Summary totals
    const totalRevenue = paidOrders.reduce((s, o) => s + o.totalAmount, 0);
    const totalOrders = orders.length;
    const avgOrderValue = paidOrders.length > 0 ? totalRevenue / paidOrders.length : 0;
    const completedOrders = orders.filter(
      (o: Order) => o.status === 'DELIVERED' || o.status === 'DIGITAL_SENT',
    ).length;

    return {
      dailyRevenue,
      statusBreakdown,
      summaryStats: { totalRevenue, totalOrders, avgOrderValue, completedOrders },
      typeData,
    };
  }, [orders]);

  if (isLoading) {
    return (
      <div className="px-4 py-6 max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="card h-20 bg-gray-100 animate-pulse" />)}
        </div>
        <div className="card h-64 bg-gray-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <BarChart2 size={20} className="text-blue-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Based on your last 100 orders</p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4">
        <SummaryCard
          icon={<TrendingUp size={20} />}
          label="Total Revenue"
          value={formatNairaShort(summaryStats.totalRevenue)}
          accent="bg-brand-light text-brand-dark"
        />
        <SummaryCard
          icon={<ShoppingBag size={20} />}
          label="Total Orders"
          value={String(summaryStats.totalOrders)}
          accent="bg-blue-100 text-blue-600"
        />
        <SummaryCard
          icon={<TrendingUp size={20} />}
          label="Avg Order Value"
          value={formatNairaShort(summaryStats.avgOrderValue)}
          accent="bg-purple-100 text-purple-600"
        />
        <SummaryCard
          icon={<Zap size={20} />}
          label="Completed Orders"
          value={String(summaryStats.completedOrders)}
          accent="bg-green-100 text-green-600"
        />
      </div>

      {/* Daily revenue chart */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-4">Revenue — Last 7 Days</h2>
        {dailyRevenue.every((d) => d.revenue === 0) ? (
          <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
            No revenue data for the last 7 days
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={dailyRevenue} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#25D366" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#25D366" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `₦${v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}`}
              />
              <Tooltip content={<RevenueTooltip />} />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#25D366"
                strokeWidth={2}
                fill="url(#revGrad)"
                dot={{ r: 3, fill: '#25D366' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Order type bar chart */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-4">Order Types</h2>
        {summaryStats.totalOrders === 0 ? (
          <div className="h-32 flex items-center justify-center text-gray-400 text-sm">No orders yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={typeData} layout="vertical" margin={{ left: 8, right: 8 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} width={60} />
              <Tooltip formatter={(v: number) => [v, 'Orders']} />
              <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                {typeData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Status breakdown */}
      {statusBreakdown.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-4">Orders by Status</h2>
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <ResponsiveContainer width={180} height={180}>
              <PieChart>
                <Pie
                  data={statusBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {statusBreakdown.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [v, 'orders']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {statusBreakdown.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-700">{item.name}</span>
                  </div>
                  <span className="font-semibold text-gray-900">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
