const applyValidatedQuery = require('../utils/applyValidatedQuery');
const { z } = require('zod');

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
  updateProfileSchema,
  validate,
};
