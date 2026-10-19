const { z } = require('zod');
const { productConditions, productSizes } = require('../models/product.model');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

const productBody = z.object({
  title: z.string().trim().min(5).max(150),
  description: z.string().trim().min(1).max(5000),
  price: z.coerce.number().int().positive(),
  categoryId: objectId,
  brand: z.string().trim().max(100).optional(),
  size: z.enum(productSizes),
  color: z.string().trim().max(100).optional(),
  condition: z.enum(productConditions),
});

const createProductSchema = z.object({
  body: productBody,
});

const updateProductSchema = z.object({
  body: productBody.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  }),
  params: z.object({
    id: objectId,
  }),
});

const listProductsSchema = z.object({
  query: z.object({
    ...paginationQuery,
    search: z.string().trim().max(100).optional(),
    categoryId: objectId.optional(),
    condition: z.enum(productConditions).optional(),
    size: z.enum(productSizes).optional(),
    brand: z.string().trim().max(100).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    sort: z.enum(['newest', 'oldest', 'price_asc', 'price_desc']).default('newest'),
  }),
});

const idParamSchema = z.object({
  params: z.object({
    id: objectId,
  }),
});

const imageParamSchema = z.object({
  params: z.object({
    id: objectId,
    publicId: z.string().min(1),
  }),
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
  req.query = parsed.data.query || req.query;
  return next();
};

module.exports = {
  createProductSchema,
  idParamSchema,
  imageParamSchema,
  listProductsSchema,
  updateProductSchema,
  validate,
};
