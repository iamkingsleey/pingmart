/**
 * @file hooks/useOrders.ts
 * @description React Query hooks for order management.
 * The backend PATCH endpoint for status updates uses the vendor updateVendor route.
 * Order status updates are done via PATCH /api/vendors/:vendorId/orders/:orderId
 * (implemented in the order service layer).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getVendorId } from '../utils/api';
import type { Order, OrderStatus, OrderType, OrdersResponse, ApiSuccess } from '../types';

export interface OrderFilters {
  status?: OrderStatus;
  orderType?: OrderType;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

const ORDERS_KEY = (vendorId: string, filters: OrderFilters) => ['orders', vendorId, filters];
const ORDER_KEY = (vendorId: string, orderId: string) => ['order', vendorId, orderId];

export function useOrders(filters: OrderFilters = {}) {
  const vendorId = getVendorId();
  return useQuery({
    queryKey: ORDERS_KEY(vendorId, filters),
    queryFn: async (): Promise<OrdersResponse> => {
      const params: Record<string, string> = {};
      if (filters.status) params['status'] = filters.status;
      if (filters.orderType) params['orderType'] = filters.orderType;
      if (filters.dateFrom) params['dateFrom'] = filters.dateFrom;
      if (filters.dateTo) params['dateTo'] = filters.dateTo;
      if (filters.page) params['page'] = String(filters.page);
      if (filters.limit) params['limit'] = String(filters.limit);

      const res = await api.get<ApiSuccess<OrdersResponse>>(`/vendors/${vendorId}/orders`, { params });
      return res.data.data;
    },
    enabled: !!vendorId,
  });
}

/** Fetch ALL orders (up to 100) for analytics / stats computation */
export function useAllOrders() {
  const vendorId = getVendorId();
  return useQuery({
    queryKey: ['orders-all', vendorId],
    queryFn: async (): Promise<Order[]> => {
      const res = await api.get<ApiSuccess<OrdersResponse>>(`/vendors/${vendorId}/orders`, {
        params: { limit: '100', page: '1' },
      });
      return res.data.data.orders;
    },
    enabled: !!vendorId,
    staleTime: 60_000,
  });
}

export function useOrder(orderId: string) {
  const vendorId = getVendorId();
  return useQuery({
    queryKey: ORDER_KEY(vendorId, orderId),
    queryFn: async (): Promise<Order> => {
      const res = await api.get<ApiSuccess<Order>>(`/vendors/${vendorId}/orders/${orderId}`);
      return res.data.data;
    },
    enabled: !!vendorId && !!orderId,
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }): Promise<Order> => {
      const res = await api.patch<ApiSuccess<Order>>(
        `/vendors/${vendorId}/orders/${orderId}`,
        { status },
      );
      return res.data.data;
    },
    onSuccess: (updated, { orderId }) => {
      queryClient.setQueryData(ORDER_KEY(vendorId, orderId), updated);
      // Invalidate order lists so they refresh
      queryClient.invalidateQueries({ queryKey: ['orders', vendorId] });
      queryClient.invalidateQueries({ queryKey: ['orders-all', vendorId] });
    },
  });
}
