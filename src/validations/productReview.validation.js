const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const rating = z.coerce.number().int().min(1).max(5);
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

const createProductReviewSchema = z.object({
  body: z.object({
    orderId: objectId,
    productId: objectId,
    rating,
    title: z.string().trim().max(150).optional(),
    comment: z.string().trim().max(2000).optional(),
  }),
});
const updateProductReviewSchema = z.object({
  params: z.object({ id: objectId }),
  body: z
    .object({
      rating: rating.optional(),
      title: z.string().trim().max(150).optional(),
      comment: z.string().trim().max(2000).optional(),
    })
    .refine((value) => Object.keys(value).length > 0),
});
const replySchema = z.object({
  params: z.object({ id: objectId }),
  body: z.object({ text: z.string().trim().min(1).max(1000) }),
});
const idParamSchema = z.object({ params: z.object({ id: objectId }) });
const productIdParamSchema = z.object({ params: z.object({ productId: objectId }) });
const productReviewsListSchema = z.object({
  params: z.object({ productId: objectId }),
  query: z.object({ ...pagination, rating: rating.optional() }),
});
const myReviewsSchema = z.object({ query: z.object(pagination) });

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
  createProductReviewSchema,
  idParamSchema,
  myReviewsSchema,
  productIdParamSchema,
  productReviewsListSchema,
  replySchema,
  updateProductReviewSchema,
  validate,
};
