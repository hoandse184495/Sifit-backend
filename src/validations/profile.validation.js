const { z } = require('zod');

const updateProfileSchema = z.object({
  body: z.object({
    fullName: z.string().trim().min(1, 'Full name is required').max(100).optional(),
    phone: z.string().trim().max(24).refine(
      (value) => value === '' || /^\+?[0-9 ().-]{8,24}$/.test(value) && value.replace(/\D/g, '').length >= 8,
      'Phone number is invalid',
    ).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'At least one profile field is required'),
});

module.exports = { updateProfileSchema };
