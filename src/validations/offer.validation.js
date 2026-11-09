const { z } = require('zod');
const { objectId, uuid, pagination, validate } = require('./common.validation');
const params = z.object({ id: objectId });
const createSchema = z.object({
  params,
  body: z
    .object({
      amount: z.number().int().positive().safe(),
      message: z.string().trim().max(500).optional(),
      idempotencyKey: uuid,
    })
    .strict(),
});
const respondSchema = z.object({
  params,
  body: z
    .object({
      decision: z.enum(['ACCEPT', 'REJECT']),
      note: z.string().trim().max(500).optional(),
    })
    .strict(),
});
const idSchema = z.object({ params });
const listSchema = z.object({
  query: z.object({
    ...pagination,
    productId: objectId.optional(),
    status: z
      .enum(['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'CHECKED_OUT'])
      .optional(),
  }),
});
module.exports = { createSchema, respondSchema, idSchema, listSchema, validate };
