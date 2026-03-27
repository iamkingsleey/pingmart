// Set test env vars BEFORE any module that imports config/env.ts
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test_db';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['WHATSAPP_PHONE_NUMBER_ID'] = 'test-phone-id';
process.env['WHATSAPP_ACCESS_TOKEN'] = 'test-access-token';
process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'] = 'test-verify-token';
process.env['WHATSAPP_APP_SECRET'] = 'test-app-secret-at-least-32-chars!!';
process.env['PAYSTACK_SECRET_KEY'] = 'sk_test_testkey1234567890abcdefghij';
process.env['PAYSTACK_WEBHOOK_SECRET'] = 'test-paystack-secret';
process.env['CLOUDINARY_CLOUD_NAME'] = 'test-cloud';
process.env['CLOUDINARY_API_KEY'] = 'test-api-key';
process.env['CLOUDINARY_API_SECRET'] = 'test-api-secret';
