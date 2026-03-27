/**
 * @file components/orders/OrderCard.tsx
 * @description Single order row card for the orders list.
 */
import { ChevronRight, MapPin, Smartphone } from 'lucide-react';
import type { Order } from '../../types';
import StatusBadge from '../ui/StatusBadge';
import CurrencyDisplay from '../ui/CurrencyDisplay';

interface Props {
  order: Order;
  onClick: (order: Order) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrderCard({ order, onClick }: Props) {
  const customerName = order.customer.name ?? order.customer.whatsappNumber;
  const itemCount = order.orderItems.reduce((s, i) => s + i.quantity, 0);

  return (
    <button
      onClick={() => onClick(order)}
      className="w-full text-left card hover:shadow-md transition-shadow flex items-center gap-4 group"
    >
      {/* Type icon */}
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          order.orderType === 'DIGITAL'
            ? 'bg-purple-100 text-purple-600'
            : 'bg-orange-100 text-orange-600'
        }`}
      >
        {order.orderType === 'DIGITAL' ? <Smartphone size={18} /> : <MapPin size={18} />}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-gray-900 text-sm truncate">{customerName}</p>
          <CurrencyDisplay kobo={order.totalAmount} className="font-bold text-sm text-gray-900 flex-shrink-0" />
        </div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <StatusBadge status={order.status} small />
          <span className="text-xs text-gray-400">
            {itemCount} item{itemCount !== 1 ? 's' : ''} · {formatDate(order.createdAt)}
          </span>
        </div>
        <p className="text-xs text-gray-400 mt-0.5 truncate">
          #{order.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      <ChevronRight size={16} className="text-gray-300 group-hover:text-gray-400 flex-shrink-0" />
    </button>
  );
}
