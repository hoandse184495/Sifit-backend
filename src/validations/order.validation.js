const applyValidatedQuery = require('../utils/applyValidatedQuery');
const { z } = require('zod');
const orderStatus = require('../constants/orderStatus');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  status: z.enum(Object.values(orderStatus)).optional(),
  search: z.string().trim().max(100).optional(),
  buyerId: objectId.optional(),
  sellerId: objectId.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

const shippingAddressSchema = z.object({
  recipientName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(8).max(20),
  addressLine: z.string().trim().min(1).max(255),
  ward: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  city: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

const checkoutSchema = z.object({
  body: z.object({
    shippingAddress: shippingAddressSchema,
    notes: z.string().trim().max(500).optional(),
    idempotencyKey: z.uuid(),
  }),
});

const idParamSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});

const orderListSchema = z.object({
  query: paginationSchema,
});

const validate = (schema) => (req, res, next) => {
  const parsed = schema.safeParse({
    body: req.body,
    params: req.params,
    query: req.query,
  });

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
  checkoutSchema,
  idParamSchema,
  orderListSchema,
  validate,
};
