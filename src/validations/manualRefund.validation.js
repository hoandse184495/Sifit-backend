const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const params = z.object({ id: objectId });
const money = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const createSchema = z.object({
  body: z
    .object({
      paymentId: objectId.transform((value) => value.toLowerCase()),
      orderId: objectId.transform((value) => value.toLowerCase()),
      disputeId: objectId.transform((value) => value.toLowerCase()).optional(),
      amount: money,
      idempotencyKey: z.uuid(),
      reason: z.string().trim().min(10).max(500),
    })
    .strict(),
});
const listSchema = z.object({
  query: z.object({
    ...pagination,
    orderId: objectId.optional(),
    paymentId: objectId.optional(),
    status: z.enum(['REQUESTED', 'PENDING', 'APPROVED', 'SUCCEEDED', 'CANCELLED']).optional(),
  }),
});
const idSchema = z.object({ params });
const approveSchema = z.object({
  params,
  body: z.object({ expectedVersion: z.number().int().nonnegative() }).strict(),
});
const bankSchema = z.object({
  params,
  body: z
    .object({
      bankName: z.string().trim().min(2).max(100),
      bankBin: z.string().regex(/^\d{6}$/),
      accountNumber: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9]{4,34}$/),
      accountName: z
        .string()
        .trim()
        .min(3)
        .max(100)
        .transform((value) => value.toUpperCase()),
      ownsAccount: z.literal(true),
    })
    .strict(),
});
const cancelSchema = z.object({
  params,
  body: z.object({ note: z.string().trim().min(10).max(500) }).strict(),
});
const transferSchema = z.object({
  params,
  body: z
    .object({
      amount: money,
      reference: z
        .string()
        .trim()
        .min(5)
        .max(100)
        .regex(/^[A-Za-z0-9._/-]+$/)
        .transform((value) => value.toUpperCase()),
      note: z.string().trim().min(10).max(1000),
      transferredAt: z.iso.datetime({ offset: true }),
      transferred: z.literal(true),
    })
    .strict(),
});
const correctionSchema = z.object({
  params,
  body: z
    .object({
      note: z.string().trim().min(10).max(500),
      notTransferred: z.literal(true),
    })
    .strict(),
});
module.exports = {
  correctionSchema,
  createSchema,
  approveSchema,
  listSchema,
  idSchema,
  bankSchema,
  cancelSchema,
  transferSchema,
  validate,
};
