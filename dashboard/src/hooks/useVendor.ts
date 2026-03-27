/**
 * @file hooks/useVendor.ts
 * @description React Query hooks for vendor profile and settings.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getVendorId } from '../utils/api';
import type { Vendor, UpdateVendorDto, ApiSuccess } from '../types';

const VENDOR_KEY = (id: string) => ['vendor', id];

export function useVendor() {
  const vendorId = getVendorId();
  return useQuery({
    queryKey: VENDOR_KEY(vendorId),
    queryFn: async (): Promise<Vendor> => {
      const res = await api.get<ApiSuccess<Vendor>>(`/vendors/${vendorId}`);
      return res.data.data;
    },
    enabled: !!vendorId,
  });
}

export function useUpdateVendor() {
  const queryClient = useQueryClient();
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async (dto: UpdateVendorDto): Promise<Vendor> => {
      const res = await api.patch<ApiSuccess<Vendor>>(`/vendors/${vendorId}`, dto);
      return res.data.data;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(VENDOR_KEY(vendorId), updated);
    },
  });
}
