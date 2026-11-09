const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const fields = {
  legalName: z.string().trim().min(3).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9]{9,15}$/),
  contactAddress: z.string().trim().min(10).max(300),
};
const idSchema = z.object({ params: z.object({ id: objectId }) });
const draftSchema = z.object({ body: z.object(fields).strict() });
const updateSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ ...fields, expectedVersion: z.number().int().nonnegative() }).strict(),
});
const submitSchema = z.object({
  body: z
    .object({
      verificationId: objectId,
      expectedVersion: z.number().int().nonnegative(),
      ownsAccount: z.literal(true),
      consent: z.literal(true),
    })
    .strict(),
});
const reviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      expectedVersion: z.number().int().nonnegative(),
      reason: z.string().trim().min(10).max(1000),
      checkedDocuments: z.literal(true).optional(),
    })
    .strict(),
});
const listSchema = z.object({
  query: z.object({
    ...pagination,
    status: z.enum(['PENDING', 'VERIFIED', 'REJECTED']).optional(),
  }),
});
const documentSchema = z.object({
  params: z.object({ id: objectId, kind: z.enum(['OWNER_IDENTITY', 'BANK_OWNERSHIP']) }),
});
module.exports = {
  validate,
  idSchema,
  draftSchema,
  updateSchema,
  submitSchema,
  reviewSchema,
  listSchema,
  documentSchema,
};
