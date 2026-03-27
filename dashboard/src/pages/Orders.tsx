/**
 * @file pages/Orders.tsx
 * @description Full orders management page with filter bar and order detail slide-up.
 */
import { useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { Order } from '../types';
import OrderList from '../components/orders/OrderList';
import OrderDetail from '../components/orders/OrderDetail';

export default function Orders() {
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center">
          <ShoppingBag size={20} className="text-brand-dark" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
          <p className="text-sm text-gray-500">Manage and track customer orders</p>
        </div>
      </div>

      <OrderList onSelect={setSelectedOrder} />

      {selectedOrder && (
        <OrderDetail
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
        />
      )}
    </div>
  );
}
