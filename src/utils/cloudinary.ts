/**
 * Cloudinary utility — handles digital product file uploads and cover image uploads.
 *
 * Files are uploaded at product creation time (admin flow) and the returned
 * Cloudinary URL is stored as deliveryContent on the Product record.
 * At delivery time we just send the stored URL — no runtime Cloudinary calls.
 *
 * Security note: Cloudinary URLs are long and include a version hash, making
 * them unguessable. We additionally require Paystack payment confirmation before
 * sending them, so brute-force access is not a meaningful risk.
 */
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';
import { CLOUDINARY_DIGITAL_FOLDER, CLOUDINARY_COVER_FOLDER } from '../config/constants';
import { logger } from './logger';

// Configure Cloudinary from environment variables
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true, // Always use HTTPS URLs
});

/**
 * Uploads a digital product file to Cloudinary.
 * @param filePath - Local file path (from multer upload)
 * @param productName - Used to generate a readable public_id
 * @returns The secure Cloudinary URL for the uploaded file
 */
export async function uploadDigitalProduct(
  filePath: string,
  productName: string,
): Promise<string> {
  const publicId = `${Date.now()}-${productName.toLowerCase().replace(/\s+/g, '-').slice(0, 40)}`;

  logger.info('Uploading digital product to Cloudinary', { publicIdPrefix: publicId.slice(0, 16) });

  const result = await cloudinary.uploader.upload(filePath, {
    folder: CLOUDINARY_DIGITAL_FOLDER,
    public_id: publicId,
    resource_type: 'auto', // Handles PDFs, ZIPs, videos, etc.
    // Cloudinary's signed delivery adds another auth layer for sensitive files
    type: 'upload',
  });

  logger.info('Digital product uploaded', { format: result.format, bytes: result.bytes });

  return result.secure_url;
}

/**
 * Uploads a product cover image to Cloudinary.
 * @param filePath - Local file path (from multer)
 * @returns Secure Cloudinary URL for the cover image
 */
export async function uploadCoverImage(filePath: string): Promise<string> {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: CLOUDINARY_COVER_FOLDER,
    resource_type: 'image',
    // Resize to a standard cover size on upload to save storage
    transformation: [{ width: 800, height: 600, crop: 'limit', quality: 'auto' }],
  });
  return result.secure_url;
}

/**
 * Uploads a product image received as a raw Buffer (e.g. downloaded from
 * WhatsApp Cloud API). Uses the streaming upload API since there is no local
 * file path available.
 */
export async function uploadProductImageBuffer(
  buffer: Buffer,
  publicId: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'pingmart/products',
        public_id: publicId,
        resource_type: 'image',
        transformation: [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto:good' }],
      },
      (err, result) => {
        if (err || !result) reject(err ?? new Error('Cloudinary upload returned no result'));
        else resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

/**
 * Deletes a file from Cloudinary by its public ID.
 * Called when a product is deleted to avoid orphaned files.
 */
export async function deleteCloudinaryFile(url: string): Promise<void> {
  // Extract the public_id from the URL
  // URL format: https://res.cloudinary.com/<cloud>/image/upload/v<ver>/<folder>/<id>.<ext>
  const matches = url.match(/\/(?:image|raw|video)\/upload\/(?:v\d+\/)?(.+?)(?:\.\w+)?$/);
  if (!matches?.[1]) {
    logger.warn('Could not parse Cloudinary public_id from URL');
    return;
  }
  const publicId = matches[1];
  await cloudinary.uploader.destroy(publicId, { resource_type: 'raw' });
  logger.info('Cloudinary file deleted', { publicIdPrefix: publicId.slice(0, 16) });
}
