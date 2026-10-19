const { z } = require('zod');
const roles = require('../constants/roles');
const { objectId, validate } = require('./common.validation');

const userListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    role: z.enum(Object.values(roles)).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    sort: z.enum(['newest', 'oldest']).default('newest'),
  }),
});

const idParamSchema = z.object({ params: z.object({ id: objectId }) });

const updateStatusSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      status: z.enum(['ACTIVE', 'SUSPENDED']),
      reason: z.string().trim().max(1000).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.status === 'SUSPENDED' && !value.reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'Suspension reason is required',
        });
      }
    }),
});

const sellerListSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    verificationStatus: z.enum(['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED']).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    search: z.string().trim().max(100).optional(),
  }),
});

module.exports = { idParamSchema, sellerListSchema, updateStatusSchema, userListSchema, validate };
