const { z } = require('zod');

const strongPassword = z
  .string()
  .min(8)
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a special character');

const registerSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(1).max(100),
    email: z.email().trim().toLowerCase(),
    password: strongPassword,
    role: z.enum(['BUYER', 'SELLER']).default('BUYER'),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.email().trim().toLowerCase(),
    password: z.string().min(1),
  }),
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: strongPassword,
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

  req.body = parsed.data.body;
  return next();
};

module.exports = {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  validate,
};
