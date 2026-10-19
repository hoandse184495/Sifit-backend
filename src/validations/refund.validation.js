const { z } = require('zod');

const refundRequestSchema = z.object({
  body: z.object({
    paymentId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid payment id'),
    amount: z.coerce.number().int().positive(),
    idempotencyKey: z.uuid(),
    reason: z.string().trim().max(500).optional(),
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
  return next();
};

module.exports = { refundRequestSchema, validate };
