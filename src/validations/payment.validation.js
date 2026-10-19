const applyValidatedQuery = require('../utils/applyValidatedQuery');
const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.string().trim().max(50).optional(),
};

const createPaymentSchema = z.object({
  body: z.object({
    checkoutGroupId: objectId,
    idempotencyKey: z.uuid(),
  }),
});

const idParamSchema = z.object({
  params: z.object({ id: objectId }),
});

const adminListSchema = z.object({
  query: z.object({ ...pagination, checkoutGroupId: objectId.optional() }),
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
  applyValidatedQuery(req, parsed.data.query);
  return next();
};

module.exports = {
  adminListSchema,
  createPaymentSchema,
  idParamSchema,
  validate,
};
