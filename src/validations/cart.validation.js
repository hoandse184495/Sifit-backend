const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid product id');

const addCartItemSchema = z.object({
  body: z.object({
    productId: objectId,
  }),
});

const productIdParamSchema = z.object({
  params: z.object({
    productId: objectId,
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
  addCartItemSchema,
  productIdParamSchema,
  validate,
};
