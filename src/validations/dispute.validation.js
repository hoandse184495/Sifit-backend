const applyValidatedQuery = require('../utils/applyValidatedQuery');
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
  body: z
    .object({
      status: z.enum(['RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED']),
      resolution: z.string().trim().min(1).max(2000),
      expectedVersion: z.number().int().nonnegative().optional(),
      returnRequired: z.boolean().default(false),
      returnDetails: z
        .object({
          address: z
            .object({
              recipientName: z.string().trim().min(2).max(100),
              phone: z
                .string()
                .trim()
                .regex(/^[0-9+(). -]{8,20}$/),
              addressLine: z.string().trim().min(5).max(250),
              ward: z.string().trim().min(2).max(100),
              province: z.string().trim().min(2).max(100),
            })
            .strict(),
          instructions: z.string().trim().min(10).max(1000),
          shippingPayer: z.enum(['BUYER', 'SELLER']),
          shipBy: z.iso.datetime({ offset: true }),
        })
        .strict()
        .optional(),
    })
    .refine(
      (data) =>
        data.returnRequired
          ? data.status === 'RESOLVED_BUYER' &&
            Boolean(data.returnDetails) &&
            data.expectedVersion !== undefined
          : !data.returnDetails,
      'Chọn đầy đủ thông tin trả hàng khi chấp nhận bên mua',
    ),
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
  idParamSchema,
  listSchema,
  openDisputeSchema,
  resolveSchema,
  reviewSchema,
  validate,
};
