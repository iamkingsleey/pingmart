/**
 * @file utils/api.ts
 * @description Axios instance with auth header injection and 401 handling.
 * API key is read from localStorage on every request so it stays fresh after login.
 */
import axios from 'axios';

export const STORAGE_KEY = 'pingmart_api_key';
export const VENDOR_ID_KEY = 'pingmart_vendor_id';

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Inject Authorization header on every request
api.interceptors.request.use((config) => {
  const apiKey = localStorage.getItem(STORAGE_KEY);
  if (apiKey) {
    config.headers.Authorization = `Bearer ${apiKey}`;
  }
  return config;
});

// On 401, clear auth and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VENDOR_ID_KEY);
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export function getVendorId(): string {
  return localStorage.getItem(VENDOR_ID_KEY) ?? '';
}

export function isAuthenticated(): boolean {
  return !!(localStorage.getItem(STORAGE_KEY) && localStorage.getItem(VENDOR_ID_KEY));
}

export function logout(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(VENDOR_ID_KEY);
  window.location.href = '/login';
}

/** Extract a human-readable error message from an axios error */
export function getErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: { message?: string }; message?: string } | undefined;
    return data?.error?.message ?? data?.message ?? err.message ?? 'Something went wrong';
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
