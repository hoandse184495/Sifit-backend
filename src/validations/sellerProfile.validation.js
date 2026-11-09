const applyValidatedQuery = require('../utils/applyValidatedQuery');
const { z } = require('zod');
const { productConditions, productSizes } = require('../models/product.model');
const { objectId } = require('./common.validation');

const phone = z
  .string()
  .regex(/^(0|\+84)(3|5|7|8|9)\d{8}$/, 'Invalid Vietnamese phone number')
  .optional();

const profileBody = z.object({
  shopName: z.string().trim().min(3).max(100),
  description: z.string().trim().max(2000).optional(),
  avatar: z.url().optional(),
  coverImage: z.url().optional(),
  contactPhone: phone,
});

const createProfileSchema = z.object({ body: profileBody });
const updateProfileSchema = z.object({
  body: profileBody.partial().refine((v) => Object.keys(v).length > 0),
});
const slugParamSchema = z.object({ params: z.object({ slug: z.string().trim().min(1).max(120) }) });
const publicShopSchema = z.object({
  params: slugParamSchema.shape.params,
  query: z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      search: z.string().trim().max(100).optional(),
      categoryId: objectId.optional(),
      brand: z.string().trim().max(100).optional(),
      size: z.enum(productSizes).optional(),
      condition: z.enum(productConditions).optional(),
      minPrice: z.coerce.number().int().safe().min(0).optional(),
      maxPrice: z.coerce.number().int().safe().min(0).optional(),
      sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc']).default('newest'),
    })
    .refine(
      (value) =>
        value.minPrice === undefined ||
        value.maxPrice === undefined ||
        value.minPrice <= value.maxPrice,
      { message: 'Minimum price must not exceed maximum price', path: ['maxPrice'] },
    ),
});
const sellerShopSchema = z.object({ params: z.object({ sellerId: objectId }) });
const listShopSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    search: z.string().trim().max(100).optional(),
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
  createProfileSchema,
  listShopSchema,
  slugParamSchema,
  publicShopSchema,
  sellerShopSchema,
  updateProfileSchema,
  validate,
};
