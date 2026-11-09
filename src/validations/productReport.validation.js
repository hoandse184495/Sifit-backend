const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const { reasons } = require('../models/productReport.model');
const createSchema = z.object({
  params: z.object({ productId: objectId }),
  body: z
    .object({ reason: z.enum(reasons), description: z.string().trim().min(10).max(1000) })
    .strict(),
});
const listSchema = z.object({
  query: z.object({
    ...pagination,
    status: z.enum(['OPEN', 'RESOLVED']).optional(),
    reason: z.enum(reasons).optional(),
    productId: objectId.optional(),
  }),
});
const mineSchema = z.object({ query: z.object({ ...pagination, productId: objectId.optional() }) });
const resolveSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({ decision: z.enum(['KEEP', 'HIDE']), note: z.string().trim().min(10).max(1000) })
    .strict(),
});
const reporterSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      action: z.enum(['WARN', 'BLOCK', 'UNBLOCK']),
      note: z.string().trim().min(10).max(1000),
      days: z.number().int().min(1).max(30).optional(),
    })
    .strict()
    .refine((value) => value.action !== 'BLOCK' || value.days !== undefined, {
      message: 'Block duration is required',
    }),
});
module.exports = { createSchema, listSchema, mineSchema, resolveSchema, reporterSchema, validate };
