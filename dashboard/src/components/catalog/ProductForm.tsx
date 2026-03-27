/**
 * @file components/catalog/ProductForm.tsx
 * @description Create / edit product modal form.
 * Handles both physical and digital product types with conditional fields.
 */
import { useState, useEffect } from 'react';
import { X, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product, CreateProductDto, UpdateProductDto, ProductType, DeliveryType } from '../../types';
import { useCreateProduct, useUpdateProduct, useUploadCover } from '../../hooks/useProducts';
import { nairaToKobo, koboToNaira } from '../../utils/currency';
import { getErrorMessage } from '../../utils/api';

interface Props {
  product?: Product | null;
  onClose: () => void;
}

interface FormState {
  name: string;
  description: string;
  priceNaira: string;
  category: string;
  productType: ProductType;
  imageUrl: string;
  isAvailable: boolean;
  stockCount: string;
  deliveryType: DeliveryType | '';
  deliveryContent: string;
  deliveryMessage: string;
}

const EMPTY: FormState = {
  name: '',
  description: '',
  priceNaira: '',
  category: '',
  productType: 'PHYSICAL',
  imageUrl: '',
  isAvailable: true,
  stockCount: '',
  deliveryType: '',
  deliveryContent: '',
  deliveryMessage: '',
};

function productToForm(p: Product): FormState {
  return {
    name: p.name,
    description: p.description ?? '',
    priceNaira: String(koboToNaira(p.price)),
    category: p.category ?? '',
    productType: p.productType,
    imageUrl: p.imageUrl ?? '',
    isAvailable: p.isAvailable,
    stockCount: p.stockCount !== null && p.stockCount !== undefined ? String(p.stockCount) : '',
    deliveryType: p.deliveryType ?? '',
    deliveryContent: p.deliveryContent ?? '',
    deliveryMessage: p.deliveryMessage ?? '',
  };
}

