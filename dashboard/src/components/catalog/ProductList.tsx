/**
 * @file components/catalog/ProductList.tsx
 * @description Product grid with add / edit / delete / toggle-availability actions.
 */
import { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product } from '../../types';
import { useProducts, useUpdateProduct, useDeleteProduct } from '../../hooks/useProducts';
import ProductCard from './ProductCard';
import ProductForm from './ProductForm';
import ConfirmModal from '../ui/ConfirmModal';
import { getErrorMessage } from '../../utils/api';

export default function ProductList() {
  const { data: products = [], isLoading, isError, refetch, isFetching } = useProducts();
  const updateProduct = useUpdateProduct();
  const deleteProduct = useDeleteProduct();

  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Product | null>(null);

  function openCreate() {
    setEditingProduct(null);
    setShowForm(true);
  }

  function openEdit(product: Product) {
    setEditingProduct(product);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingProduct(null);
  }

  async function handleToggleAvailable(product: Product) {
    try {
      await updateProduct.mutateAsync({
        productId: product.id,
        dto: { isAvailable: !product.isAvailable },
      });
      toast.success(product.isAvailable ? 'Product hidden from customers' : 'Product is now visible');
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deletingProduct) return;
    try {
      await deleteProduct.mutateAsync(deletingProduct.id);
      toast.success('Product deleted');
      setDeletingProduct(null);
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <>
      {/* Header actions */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm text-gray-500">{products.length} product{products.length !== 1 ? 's' : ''} in your catalog</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="btn-secondary text-sm"
          >
            <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button onClick={openCreate} className="btn-primary text-sm flex items-center gap-1.5">
            <Plus size={16} />
            Add Product
          </button>
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="card animate-pulse h-64 bg-gray-100" />
          ))}
        </div>
      )}

      {isError && (
        <div className="card text-center py-16">
          <p className="text-gray-500 mb-3">Could not load products.</p>
          <button onClick={() => refetch()} className="btn-primary text-sm">Try Again</button>
        </div>
      )}

      {!isLoading && !isError && products.length === 0 && (
        <div className="card text-center py-20">
          <p className="text-5xl mb-4">🛍️</p>
          <p className="font-semibold text-gray-700 text-lg">No products yet</p>
          <p className="text-sm text-gray-400 mt-1 mb-5">Add your first product to start receiving orders.</p>
          <button onClick={openCreate} className="btn-primary text-sm">
            Add Your First Product
          </button>
        </div>
      )}

      {!isLoading && !isError && products.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onEdit={openEdit}
              onDelete={setDeletingProduct}
              onToggleAvailable={handleToggleAvailable}
              isUpdating={updateProduct.isPending}
            />
          ))}
        </div>
      )}

      {/* Modals */}
      {showForm && (
        <ProductForm product={editingProduct} onClose={closeForm} />
      )}

      {deletingProduct && (
        <ConfirmModal
          title="Delete product?"
          message={`"${deletingProduct.name}" will be permanently removed from your catalog. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          loading={deleteProduct.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setDeletingProduct(null)}
        />
      )}
    </>
  );
}
