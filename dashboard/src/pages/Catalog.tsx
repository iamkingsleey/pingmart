/**
 * @file pages/Catalog.tsx
 * @description Product catalog management page.
 */
import { Package } from 'lucide-react';
import ProductList from '../components/catalog/ProductList';

export default function Catalog() {
  return (
    <div className="px-4 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center">
          <Package size={20} className="text-purple-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Catalog</h1>
          <p className="text-sm text-gray-500">Manage your products and pricing</p>
        </div>
      </div>

      <ProductList />
    </div>
  );
}
