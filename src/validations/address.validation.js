const { z } = require('zod');

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');
const phone = z.string().regex(/^(0|\+84)(3|5|7|8|9)\d{8}$/, 'Invalid Vietnamese phone number');

const addressBody = z.object({
  label: z.string().trim().min(1).max(100),
  recipientName: z.string().trim().min(1).max(100),
  phone,
  addressLine: z.string().trim().min(1).max(255),
  ward: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  postalCode: z.string().trim().max(20).optional(),
  addressType: z.enum(['SHIPPING', 'PICKUP', 'BOTH']).default('BOTH'),
  isDefault: z.boolean().optional(),
});

const createAddressSchema = z.object({ body: addressBody });
const updateAddressSchema = z.object({
  params: z.object({ id: objectId }),
  body: addressBody.partial().refine((v) => Object.keys(v).length > 0),
});
const idParamSchema = z.object({ params: z.object({ id: objectId }) });

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
  return next();
};

module.exports = { createAddressSchema, idParamSchema, updateAddressSchema, validate };
