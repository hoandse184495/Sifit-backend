const { z } = require('zod');
const { objectId, validate } = require('./common.validation');
const bankSchema = z.object({
  body: z
    .object({
      bankName: z.string().trim().min(2).max(100),
      bankBin: z.string().regex(/^\d{6}$/),
      accountNumber: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{4,30}$/),
      accountName: z.string().trim().min(3).max(100),
    })
    .strict(),
});
const completeSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      note: z.string().trim().min(10).max(1000),
      allowUnconfirmed: z.boolean().default(false),
    })
    .strict(),
});
const recordPayoutSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      reference: z
        .string()
        .trim()
        .min(5)
        .max(100)
        .regex(/^[A-Za-z0-9._/-]+$/),
      note: z.string().trim().min(10).max(1000),
      amount: z.number().int().positive(),
      transferred: z.literal(true),
    })
    .strict(),
});
const manualShipmentSchema = z.object({
  params: z.object({ orderId: objectId }),
  body: z
    .object({
      pickupAddressId: objectId,
      carrierName: z.string().trim().min(2).max(100),
      trackingNumber: z
        .string()
        .trim()
        .min(3)
        .max(100)
        .regex(/^[A-Za-z0-9._/-]+$/),
      shippingFee: z.number().int().min(0).max(10000000),
      weightGrams: z.number().int().min(1).max(30000),
      packageLengthCm: z.number().int().min(1).max(200),
      packageWidthCm: z.number().int().min(1).max(200),
      packageHeightCm: z.number().int().min(1).max(200),
      idempotencyKey: z.uuid(),
    })
    .strict(),
});
const handoverSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ note: z.string().trim().min(10).max(1000) }).strict(),
});
module.exports = {
  bankSchema,
  completeSchema,
  recordPayoutSchema,
  manualShipmentSchema,
  handoverSchema,
  validate,
};
