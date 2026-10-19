const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ quiet: true });

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default(process.env.JEST_WORKER_ID ? 'test' : 'development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(5000),
    MONGODB_URI: z
      .string()
      .min(1, 'MONGODB_URI is required')
      .default('mongodb://127.0.0.1:27017/sifit'),
    FRONTEND_URL: z.url().default('http://localhost:5173'),
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
    REFRESH_COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    RESERVATION_EXPIRES_IN_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
    PAYMENT_PROVIDER: z.enum(['simulator']).default('simulator'),
    PAYMENT_MODE: z.enum(['sandbox', 'production']).default('sandbox'),
    PAYMENT_WEBHOOK_SECRET: z.string().optional(),
    PAYMENT_RETURN_URL: z.url().default('http://localhost:5173/payment/result'),
    PAYMENT_CANCEL_URL: z.url().default('http://localhost:5173/payment/cancel'),
    PAYOUT_MODE: z.enum(['simulation', 'production']).default('simulation'),
    PAYOUT_HOLD_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    SHIPPING_PROVIDER: z.enum(['simulator']).default('simulator'),
    SHIPPING_MODE: z.enum(['sandbox', 'production']).default('sandbox'),
    SHIPPING_WEBHOOK_SECRET: z.string().optional(),
    BUYER_PROTECTION_DAYS: z.coerce.number().int().min(0).max(30).default(3),
    SELLER_VERIFICATION_MODE: z.enum(['simulation', 'production']).default('simulation'),
    REVIEW_EDIT_WINDOW_DAYS: z.coerce.number().int().min(0).max(365).default(7),
    SOCKET_IO_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    SOCKET_CORS_ORIGIN: z.url().default('http://localhost:5173'),
    CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().min(1).max(2000).default(2000),
    CHAT_MAX_MESSAGES_PER_MINUTE: z.coerce.number().int().min(1).max(300).default(30),
    NOTIFICATION_OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(100),
    NOTIFICATION_OUTBOX_RETRY_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
    COMMISSION_RATE: z.coerce.number().min(0).max(100).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test') {
      return;
    }

    if (!env.JWT_ACCESS_SECRET || env.JWT_ACCESS_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_ACCESS_SECRET'],
        message: 'JWT_ACCESS_SECRET must be at least 32 characters',
      });
    }

    if (!env.JWT_REFRESH_SECRET || env.JWT_REFRESH_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must be at least 32 characters',
      });
    }

    if (env.NODE_ENV === 'production' && env.PAYMENT_PROVIDER === 'simulator') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_PROVIDER'],
        message: 'Simulator payment provider is not allowed in production',
      });
    }

    if (env.NODE_ENV === 'production' && env.PAYOUT_MODE === 'simulation') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYOUT_MODE'],
        message: 'Simulation payout mode is not allowed in production',
      });
    }

    if (env.NODE_ENV === 'production' && env.SHIPPING_PROVIDER === 'simulator') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHIPPING_PROVIDER'],
        message: 'Simulator shipping provider is not allowed in production',
      });
    }

    if (env.NODE_ENV === 'production' && env.SELLER_VERIFICATION_MODE === 'simulation') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SELLER_VERIFICATION_MODE'],
        message: 'Simulation seller verification is not allowed in production',
      });
    }

    if (!env.PAYMENT_WEBHOOK_SECRET || env.PAYMENT_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PAYMENT_WEBHOOK_SECRET'],
        message: 'PAYMENT_WEBHOOK_SECRET must be at least 32 characters',
      });
    }

    if (!env.SHIPPING_WEBHOOK_SECRET || env.SHIPPING_WEBHOOK_SECRET.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SHIPPING_WEBHOOK_SECRET'],
        message: 'SHIPPING_WEBHOOK_SECRET must be at least 32 characters',
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const formattedErrors = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${formattedErrors}`);
}

if (parsedEnv.data.NODE_ENV === 'test') {
  parsedEnv.data.JWT_ACCESS_SECRET =
    parsedEnv.data.JWT_ACCESS_SECRET || 'test-access-secret-minimum-32-characters';
  parsedEnv.data.JWT_REFRESH_SECRET =
    parsedEnv.data.JWT_REFRESH_SECRET || 'test-refresh-secret-minimum-32-characters';
  parsedEnv.data.PAYMENT_WEBHOOK_SECRET =
    parsedEnv.data.PAYMENT_WEBHOOK_SECRET || 'test-payment-webhook-secret-minimum-32';
  parsedEnv.data.SHIPPING_WEBHOOK_SECRET =
    parsedEnv.data.SHIPPING_WEBHOOK_SECRET || 'test-shipping-webhook-secret-minimum-32';
}

module.exports = parsedEnv.data;
