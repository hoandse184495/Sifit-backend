const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const rating = z.coerce.number().int().min(1).max(5);
const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

const createSellerRatingSchema = z.object({
  body: z.object({
    orderId: objectId,
    rating,
    communicationRating: rating.optional(),
    shippingRating: rating.optional(),
    descriptionAccuracyRating: rating.optional(),
    comment: z.string().trim().max(2000).optional(),
  }),
});
const shopSlugRatingsSchema = z.object({
  params: z.object({ slug: z.string().trim().min(1) }),
  query: z.object(pagination),
});
const listSchema = z.object({ query: z.object(pagination) });

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

module.exports = { createSellerRatingSchema, listSchema, shopSlugRatingsSchema, validate };