export default function ProductForm({ product, onClose }: Props) {
  const isEditing = !!product;
  const [form, setForm] = useState<FormState>(product ? productToForm(product) : EMPTY);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string>(product?.imageUrl ?? '');

  const createProduct = useCreateProduct();
  const updateProduct = useUpdateProduct();
  const uploadCover = useUploadCover();
  const isLoading = createProduct.isPending || updateProduct.isPending || uploadCover.isPending;

  useEffect(() => {
    if (product) {
      setForm(productToForm(product));
      setCoverPreview(product.imageUrl ?? '');
    }
  }, [product]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!form.name.trim()) { toast.error('Product name is required'); return; }
    const priceKobo = nairaToKobo(form.priceNaira);
    if (priceKobo <= 0) { toast.error('Enter a valid price greater than ₦0'); return; }
    if (form.productType === 'DIGITAL' && !form.deliveryType) {
      toast.error('Select a delivery type for digital products'); return;
    }
    if (form.productType === 'DIGITAL' && form.deliveryType === 'LINK' && !form.deliveryContent.trim()) {
      toast.error('Enter the download link for this digital product'); return;
    }

    try {
      // Upload cover image if a new file was selected
      let finalImageUrl = form.imageUrl;
      if (coverFile) {
        finalImageUrl = await uploadCover.mutateAsync(coverFile);
      }

      if (isEditing && product) {
        const dto: UpdateProductDto = {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          price: priceKobo,
          category: form.category.trim() || undefined,
          imageUrl: finalImageUrl || undefined,
          isAvailable: form.isAvailable,
          stockCount: form.productType === 'PHYSICAL' && form.stockCount ? parseInt(form.stockCount, 10) : undefined,
          deliveryType: form.productType === 'DIGITAL' && form.deliveryType ? form.deliveryType : undefined,
          deliveryContent: form.productType === 'DIGITAL' ? form.deliveryContent.trim() || undefined : undefined,
          deliveryMessage: form.productType === 'DIGITAL' ? form.deliveryMessage.trim() || undefined : undefined,
        };
        await updateProduct.mutateAsync({ productId: product.id, dto });
        toast.success('Product updated!');
      } else {
        const dto: CreateProductDto = {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          price: priceKobo,
          category: form.category.trim() || undefined,
          productType: form.productType,
          imageUrl: finalImageUrl || undefined,
          isAvailable: form.isAvailable,
          stockCount: form.productType === 'PHYSICAL' && form.stockCount ? parseInt(form.stockCount, 10) : undefined,
          deliveryType: form.productType === 'DIGITAL' && form.deliveryType ? (form.deliveryType as DeliveryType) : undefined,
          deliveryContent: form.productType === 'DIGITAL' ? form.deliveryContent.trim() || undefined : undefined,
          deliveryMessage: form.productType === 'DIGITAL' ? form.deliveryMessage.trim() || undefined : undefined,
        };
        await createProduct.mutateAsync(dto);
        toast.success('Product added to your catalog!');
      }
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[95vh] overflow-y-auto z-10">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">{isEditing ? 'Edit Product' : 'Add New Product'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Product type (only for new products) */}
          {!isEditing && (
            <div>
              <label className="label">Product Type</label>
              <div className="grid grid-cols-2 gap-2">
                {(['PHYSICAL', 'DIGITAL'] as ProductType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => set('productType', t)}
                    className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      form.productType === t
                        ? 'border-brand bg-brand-light text-brand-dark'
                        : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {t === 'PHYSICAL' ? '📦 Physical' : '⚡ Digital'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Cover image */}
          <div>
            <label className="label">Cover Image (optional)</label>
            <div className="flex items-center gap-3">
              {coverPreview ? (
                <img src={coverPreview} alt="Cover" className="w-16 h-16 object-cover rounded-lg border border-gray-200" />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-gray-100 flex items-center justify-center border border-dashed border-gray-300">
                  <Upload size={18} className="text-gray-300" />
                </div>
              )}
              <label className="btn-secondary text-sm cursor-pointer">
                {coverPreview ? 'Change Image' : 'Upload Image'}
                <input type="file" accept="image/*" className="hidden" onChange={handleCoverChange} />
              </label>
            </div>
            {/* URL fallback */}
            <input
              type="url"
              placeholder="Or paste an image URL"
              value={form.imageUrl}
              onChange={(e) => { set('imageUrl', e.target.value); setCoverPreview(e.target.value); setCoverFile(null); }}
              className="input mt-2 text-xs"
            />
          </div>

          {/* Name */}
          <div>
            <label className="label">Product Name *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. Jollof Rice (large)"
              className="input"
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="label">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Brief description shown to customers"
              rows={2}
              className="input resize-none"
            />
          </div>

          {/* Price */}
          <div>
            <label className="label">Price (₦) *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm font-medium">₦</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.priceNaira}
                onChange={(e) => set('priceNaira', e.target.value)}
                placeholder="0.00"
                className="input pl-7"
                required
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <label className="label">Category (optional)</label>
            <input
              type="text"
              value={form.category}
              onChange={(e) => set('category', e.target.value)}
              placeholder="e.g. Food, Electronics, Clothing"
              className="input"
            />
          </div>

          {/* Physical-only: stock count */}
          {form.productType === 'PHYSICAL' && (
            <div>
              <label className="label">Stock Count (optional)</label>
              <input
                type="number"
                min="0"
                value={form.stockCount}
                onChange={(e) => set('stockCount', e.target.value)}
                placeholder="Leave blank for unlimited"
                className="input"
              />
            </div>
          )}

          {/* Digital-only: delivery fields */}
          {form.productType === 'DIGITAL' && (
            <>
              <div>
                <label className="label">Delivery Type *</label>
                <select
                  value={form.deliveryType}
                  onChange={(e) => set('deliveryType', e.target.value as DeliveryType | '')}
                  className="input"
                >
                  <option value="">Select…</option>
                  <option value="LINK">Download Link (URL)</option>
                  <option value="FILE">File Upload</option>
                </select>
              </div>

              {form.deliveryType === 'LINK' && (
                <div>
                  <label className="label">Download Link *</label>
                  <input
                    type="url"
                    value={form.deliveryContent}
                    onChange={(e) => set('deliveryContent', e.target.value)}
                    placeholder="https://drive.google.com/..."
                    className="input"
                  />
                </div>
              )}

              {form.deliveryType === 'FILE' && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
                  For file-based delivery, upload the file when creating the product using the API or via multipart form upload. The dashboard currently supports link-based delivery.
                </div>
              )}

              <div>
                <label className="label">Delivery Message (optional)</label>
                <textarea
                  value={form.deliveryMessage}
                  onChange={(e) => set('deliveryMessage', e.target.value)}
                  placeholder="Message sent to customer with the download link…"
                  rows={2}
                  className="input resize-none"
                />
              </div>
            </>
          )}

          {/* Availability */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-gray-700">Available for purchase</p>
              <p className="text-xs text-gray-400">Customers can see and order this product</p>
            </div>
            <button
              type="button"
              onClick={() => set('isAvailable', !form.isAvailable)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.isAvailable ? 'bg-brand' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.isAvailable ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Submit */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 -mx-5 px-5 py-4 mt-4">
            <button type="submit" disabled={isLoading} className="btn-primary w-full">
              {isLoading ? 'Saving…' : isEditing ? 'Save Changes' : 'Add Product'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
