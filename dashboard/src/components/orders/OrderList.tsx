/**
 * @file components/orders/OrderList.tsx
 * @description Filterable list of orders. Manages filter state locally
 * and delegates rendering to OrderCard.
 */
import { useState } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import type { Order, OrderStatus, OrderType } from '../../types';
import { useOrders } from '../../hooks/useOrders';
import OrderCard from './OrderCard';

interface Props {
  onSelect: (order: Order) => void;
}

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '',                  label: 'All Statuses' },
  { value: 'PENDING_PAYMENT',   label: 'Pending Payment' },
  { value: 'PAYMENT_CONFIRMED', label: 'Payment Confirmed' },
  { value: 'CONFIRMED',         label: 'Confirmed' },
  { value: 'PREPARING',         label: 'Preparing' },
  { value: 'READY',             label: 'Ready' },
  { value: 'DELIVERED',         label: 'Delivered' },
  { value: 'DIGITAL_SENT',      label: 'Sent Digitally' },
  { value: 'CANCELLED',         label: 'Cancelled' },
];

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '',         label: 'All Types' },
  { value: 'PHYSICAL', label: 'Physical' },
  { value: 'DIGITAL',  label: 'Digital' },
];

export default function OrderList({ onSelect }: Props) {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [orderType, setOrderType] = useState<OrderType | ''>('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading, isError, refetch, isFetching } = useOrders({
    status: status || undefined,
    orderType: orderType || undefined,
    page,
    limit,
  });

  const orders = data?.orders ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  function handleStatusChange(val: string) {
    setStatus(val as OrderStatus | '');
    setPage(1);
  }

  function handleTypeChange(val: string) {
    setOrderType(val as OrderType | '');
    setPage(1);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter size={16} className="text-gray-400" />
        <select
          value={status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="input !w-auto text-sm"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={orderType}
          onChange={(e) => handleTypeChange(e.target.value)}
          className="input !w-auto text-sm"
        >
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn-secondary text-sm flex items-center gap-1.5"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
        <span className="text-sm text-gray-400 ml-auto">{total} order{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse h-20 bg-gray-100" />
          ))}
        </div>
      )}

      {isError && (
        <div className="card text-center py-10">
          <p className="text-gray-500 mb-3">Could not load orders.</p>
          <button onClick={() => refetch()} className="btn-primary text-sm">Try Again</button>
        </div>
      )}

      {!isLoading && !isError && orders.length === 0 && (
        <div className="card text-center py-16">
          <p className="text-4xl mb-3">📦</p>
          <p className="font-semibold text-gray-700">No orders yet</p>
          <p className="text-sm text-gray-400 mt-1">
            {status || orderType ? 'Try changing your filters.' : 'Orders will appear here when customers place them.'}
          </p>
        </div>
      )}

      {!isLoading && !isError && orders.length > 0 && (
        <div className="space-y-3">
          {orders.map((order) => (
            <OrderCard key={order.id} order={order} onClick={onSelect} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || isFetching}
            className="btn-secondary text-sm"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || isFetching}
            className="btn-secondary text-sm"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
