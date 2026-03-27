/**
 * @file pages/Settings.tsx
 * @description Vendor settings: profile info and bank account details.
 * Maps to PATCH /api/vendors/:id (updateVendorSchema).
 * Fields: businessName, phoneNumber, isActive, bankAccountNumber (encrypted by backend).
 */
import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Store, CreditCard, Power, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useVendor, useUpdateVendor } from '../hooks/useVendor';
import { getErrorMessage } from '../utils/api';

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
        <div className="text-brand">{icon}</div>
        <h2 className="font-semibold text-gray-900">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { data: vendor, isLoading } = useVendor();
  const updateVendor = useUpdateVendor();

  // Profile form state
  const [businessName, setBusinessName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Bank account form state
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [showAccountNumber, setShowAccountNumber] = useState(false);

  // Sync from API data
  useEffect(() => {
    if (vendor) {
      setBusinessName(vendor.businessName);
      setPhoneNumber(vendor.phoneNumber);
      setIsActive(vendor.isActive);
    }
  }, [vendor]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!businessName.trim()) { toast.error('Business name is required'); return; }
    if (!phoneNumber.trim()) { toast.error('Phone number is required'); return; }

    try {
      await updateVendor.mutateAsync({
        businessName: businessName.trim(),
        phoneNumber: phoneNumber.trim(),
        isActive,
      });
      toast.success('Profile updated!');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  async function handleSaveBankAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!bankAccountNumber.trim()) { toast.error('Please enter your bank account number'); return; }
    if (!/^\d+$/.test(bankAccountNumber.trim())) { toast.error('Account number must be numeric digits only'); return; }

    try {
      await updateVendor.mutateAsync({ bankAccountNumber: bankAccountNumber.trim() });
      toast.success('Bank account updated! The number is stored securely.');
      setBankAccountNumber('');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  if (isLoading) {
    return (
      <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
        {[...Array(2)].map((_, i) => (
          <div key={i} className="card h-48 bg-gray-100 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!vendor) {
    return (
      <div className="px-4 py-6 max-w-2xl mx-auto">
        <div className="card text-center py-16 text-gray-400">Could not load vendor profile.</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <SettingsIcon size={20} className="text-gray-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500">Manage your store profile and payment info</p>
        </div>
      </div>

      {/* Vendor info (read-only) */}
      <div className="card bg-gray-50 border-gray-200">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-400 text-xs uppercase font-medium mb-0.5">Vendor ID</p>
            <p className="font-mono text-gray-700 text-xs break-all">{vendor.id}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase font-medium mb-0.5">WhatsApp Number</p>
            <p className="text-gray-700">{vendor.whatsappNumber}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase font-medium mb-0.5">Store Type</p>
            <p className="text-gray-700 capitalize">{vendor.vendorType.replace('_', ' ').toLowerCase()}</p>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase font-medium mb-0.5">Status</p>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${vendor.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
              {vendor.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Profile form */}
      <Section title="Store Profile" icon={<Store size={18} />}>
        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label">Business Name</label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Your store name"
              className="input"
              required
              minLength={2}
              maxLength={100}
            />
          </div>

          <div>
            <label className="label">Contact Phone Number</label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+234XXXXXXXXXX"
              className="input"
              required
            />
            <p className="text-xs text-gray-400 mt-1">Format: +234XXXXXXXXXX (Nigerian number)</p>
          </div>

          {/* Store active toggle */}
          <div className="flex items-center justify-between py-1">
            <div>
              <p className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Power size={14} />
                Store Active
              </p>
              <p className="text-xs text-gray-400">When inactive, the WhatsApp bot will not respond</p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isActive ? 'bg-brand' : 'bg-gray-300'}`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
          </div>

          <button
            type="submit"
            disabled={updateVendor.isPending}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Save size={16} />
            {updateVendor.isPending ? 'Saving…' : 'Save Profile'}
          </button>
        </form>
      </Section>

      {/* Bank account form */}
      <Section title="Bank Account" icon={<CreditCard size={18} />}>
        <p className="text-sm text-gray-500">
          Your account number is encrypted and stored securely. It is used for bank transfer orders.
          {vendor.bankAccountNumber && (
            <span className="text-gray-700 font-medium"> Current: ending in ****{vendor.bankAccountNumber.slice(-4)}</span>
          )}
        </p>

        <form onSubmit={handleSaveBankAccount} className="space-y-4">
          <div>
            <label className="label">
              {vendor.bankAccountNumber ? 'Update Account Number' : 'Bank Account Number'}
            </label>
            <div className="relative">
              <input
                type={showAccountNumber ? 'text' : 'password'}
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ''))}
                placeholder={vendor.bankAccountNumber ? 'Enter new account number' : 'e.g. 0123456789'}
                className="input pr-20"
                maxLength={20}
              />
              <button
                type="button"
                onClick={() => setShowAccountNumber((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 font-medium"
              >
                {showAccountNumber ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">Digits only — this is stored encrypted</p>
          </div>

          <button
            type="submit"
            disabled={updateVendor.isPending || !bankAccountNumber}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <Save size={16} />
            {updateVendor.isPending ? 'Saving…' : 'Save Bank Account'}
          </button>
        </form>
      </Section>

      {/* Danger zone */}
      <div className="card border-red-200">
        <h2 className="font-semibold text-red-700 mb-2">Danger Zone</h2>
        <p className="text-sm text-gray-500 mb-4">
          Deactivating your store will stop the WhatsApp bot from responding to new messages.
          Existing orders will not be affected.
        </p>
        {vendor.isActive ? (
          <button
            onClick={() => updateVendor.mutateAsync({ isActive: false }).then(() => toast.success('Store deactivated')).catch((e) => toast.error(getErrorMessage(e)))}
            disabled={updateVendor.isPending}
            className="btn-danger text-sm"
          >
            Deactivate Store
          </button>
        ) : (
          <button
            onClick={() => updateVendor.mutateAsync({ isActive: true }).then(() => toast.success('Store reactivated!')).catch((e) => toast.error(getErrorMessage(e)))}
            disabled={updateVendor.isPending}
            className="btn-primary text-sm"
          >
            Reactivate Store
          </button>
        )}
      </div>
    </div>
  );
}
