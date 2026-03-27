/**
 * @file pages/Dashboard.tsx
 * @description Main overview dashboard. Computes stats from orders fetched client-side.
 * Stats: today's orders, today's revenue, pending orders, awaiting bank-transfer confirmation.
 */
import { useMemo } from 'react';
import { ShoppingBag, TrendingUp, Clock, AlertCircle, Package } from 'lucide-react';
import { useAllOrders } from '../hooks/useOrders';
import { useVendor } from '../hooks/useVendor';
import { formatNairaShort, formatNaira } from '../utils/currency';
import StatusBadge from '../components/ui/StatusBadge';
import type { Order } from '../types';

function isToday(isoDate: string): boolean {
  const d = new Date(isoDate);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}

function StatCard({ icon, label, value, sub, accent = 'bg-brand-light text-brand-dark' }: StatCardProps) {
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${accent}`}>
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function RecentOrderRow({ order }: { order: Order }) {
  const name = order.customer.name ?? order.customer.whatsappNumber;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 truncate">{name}</p>
        <p className="text-xs text-gray-400 mt-0.5">
          {order.orderItems.map((i) => i.product.name).join(', ')}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-sm font-semibold text-gray-900">{formatNaira(order.totalAmount)}</p>
        <StatusBadge status={order.status} small />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: vendor } = useVendor();
  const { data: orders = [], isLoading } = useAllOrders();

  const stats = useMemo(() => {
    const todayOrders = orders.filter((o) => isToday(o.createdAt));
    const todayRevenue = todayOrders
      .filter((o) => o.status !== 'CANCELLED' && o.status !== 'PENDING_PAYMENT')
      .reduce((sum, o) => sum + o.totalAmount, 0);

    const pendingOrders = orders.filter((o) =>
      ['PENDING_PAYMENT', 'PAYMENT_CONFIRMED', 'CONFIRMED', 'PREPARING', 'READY'].includes(o.status),
    );

    const awaitingConfirmation = orders.filter((o) => o.status === 'PENDING_PAYMENT');

    return {
      todayCount: todayOrders.length,
      todayRevenue,
      pendingCount: pendingOrders.length,
      awaitingCount: awaitingConfirmation.length,
    };
  }, [orders]);

  const recentOrders = orders.slice(0, 5);

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {vendor ? `Good day, ${vendor.businessName}` : 'Dashboard'}
        </h1>
        <p className="text-gray-500 text-sm mt-0.5">Here's what's happening with your store today.</p>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card h-20 animate-pulse bg-gray-100" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard
            icon={<ShoppingBag size={22} />}
            label="Today's Orders"
            value={stats.todayCount}
            sub={stats.todayCount === 1 ? '1 order placed today' : `${stats.todayCount} orders placed today`}
            accent="bg-brand-light text-brand-dark"
          />
          <StatCard
            icon={<TrendingUp size={22} />}
            label="Today's Revenue"
            value={formatNairaShort(stats.todayRevenue)}
            sub="From confirmed orders"
            accent="bg-blue-100 text-blue-600"
          />
          <StatCard
            icon={<Clock size={22} />}
            label="Active Orders"
            value={stats.pendingCount}
            sub="Need your attention"
            accent="bg-orange-100 text-orange-600"
          />
          <StatCard
            icon={<AlertCircle size={22} />}
            label="Awaiting Payment"
            value={stats.awaitingCount}
            sub="Unconfirmed payments"
            accent="bg-yellow-100 text-yellow-600"
          />
        </div>
      )}

      {/* Recent orders */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900">Recent Orders</h2>
          <a href="/orders" className="text-sm text-brand font-medium hover:underline">
            View all
          </a>
        </div>

        {isLoading && (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && recentOrders.length === 0 && (
          <div className="text-center py-10">
            <Package size={32} className="text-gray-200 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No orders yet. Share your WhatsApp number to get started!</p>
          </div>
        )}

        {!isLoading && recentOrders.length > 0 && (
          <div>
            {recentOrders.map((order) => (
              <RecentOrderRow key={order.id} order={order} />
            ))}
          </div>
        )}
      </div>

      {/* Bot info */}
      {vendor && (
        <div className="card bg-brand-light border-brand/20">
          <h3 className="font-semibold text-brand-darker mb-1">Your WhatsApp Bot</h3>
          <p className="text-sm text-brand-dark">
            Customers can place orders by messaging{' '}
            <span className="font-bold">{vendor.whatsappNumber}</span> on WhatsApp.
          </p>
          <p className="text-xs text-brand-dark/60 mt-1">
            Make sure your WhatsApp number is active and the bot is running.
          </p>
        </div>
      )}
    </div>
  );
}
