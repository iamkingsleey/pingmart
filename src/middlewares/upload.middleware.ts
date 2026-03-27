/**
 * Multer file upload middleware for digital product file uploads.
 * Files are temporarily stored on disk, uploaded to Cloudinary, then deleted.
 */
import multer from 'multer';
import path from 'path';
import os from 'os';
import { MAX_DIGITAL_FILE_SIZE_BYTES } from '../config/constants';

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `orb-upload-${Date.now()}${ext}`);
  },
});

export const uploadDigitalFile = multer({
  storage,
  limits: { fileSize: MAX_DIGITAL_FILE_SIZE_BYTES },
}).single('file');

export const uploadCoverImage = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB for images
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed for cover images'));
    } else {
      cb(null, true);
    }
  },
}).single('cover');
