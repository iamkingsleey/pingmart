/**
 * @file components/ui/StatusBadge.tsx
 * @description Color-coded pill badge for order status values.
 */
import type { OrderStatus } from '../../types';

interface Props {
  status: OrderStatus;
  small?: boolean;
}

const CONFIG: Record<OrderStatus, { label: string; classes: string }> = {
  PENDING_PAYMENT:   { label: 'Pending Payment',   classes: 'bg-yellow-100 text-yellow-800' },
  PAYMENT_CONFIRMED: { label: 'Payment Confirmed',  classes: 'bg-blue-100 text-blue-800' },
  CONFIRMED:         { label: 'Confirmed',           classes: 'bg-indigo-100 text-indigo-800' },
  PREPARING:         { label: 'Preparing',           classes: 'bg-purple-100 text-purple-800' },
  READY:             { label: 'Ready',               classes: 'bg-brand-light text-brand-dark' },
  DELIVERED:         { label: 'Delivered',           classes: 'bg-green-100 text-green-800' },
  DIGITAL_SENT:      { label: 'Sent Digitally',      classes: 'bg-teal-100 text-teal-800' },
  CANCELLED:         { label: 'Cancelled',           classes: 'bg-red-100 text-red-700' },
};

export default function StatusBadge({ status, small }: Props) {
  const { label, classes } = CONFIG[status] ?? { label: status, classes: 'bg-gray-100 text-gray-700' };
  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${small ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1'} ${classes}`}
    >
      {label}
    </span>
  );
}
