/**
 * Vendor controller — thin HTTP layer. Business logic lives in services.
 */
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { vendorService } from '../services/vendor/vendor.service';
import { catalogService } from '../services/catalog/catalog.service';
import { orderRepository } from '../repositories/order.repository';
import { uploadDigitalProduct, uploadCoverImage } from '../utils/cloudinary';
import { CreateVendorDto, UpdateVendorDto, CreateProductDto, UpdateProductDto, ApiSuccessResponse, DeliveryType } from '../types';
import { vendorRepository } from '../repositories/vendor.repository';

// ─── Vendor ───────────────────────────────────────────────────────────────────

export async function registerVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { vendor, rawApiKey } = await vendorService.register(req.body as CreateVendorDto);
    const { apiKeyHash: _, ...safeVendor } = vendor;
    res.status(201).json({
      success: true,
      data: {
        vendor: safeVendor,
        apiKey: rawApiKey,
        message: 'Vendor registered. Save your API key — it will not be shown again.',
      },
    } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function getVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendor = await vendorService.getById(req.params['id']!);
    const { apiKeyHash: _, ...safe } = vendor;
    res.json({ success: true, data: safe } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function updateVendor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendor = await vendorService.update(req.params['id']!, req.body as UpdateVendorDto);
    const { apiKeyHash: _, ...safe } = vendor;
    res.json({ success: true, data: safe } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

// ─── Product Management ───────────────────────────────────────────────────────

export async function addProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const dto = req.body as CreateProductDto;

    // Handle file upload if a digital product file was attached
    const uploadedFile = req.file;
    if (uploadedFile && dto.productType === 'DIGITAL') {
      try {
        dto.deliveryContent = await uploadDigitalProduct(uploadedFile.path, dto.name);
        dto.deliveryType = DeliveryType.FILE;
      } finally {
        // Always clean up the temp file
        fs.unlink(uploadedFile.path, () => undefined);
      }
    }

    const product = await catalogService.addProduct(req.params['vendorId']!, dto);
    res.status(201).json({ success: true, data: product } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function updateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const product = await catalogService.updateProduct(
      req.params['vendorId']!,
      req.params['productId']!,
      req.body as UpdateProductDto,
    );
    res.json({ success: true, data: product } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function deleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await catalogService.deleteProduct(req.params['vendorId']!, req.params['productId']!);
    res.json({ success: true, data: { message: 'Product deleted' } } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function getProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const items = await catalogService.getAllProducts(req.params['vendorId']!);
    res.json({ success: true, data: items } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

// ─── Cover Image Upload ───────────────────────────────────────────────────────

export async function uploadProductCover(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) { res.status(400).json({ success: false, error: { code: 'NO_FILE', message: 'No cover image uploaded' } }); return; }
    const url = await uploadCoverImage(req.file.path);
    fs.unlink(req.file.path, () => undefined);
    res.json({ success: true, data: { imageUrl: url } } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

// ─── Working Hours ────────────────────────────────────────────────────────────

export async function getWorkingHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const vendor = await vendorRepository.findById(req.params['vendorId']!);
    if (!vendor) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Vendor not found' } }); return; }
    res.json({
      success: true,
      data: {
        workingHoursStart:    vendor.workingHoursStart,
        workingHoursEnd:      vendor.workingHoursEnd,
        workingDays:          vendor.workingDays,
        timezone:             vendor.timezone,
        acceptOffHoursOrders: vendor.acceptOffHoursOrders,
      },
    } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function updateWorkingHours(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const updated = await vendorRepository.update(req.params['vendorId']!, req.body);
    res.json({
      success: true,
      data: {
        workingHoursStart:    updated.workingHoursStart,
        workingHoursEnd:      updated.workingHoursEnd,
        workingDays:          updated.workingDays,
        timezone:             updated.timezone,
        acceptOffHoursOrders: updated.acceptOffHoursOrders,
      },
    } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

export async function getVendorOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = req.query as Record<string, string | undefined>;
    const { orders, total } = await orderRepository.findByVendor(req.params['vendorId']!, {
      status: q['status'] as import('../types').OrderStatus | undefined,
      orderType: q['orderType'] as import('../types').OrderType | undefined,
      dateFrom: q['dateFrom'],
      dateTo: q['dateTo'],
      page: q['page'] ? parseInt(q['page'], 10) : 1,
      limit: q['limit'] ? parseInt(q['limit'], 10) : 20,
    });
    res.json({ success: true, data: { orders, total } } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}

export async function getOrderDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const order = await orderRepository.findByIdWithDetails(req.params['orderId']!);
    if (!order || order.vendorId !== req.params['vendorId']) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Order not found' } });
      return;
    }
    res.json({ success: true, data: order } satisfies ApiSuccessResponse);
  } catch (err) { next(err); }
}
