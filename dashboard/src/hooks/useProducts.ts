/**
 * @file hooks/useProducts.ts
 * @description React Query hooks for product catalog management.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getVendorId } from '../utils/api';
import type { Product, CreateProductDto, UpdateProductDto, ApiSuccess } from '../types';

const PRODUCTS_KEY = (vendorId: string) => ['products', vendorId];

export function useProducts() {
  const vendorId = getVendorId();
  return useQuery({
    queryKey: PRODUCTS_KEY(vendorId),
    queryFn: async (): Promise<Product[]> => {
      const res = await api.get<ApiSuccess<Product[]>>(`/vendors/${vendorId}/products`);
      return res.data.data;
    },
    enabled: !!vendorId,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async (dto: CreateProductDto): Promise<Product> => {
      const res = await api.post<ApiSuccess<Product>>(`/vendors/${vendorId}/products`, dto);
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY(vendorId) });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async ({
      productId,
      dto,
    }: {
      productId: string;
      dto: UpdateProductDto;
    }): Promise<Product> => {
      const res = await api.patch<ApiSuccess<Product>>(
        `/vendors/${vendorId}/products/${productId}`,
        dto,
      );
      return res.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY(vendorId) });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async (productId: string): Promise<void> => {
      await api.delete(`/vendors/${vendorId}/products/${productId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTS_KEY(vendorId) });
    },
  });
}

/** Upload a cover image for a product. Returns the hosted image URL. */
export function useUploadCover() {
  const vendorId = getVendorId();

  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const formData = new FormData();
      formData.append('cover', file);
      const res = await api.post<ApiSuccess<{ imageUrl: string }>>(
        `/vendors/${vendorId}/products/cover`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      return res.data.data.imageUrl;
    },
  });
}
