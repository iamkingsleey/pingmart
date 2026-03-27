/**
 * @file components/orders/OrderDetail.tsx
 * @description Full order detail panel with status actions.
 * Physical order flow: PAYMENT_CONFIRMED -> CONFIRMED -> PREPARING -> READY -> DELIVERED
 * Digital order flow: PAYMENT_CONFIRMED -> DIGITAL_SENT (automatic)
 * Vendor can also cancel any non-final order.
 */
import { X, MapPin, Phone, Package, CreditCard, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Order, OrderStatus } from '../../types';
import StatusBadge from '../ui/StatusBadge';
import CurrencyDisplay from '../ui/CurrencyDisplay';
import { useUpdateOrderStatus } from '../../hooks/useOrders';
import { getErrorMessage } from '../../utils/api';
import { formatNaira } from '../../utils/currency';

interface Props {
  order: Order;
  onClose: () => void;
}

// Physical flow progression
const PHYSICAL_NEXT: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  PAYMENT_CONFIRMED: { status: 'CONFIRMED',  label: 'Confirm Order' },
  CONFIRMED:         { status: 'PREPARING',  label: 'Mark as Preparing' },
  PREPARING:         { status: 'READY',      label: 'Mark as Ready' },
  READY:             { status: 'DELIVERED',  label: 'Mark as Delivered' },
};

const FINAL_STATUSES: OrderStatus[] = ['DELIVERED', 'DIGITAL_SENT', 'CANCELLED'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-NG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function OrderDetail({ order, onClose }: Props) {
  const updateStatus = useUpdateOrderStatus();
  const isFinal = FINAL_STATUSES.includes(order.status);
  const nextStep = order.orderType === 'PHYSICAL' ? PHYSICAL_NEXT[order.status] : undefined;

  async function handleAdvance() {
    if (!nextStep) return;
    try {
      await updateStatus.mutateAsync({ orderId: order.id, status: nextStep.status });
      toast.success(`Order marked as ${nextStep.label}`);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  async function handleCancel() {
    try {
      await updateStatus.mutateAsync({ orderId: order.id, status: 'CANCELLED' });
      toast.success('Order cancelled');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto z-10">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-gray-900">
              Order #{order.id.slice(0, 8).toUpperCase()}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.status} />
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Customer */}
          <section>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Customer</h4>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-light flex items-center justify-center flex-shrink-0">
                <Phone size={16} className="text-brand-dark" />
              </div>
              <div>
                <p className="font-medium text-gray-900">
                  {order.customer.name ?? 'Unknown'}
                </p>
                <p className="text-sm text-gray-500">{order.customer.whatsappNumber}</p>
              </div>
            </div>
          </section>

          {/* Delivery address (physical only) */}
          {order.deliveryAddress && (
            <section>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Delivery Address</h4>
              <div className="flex items-start gap-2 text-sm text-gray-700">
                <MapPin size={15} className="text-brand mt-0.5 flex-shrink-0" />
                <span>{order.deliveryAddress}</span>
              </div>
            </section>
          )}

          {/* Order items */}
          <section>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Items</h4>
            <div className="space-y-2">
              {order.orderItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-gray-400" />
                    <span className="text-gray-700">{item.product.name}</span>
                    <span className="text-gray-400">× {item.quantity}</span>
                  </div>
                  <span className="font-medium text-gray-900">
                    {formatNaira(item.unitPrice * item.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 mt-3 pt-3 flex justify-between">
              <span className="font-semibold text-gray-700">Total</span>
              <CurrencyDisplay kobo={order.totalAmount} className="font-bold text-gray-900" />
            </div>
          </section>

          {/* Payment */}
          <section>
            <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Payment</h4>
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <CreditCard size={15} className="text-gray-400" />
              <span>
                {order.paystackReference
                  ? `Paystack — Ref: ${order.paystackReference}`
                  : 'Bank Transfer'}
              </span>
            </div>
            {order.paymentProcessed && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <Clock size={11} /> Payment confirmed
              </p>
            )}
          </section>

          {/* Notes */}
          {order.notes && (
            <section>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes</h4>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2">{order.notes}</p>
            </section>
          )}
        </div>

        {/* Action buttons */}
        {!isFinal && (
          <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-4 flex gap-3">
            {nextStep && (
              <button
                onClick={handleAdvance}
                disabled={updateStatus.isPending}
                className="btn-primary flex-1 text-sm"
              >
                {updateStatus.isPending ? 'Updating…' : nextStep.label}
              </button>
            )}
            {order.status !== 'CANCELLED' && (
              <button
                onClick={handleCancel}
                disabled={updateStatus.isPending}
                className="btn-danger text-sm px-4"
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {isFinal && (
          <div className="px-5 py-4 text-center text-sm text-gray-400">
            This order is complete
          </div>
        )}
      </div>
    </div>
  );
}
