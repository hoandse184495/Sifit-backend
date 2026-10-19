const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const openDisputeSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    reason: z.enum([
      'ITEM_NOT_RECEIVED',
      'ITEM_NOT_AS_DESCRIBED',
      'DAMAGED_ITEM',
      'WRONG_ITEM',
      'OTHER',
    ]),
    description: z.string().trim().min(1).max(2000),
    evidence: z.array(z.string().trim().max(500)).max(10).optional(),
  }),
});
const idParamSchema = z.object({ params: z.object({ id: objectId }) });
const listSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.string().trim().max(50).optional(),
  }),
});
const reviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ note: z.string().trim().max(1000).optional() }),
});
const resolveSchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED']),
    resolution: z.string().trim().min(1).max(2000),
  }),
});

const validate = (schema) => (req, res, next) => {
  const parsed = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'Invalid request data',
      errors: parsed.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  req.body = parsed.data.body || req.body;
  req.params = parsed.data.params || req.params;
  req.query = parsed.data.query || req.query;
  return next();
};

module.exports = {
  idParamSchema,
  listSchema,
  openDisputeSchema,
  resolveSchema,
  reviewSchema,
  validate,
};
