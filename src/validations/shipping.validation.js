const applyValidatedQuery = require('../utils/applyValidatedQuery');
const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const packageSchema = {
  weightGrams: z.coerce.number().int().min(1).max(30000),
  packageLengthCm: z.coerce.number().int().min(1).max(200),
  packageWidthCm: z.coerce.number().int().min(1).max(200),
  packageHeightCm: z.coerce.number().int().min(1).max(200),
};

const quoteSchema = z.object({
  body: z.object({
    orderId: objectId,
    pickupAddressId: objectId,
    ...packageSchema,
  }),
});
const createShipmentSchema = z.object({
  params: z.object({ orderId: objectId }),
  body: z.object({
    pickupAddressId: objectId,
    idempotencyKey: z.uuid(),
    ...packageSchema,
  }),
});
const idParamSchema = z.object({ params: z.object({ id: objectId }) });
const orderIdParamSchema = z.object({ params: z.object({ orderId: objectId }) });
const listSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.string().trim().max(50).optional(),
  }),
});
const reviewDeliverySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum(['DELIVERED', 'DELIVERY_FAILED']),
    reason: z.string().trim().min(1).max(1000),
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
  applyValidatedQuery(req, parsed.data.query);
  return next();
};

module.exports = {
  createShipmentSchema,
  idParamSchema,
  listSchema,
  orderIdParamSchema,
  quoteSchema,
  reviewDeliverySchema,
  validate,
};
