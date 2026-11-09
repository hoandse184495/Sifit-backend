const { z } = require('zod');
const { objectId, pagination, validate } = require('./common.validation');
const params = z.object({ id: objectId });
const idSchema = z.object({ params });
const followSchema = z.object({
  params,
  body: z.object({ notifyNewProducts: z.boolean().optional() }).strict(),
});
const preferenceSchema = z.object({
  params,
  body: z.object({ notifyNewProducts: z.boolean() }).strict(),
});
const listSchema = z.object({ query: z.object(pagination) });
module.exports = { idSchema, followSchema, preferenceSchema, listSchema, validate };
