import { Router } from 'express';
import { requireApiKey, requireVendorOwnership } from '../middlewares/auth.middleware';
import {
  validate, createVendorSchema, updateVendorSchema,
  createProductSchema, updateProductSchema, orderFilterSchema,
  updateWorkingHoursSchema,
} from '../middlewares/validation.middleware';
import { uploadDigitalFile, uploadCoverImage } from '../middlewares/upload.middleware';
import {
  registerVendor, getVendor, updateVendor,
  addProduct, updateProduct, deleteProduct, getProducts,
  uploadProductCover, getVendorOrders, getOrderDetail,
  getWorkingHours, updateWorkingHours,
} from '../controllers/vendor.controller';

const router = Router();

// Public
router.post('/', validate(createVendorSchema), registerVendor);

// Protected — vendor profile
router.get('/:id', requireApiKey, requireVendorOwnership, getVendor);
router.patch('/:id', requireApiKey, requireVendorOwnership, validate(updateVendorSchema), updateVendor);

// Protected — product management
router.get('/:vendorId/products', requireApiKey, requireVendorOwnership, getProducts);
router.post(
  '/:vendorId/products',
  requireApiKey, requireVendorOwnership,
  uploadDigitalFile,           // Handle optional file upload
  validate(createProductSchema),
  addProduct,
);
router.patch(
  '/:vendorId/products/:productId',
  requireApiKey, requireVendorOwnership,
  validate(updateProductSchema),
  updateProduct,
);
router.delete('/:vendorId/products/:productId', requireApiKey, requireVendorOwnership, deleteProduct);

// Cover image upload (separate endpoint — POST /api/vendors/:vendorId/products/cover)
router.post(
  '/:vendorId/products/cover',
  requireApiKey, requireVendorOwnership,
  uploadCoverImage,
  uploadProductCover,
);

// Working hours
router.get('/:vendorId/hours', requireApiKey, requireVendorOwnership, getWorkingHours);
router.patch('/:vendorId/hours', requireApiKey, requireVendorOwnership, validate(updateWorkingHoursSchema), updateWorkingHours);

// Orders
router.get('/:vendorId/orders', requireApiKey, requireVendorOwnership, validate(orderFilterSchema, 'query'), getVendorOrders);
router.get('/:vendorId/orders/:orderId', requireApiKey, requireVendorOwnership, getOrderDetail);

export { router as vendorRouter };
