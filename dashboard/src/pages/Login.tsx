/**
 * @file pages/Login.tsx
 * @description Vendor login page.
 * Flow:
 * 1. Vendor enters their API key + Vendor ID (shown at registration)
 * 2. We test-fetch GET /api/vendors/:vendorId with the key
 * 3. On 200 store both in localStorage and redirect to /dashboard
 * 4. On 401/404 show an error message
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, MessageCircle } from 'lucide-react';
import { api, STORAGE_KEY, VENDOR_ID_KEY, isAuthenticated } from '../utils/api';
import type { Vendor, ApiSuccess } from '../types';
import { getErrorMessage } from '../utils/api';

export default function Login() {
  const navigate = useNavigate();
  const [apiKey, setApiKey] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Already logged in → go to dashboard
  useEffect(() => {
    if (isAuthenticated()) navigate('/dashboard', { replace: true });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!apiKey.trim() || !vendorId.trim()) {
      setError('Please enter both your Vendor ID and API key.');
      return;
    }

    setLoading(true);
    try {
      // Temporarily set the key so the interceptor picks it up
      localStorage.setItem(STORAGE_KEY, apiKey.trim());
      localStorage.setItem(VENDOR_ID_KEY, vendorId.trim());

      // Verify credentials by fetching the vendor profile
      await api.get<ApiSuccess<Vendor>>(`/vendors/${vendorId.trim()}`);

      // Success — redirect
      navigate('/dashboard', { replace: true });
    } catch (err) {
      // Clear storage on failure
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VENDOR_ID_KEY);

      const msg = getErrorMessage(err);
      if (msg.toLowerCase().includes('401') || msg.toLowerCase().includes('unauthorized')) {
        setError('Invalid API key. Please check and try again.');
      } else if (msg.toLowerCase().includes('404') || msg.toLowerCase().includes('not found')) {
        setError('Vendor ID not found. Please double-check your ID.');
      } else {
        setError(msg || 'Could not sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-darker to-brand-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white/15 mb-4">
            <MessageCircle size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white">Pingmart</h1>
          <p className="text-white/60 mt-1 text-sm">Vendor Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-6">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Sign in to your dashboard</h2>
          <p className="text-sm text-gray-500 mb-6">
            Use the Vendor ID and API key you received when you registered.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Vendor ID */}
            <div>
              <label className="label">Vendor ID</label>
              <input
                type="text"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                placeholder="e.g. clxyz123abc…"
                className="input font-mono text-sm"
                autoComplete="username"
                spellCheck={false}
              />
            </div>

            {/* API Key */}
            <div>
              <label className="label">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="pm_…"
                  className="input pr-10 font-mono text-sm"
                  autoComplete="current-password"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full mt-2"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center mt-5">
            Don't have an account?{' '}
            <span className="text-gray-600 font-medium">
              Contact your Pingmart administrator to get registered.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
