const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const params = z.object({ id: objectId });
const version = z.number().int().nonnegative();
const note = z.string().trim().min(10).max(1000);
const listSchema = z.object({ params, query: z.object(pagination) });
const idSchema = z.object({ params });
const fileSchema = z.object({ params: z.object({ id: objectId, fileId: objectId }) });
const messageSchema = z.object({
  params,
  body: z.object({ body: z.string().trim().min(1).max(2000), idempotencyKey: z.uuid() }).strict(),
});
const evidenceSchema = z.object({
  params,
  body: z
    .object({
      caption: z.string().trim().min(3).max(500),
      category: z.enum(['GENERAL', 'RETURN_SHIPPING', 'RETURN_RECEIPT']).default('GENERAL'),
    })
    .strict(),
});
const shipmentSchema = z.object({
  params,
  body: z
    .object({
      expectedVersion: version,
      carrierName: z.string().trim().min(2).max(100),
      trackingNumber: z
        .string()
        .trim()
        .min(3)
        .max(100)
        .regex(/^[A-Za-z0-9._/-]+$/),
      trackingUrl: z
        .url()
        .max(500)
        .refine((value) => value.startsWith('https://'))
        .optional(),
      shippedAt: z.iso.datetime({ offset: true }),
      note,
    })
    .strict(),
});
const receiptSchema = z.object({
  params,
  body: z.object({ expectedVersion: version, note }).strict(),
});
const verifySchema = z.object({
  params,
  body: z
    .object({
      expectedVersion: version,
      note,
      overrideSellerConfirmation: z.boolean().default(false),
    })
    .strict(),
});
module.exports = {
  validate,
  idSchema,
  listSchema,
  fileSchema,
  messageSchema,
  evidenceSchema,
  shipmentSchema,
  receiptSchema,
  verifySchema,
};
