/**
 * Catalog service — unified product management for physical, digital, and hybrid vendors.
 *
 * Design: A single Product model handles both types. The service enforces that:
 * - Digital products MUST have deliveryType + deliveryContent
 * - Physical products MUST NOT have deliveryContent (would be a data leak risk)
 */
import { Product } from '@prisma/client';
import { productRepository } from '../../repositories/product.repository';
import { vendorRepository } from '../../repositories/vendor.repository';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { CreateProductDto, UpdateProductDto, ProductType, DeliveryType } from '../../types';

export const catalogService = {
  /** Adds a product to a vendor's catalog. Validates digital-specific fields. */
  async addProduct(vendorId: string, data: CreateProductDto): Promise<Product> {
    const vendor = await vendorRepository.findById(vendorId);
    if (!vendor) throw new NotFoundError('Vendor');

    if (data.productType === ProductType.DIGITAL) {
      // Digital products MUST have a deliveryType and deliveryContent
      if (!data.deliveryType) {
        throw new ValidationError('Digital products require a deliveryType (LINK or FILE)');
      }
      if (!data.deliveryContent || !data.deliveryContent.trim()) {
        throw new ValidationError('Digital products require deliveryContent (URL or Cloudinary URL)');
      }
      // Validate that LINK type contains a URL
      if (data.deliveryType === DeliveryType.LINK && !isValidUrl(data.deliveryContent)) {
        throw new ValidationError('deliveryContent for type LINK must be a valid URL');
      }
    }

    if (data.productType === ProductType.PHYSICAL) {
      // Strip digital-only fields if accidentally passed for physical products
      data.deliveryType = undefined;
      data.deliveryContent = undefined;
      data.deliveryMessage = undefined;
    }

    return productRepository.create(vendorId, data);
  },

  async getAllProducts(vendorId: string): Promise<Product[]> {
    return productRepository.findAllByVendor(vendorId);
  },

  async getAvailableProducts(vendorId: string): Promise<Product[]> {
    return productRepository.findAvailableByVendor(vendorId);
  },

  async updateProduct(vendorId: string, productId: string, data: UpdateProductDto): Promise<Product> {
    const product = await productRepository.findByIdAndVendor(productId, vendorId);
    if (!product) throw new NotFoundError('Product');

    // If adding deliveryContent to a digital product, validate it's a URL for LINK type
    const deliveryType = data.deliveryType ?? product.deliveryType;
    if (
      data.deliveryContent &&
      deliveryType === DeliveryType.LINK &&
      !isValidUrl(data.deliveryContent)
    ) {
      throw new ValidationError('deliveryContent for type LINK must be a valid URL');
    }

    return productRepository.update(productId, data);
  },

  async deleteProduct(vendorId: string, productId: string): Promise<void> {
    const product = await productRepository.findByIdAndVendor(productId, vendorId);
    if (!product) throw new NotFoundError('Product');
    await productRepository.delete(productId);
  },
};

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}
