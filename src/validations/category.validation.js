const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

const categoryBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be URL-safe')
    .optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().optional(),
});

const createCategorySchema = z.object({
  body: categoryBody,
});

const updateCategorySchema = z.object({
  body: categoryBody.partial().refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  }),
  params: z.object({
    id: objectId,
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
  return next();
};

module.exports = {
  createCategorySchema,
  updateCategorySchema,
  validate,
};
