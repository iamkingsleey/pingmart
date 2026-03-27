/**
 * @file components/catalog/ProductCard.tsx
 * @description Single product card with availability toggle, edit and delete actions.
 */
import { Pencil, Trash2, Eye, EyeOff, Package, Zap } from 'lucide-react';
import type { Product } from '../../types';
import { formatNaira } from '../../utils/currency';

interface Props {
  product: Product;
  onEdit: (product: Product) => void;
  onDelete: (product: Product) => void;
  onToggleAvailable: (product: Product) => void;
  isUpdating?: boolean;
}

export default function ProductCard({ product, onEdit, onDelete, onToggleAvailable, isUpdating }: Props) {
  const isDigital = product.productType === 'DIGITAL';

  return (
    <div className={`card flex flex-col gap-3 ${!product.isAvailable ? 'opacity-60' : ''}`}>
      {/* Cover image */}
      {product.imageUrl ? (
        <img
          src={product.imageUrl}
          alt={product.name}
          className="w-full h-36 object-cover rounded-lg bg-gray-100"
        />
      ) : (
        <div className="w-full h-36 rounded-lg bg-gray-100 flex items-center justify-center">
          {isDigital ? (
            <Zap size={28} className="text-purple-300" />
          ) : (
            <Package size={28} className="text-gray-300" />
          )}
        </div>
      )}

      {/* Info */}
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 text-sm leading-snug">{product.name}</h3>
          <span
            className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
              isDigital ? 'bg-purple-100 text-purple-700' : 'bg-orange-100 text-orange-700'
            }`}
          >
            {isDigital ? 'Digital' : 'Physical'}
          </span>
        </div>

        {product.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{product.description}</p>
        )}

        <div className="flex items-center justify-between mt-2">
          <p className="font-bold text-brand text-sm">{formatNaira(product.price)}</p>
          {product.category && (
            <span className="text-xs text-gray-400">{product.category}</span>
          )}
        </div>

        {!isDigital && product.stockCount !== undefined && product.stockCount !== null && (
          <p className="text-xs text-gray-400 mt-0.5">Stock: {product.stockCount}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-gray-100 pt-3">
        <button
          onClick={() => onToggleAvailable(product)}
          disabled={isUpdating}
          title={product.isAvailable ? 'Hide from customers' : 'Show to customers'}
          className="btn-secondary text-xs flex items-center gap-1.5 flex-1 justify-center"
        >
          {product.isAvailable ? <EyeOff size={13} /> : <Eye size={13} />}
          {product.isAvailable ? 'Hide' : 'Show'}
        </button>
        <button
          onClick={() => onEdit(product)}
          className="btn-secondary text-xs flex items-center gap-1.5 px-3"
          title="Edit product"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => onDelete(product)}
          className="text-red-500 hover:text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-3 py-2 text-xs transition-colors"
          title="Delete product"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
